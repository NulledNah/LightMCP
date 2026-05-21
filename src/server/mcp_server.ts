// ============================================================
// LightMCP — MCP Router Server
// Creates an McpServer, registers permanent tools, connects
// a transport (HTTP or STDIO). The SDK handles all protocol
// details — no manual JSON-RPC parsing, no dual-mode dispatch.
//
// In HTTP mode, session management (including per-session
// McpServer creation) is delegated entirely to transports.ts.
// STDIO mode keeps the singleton for backward compatibility.
// ============================================================
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { getVersion } from "../version.js";
import { getCatalogTools } from "../catalog/loader.js";
import { handleGetTools, GetToolsInputSchema } from "./handlers.js";
import { callTool } from "./proxy.js";
import { createHttpTransport, createStdioTransport, type TransportHandle } from "./transports.js";
import { qualifyToolName } from "../types.js";
import { getLastActivity } from "../utils.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { Express } from "express";

export type ServerStartMode = "http" | "stdio";

export class McpServerManager {
  mcpServer: McpServer | null = null;
  transportHandle: TransportHandle | null = null;
  private _idleInterval: NodeJS.Timeout | null = null;

  getServer(): McpServer {
    if (!this.mcpServer) throw new Error("McpServer not initialized — call createMcpServer() first");
    return this.mcpServer;
  }

  getApp(): Express | undefined {
    return this.transportHandle?.app as Express | undefined;
  }

  async create(mode: ServerStartMode): Promise<void> {
    const cfg = await loadConfig();

    if (mode === "http") {
      this.transportHandle = await createHttpTransport(cfg);
      await this.transportHandle.start();
      return;
    }

    const version = await getVersion();
    this.mcpServer = new McpServer({ name: "lightmcp", version });

    this.mcpServer.registerTool(
      "get_task_tools",
      {
        description:
          "Call this before any task to discover which tools are available. " +
          "Provide a description of what you need to accomplish and receive " +
          "the exact set of tools relevant to your task. The returned tools " +
          "become immediately callable. Use this as the first step in every task.",
        inputSchema: GetToolsInputSchema,
      },
      async (args) => {
        return handleGetTools(args);
      }
    );

    const alwaysOn = cfg.alwaysOn ?? [];
    if (alwaysOn.length > 0) {
      const catalog = await getCatalogTools();
      const catalogMap = new Map(catalog.map((t) => [t.name, t]));

      for (const toolName of alwaysOn) {
        const entry = catalogMap.get(toolName);
        if (!entry) {
          console.warn(`[WARN] alwaysOn tool "${toolName}" not found in catalog`);
          continue;
        }
        const qualifiedName = qualifyToolName(entry.serverKey, entry.name);
        this.mcpServer.registerTool(
          qualifiedName,
          {
            description: entry.description || `Tool from ${entry.serverKey}`,
            inputSchema: z.object({}).passthrough(),
            _meta: { serverKey: entry.serverKey, transport: entry.serverTransport },
          },
          async (args: Record<string, unknown>) => {
            const result = await callTool(entry.serverKey, entry.name, args);
            return { content: result.content, isError: result.isError } as CallToolResult;
          }
        );
      }
    }

    if (cfg.server.mode === "full") {
      const catalog = await getCatalogTools();
      for (const tool of catalog) {
        const qualifiedName = qualifyToolName(tool.serverKey, tool.name);
        this.mcpServer.registerTool(
          qualifiedName,
          {
            description: tool.description || `Tool from ${tool.serverKey}`,
            inputSchema: z.object({}).passthrough(),
            _meta: { serverKey: tool.serverKey, transport: tool.serverTransport },
          },
          async (args: Record<string, unknown>) => {
            const result = await callTool(tool.serverKey, tool.name, args);
            return { content: result.content, isError: result.isError } as CallToolResult;
          }
        );
      }
      console.log(`[INFO] Full mode: registered ${catalog.length} tools from catalog`);
    }

    this.transportHandle = createStdioTransport();
    await this.mcpServer.connect(this.transportHandle.transport);
    await this.transportHandle.start();
  }

  async stop(): Promise<void> {
    if (this._idleInterval) {
      clearInterval(this._idleInterval);
      this._idleInterval = null;
    }
    if (this.mcpServer) {
      try { await this.mcpServer.close(); } catch (err) { if (process.env.DEBUG === 'true') console.error('[DEBUG] mcpServer.close failed:', err); }
      this.mcpServer = null;
    }
    if (this.transportHandle) {
      try { await this.transportHandle.stop(); } catch (err) { if (process.env.DEBUG === 'true') console.error('[DEBUG] transportHandle.stop failed:', err); }
      this.transportHandle = null;
    }
  }

  async start(mode: ServerStartMode = "http"): Promise<void> {
    await this.create(mode);

    const cfg = await loadConfig();
    const { idleTimeoutSeconds } = cfg.server;

    const shutdown = async (signal: string) => {
      if (this._idleInterval) clearInterval(this._idleInterval);
      console.log(`\n${signal} received — shutting down…`);
      try {
        const { stopOllama } = await import("../ollama/manager.js");
        const { stopCatalogWatcher } = await import("../catalog/watcher.js");
        const { closeServerPool } = await import("./proxy.js");
        const results = await Promise.allSettled([stopOllama(), stopCatalogWatcher(), closeServerPool()]);
        for (const result of results) {
          if (result.status === "rejected" && process.env.DEBUG === "true") {
            console.error("[DEBUG] Cleanup step failed:", result.reason);
          }
        }
        await this.stop();
      } catch (err) {
        if (process.env.DEBUG === "true") console.error("[DEBUG] Shutdown error:", err);
      }
      console.log("[INFO] LightMCP stopped");
      process.exit(0);
    };

    const handleSignal = (signal: string) => {
      shutdown(signal).catch((err) => {
        if (process.env.DEBUG === "true") console.error(`[DEBUG] ${signal} shutdown failed:`, err);
        process.exit(1);
      });
    };

    process.on("SIGINT", () => handleSignal("SIGINT"));
    process.on("SIGTERM", () => handleSignal("SIGTERM"));

    if (idleTimeoutSeconds > 0) {
      this._idleInterval = setInterval(() => {
        const elapsed = (Date.now() - getLastActivity()) / 1_000;
        if (elapsed >= idleTimeoutSeconds) {
          shutdown("IDLE");
        }
      }, 10_000);
    }
  }

  reset(): void {
    if (this._idleInterval) {
      clearInterval(this._idleInterval);
      this._idleInterval = null;
    }
    this.mcpServer = null;
    this.transportHandle = null;
  }
}

export const serverManager = new McpServerManager();

export const getMcpServer = () => serverManager.getServer();
export const getApp = () => serverManager.getApp();
export const createMcpServer = (mode: ServerStartMode) => serverManager.create(mode);
export const stopServer = () => serverManager.stop();
export const startServer = (mode?: ServerStartMode) => serverManager.start(mode);
export const resetServer = () => serverManager.reset();
