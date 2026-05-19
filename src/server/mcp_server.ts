// ============================================================
// LightMCP — MCP Router Server
// Creates an McpServer, registers permanent tools, connects
// a transport (HTTP or STDIO). The SDK handles all protocol
// details — no manual JSON-RPC parsing, no dual-mode dispatch.
// ============================================================
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../config.js";
import { getVersion } from "../version.js";
import { getCatalogTools } from "../catalog/loader.js";
import { handleGetTools, GetToolsInputSchema } from "./handlers.js";
import type { GetToolsInput } from "./handlers.js";
import { callTool } from "./proxy.js";
import { createHttpTransport, createStdioTransport, type TransportHandle } from "./transports.js";
import { qualifyToolName } from "../types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { Express } from "express";

let _mcpServer: McpServer | null = null;
let _transportHandle: TransportHandle | null = null;
let _lastActivity: number = Date.now();

export function getMcpServer(): McpServer {
  if (!_mcpServer) throw new Error("McpServer not initialized — call createMcpServer() first");
  return _mcpServer;
}

export function getApp(): Express | undefined {
  return _transportHandle?.app as Express | undefined;
}

export function bumpActivity(): void {
  _lastActivity = Date.now();
}

export type ServerStartMode = "http" | "stdio";

export async function createMcpServer(mode: ServerStartMode): Promise<void> {
  const cfg = await loadConfig();
  const version = await getVersion();

  _mcpServer = new McpServer({ name: "lightmcp", version });

  // 1. Always register get_task_tools
  _mcpServer.registerTool(
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
      return handleGetTools(args as GetToolsInput);
    }
  );

  // 2. Register always-on tools from config
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
      _mcpServer.registerTool(
        qualifiedName,
        {
          description: entry.description || `Tool from ${entry.serverKey}`,
          _meta: { serverKey: entry.serverKey, transport: entry.serverTransport },
        },
        async (args) => {
          const result = await callTool(entry.serverKey, entry.name, args as Record<string, unknown> | undefined);
          return { content: result.content, isError: result.isError } as CallToolResult;
        }
      );
    }
  }

  // 3. Full mode: register all tools from catalog
  if (cfg.server.mode === "full") {
    const catalog = await getCatalogTools();
    for (const tool of catalog) {
      const qualifiedName = qualifyToolName(tool.serverKey, tool.name);
      _mcpServer.registerTool(
        qualifiedName,
        {
          description: tool.description || `Tool from ${tool.serverKey}`,
          _meta: { serverKey: tool.serverKey, transport: tool.serverTransport },
        },
        async (args) => {
          const result = await callTool(tool.serverKey, tool.name, args as Record<string, unknown> | undefined);
          return { content: result.content, isError: result.isError } as CallToolResult;
        }
      );
    }
    console.log(`[INFO] Full mode: registered ${catalog.length} tools from catalog`);
  }

  // 4. Create transport
  if (mode === "http") {
    _transportHandle = await createHttpTransport(cfg);
  } else {
    _transportHandle = createStdioTransport();
  }

  // 5. Connect — SDK takes over from here
  await _mcpServer.connect(_transportHandle.transport);
  await _transportHandle.start();
}

export async function stopServer(): Promise<void> {
  if (_mcpServer) {
    try { await _mcpServer.close(); } catch { /* ignore */ }
    _mcpServer = null;
  }
  if (_transportHandle) {
    try { await _transportHandle.stop(); } catch { /* ignore */ }
    _transportHandle = null;
  }
}

export async function startServer(mode: ServerStartMode = "http"): Promise<void> {
  await createMcpServer(mode);

  const cfg = await loadConfig();
  const { idleTimeoutSeconds } = cfg.server;

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    if (_idleInterval) clearInterval(_idleInterval);
    console.log(`\n${signal} received — shutting down…`);
    const { stopOllama } = await import("../ollama/manager.js");
    const { stopCatalogWatcher } = await import("../catalog/watcher.js");
    const { closeServerPool } = await import("./proxy.js");
    await Promise.all([stopOllama(), stopCatalogWatcher(), closeServerPool()]);
    await stopServer();
    console.log("[INFO] LightMCP stopped");
    process.exit(0);
  };

  process.on("SIGINT", () => { shutdown("SIGINT").catch(() => {}); });
  process.on("SIGTERM", () => { shutdown("SIGTERM").catch(() => {}); });

  // Server idle timeout
  let _idleInterval: NodeJS.Timeout | null = null;
  if (idleTimeoutSeconds > 0) {
    _idleInterval = setInterval(() => {
      const elapsed = (Date.now() - _lastActivity) / 1_000;
      if (elapsed >= idleTimeoutSeconds) {
        shutdown("IDLE");
      }
    }, 10_000);
  }
}
