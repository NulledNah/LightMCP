// ============================================================
// LightMCP — MCP Router Server
// Singleton McpServer with dynamic tool registration.
// Agents connect here; LightMCP forwards tool calls to
// the real downstream MCP servers.
// ============================================================
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import {
  handleGetTools,
  GetToolsInputSchema,
} from "./handlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _version: string | null = null;
let _mcpServer: McpServer | null = null;
let _transport: StreamableHTTPServerTransport | null = null;

async function getVersion(): Promise<string> {
  if (_version) return _version;
  try {
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as { version: string };
    _version = pkg.version;
  } catch {
    _version = "0.1.0";
  }
  return _version;
}

/** Shared McpServer instance — call after createMcpServer() */
export function getMcpServer(): McpServer {
  if (!_mcpServer) throw new Error("McpServer not initialized — call createMcpServer() first");
  return _mcpServer;
}

export async function createMcpServer(): Promise<express.Application> {
  await loadConfig(); // ensure config is valid
  const version = await getVersion();

  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // ── Health check ──────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "lightmcp",
      version,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Singleton MCP transport (stateless — compatible with all agents) ──
  _transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  _mcpServer = new McpServer({ name: "lightmcp", version });

  // Permanent tool: the semantic selector
  _mcpServer.registerTool(
    "lightmcp_get_tools",
    {
      description:
        "Ask LightMCP which tools are relevant for a given task. " +
        "Returns the best matching MCP tools from all connected servers. " +
        "Use this before calling any other tool to discover what's available.",
      inputSchema: GetToolsInputSchema,
    },
    handleGetTools
  );

  // Connect transport ONCE
  await _mcpServer.connect(_transport);

  // ── MCP endpoints — pass through to the singleton transport ─
  app.post("/mcp", async (req, res) => {
    try {
      await _transport!.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP POST error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.get("/mcp", async (req, res) => {
    try {
      await _transport!.handleRequest(req, res);
    } catch (err) {
      console.error("MCP GET error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.delete("/mcp", async (req, res) => {
    try {
      await _transport!.handleRequest(req, res);
    } catch (err) {
      console.error("MCP DELETE error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  return app;
}

export async function startServer(): Promise<void> {
  const cfg = await loadConfig();
  const { port, host } = cfg.server;

  const app = await createMcpServer();

  await new Promise<void>((resolve, reject) => {
    const httpServer = app.listen(port, host, () => {
      console.log(`\n[INFO] LightMCP Router running at http://${host}:${port}/mcp`);
      console.log(`   Health: http://${host}:${port}/health\n`);
      resolve();
    });
    httpServer.on("error", reject);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received — shutting down…`);
      const { stopOllama } = await import("../ollama/manager.js");
      const { stopCatalogWatcher } = await import("../catalog/watcher.js");
      const { closeServerPool } = await import("./proxy.js");
      await Promise.all([stopOllama(), stopCatalogWatcher(), closeServerPool()]);
      if (_transport) await _transport.close();
      httpServer.close(() => {
        console.log("[INFO] LightMCP stopped");
        process.exit(0);
      });
    };

    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
  });
}
