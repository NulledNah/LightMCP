// ============================================================
// LightMCP — MCP Router Server
// Exposes a single MCP tool: lightmcp_get_tools
// ============================================================
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "../config.js";
import {
  handleGetTools,
  GetToolsInputSchema,
} from "./handlers.js";

export async function createMcpServer(): Promise<express.Application> {
  const cfg = await loadConfig();

  const mcpServer = new McpServer({
    name: "lightmcp",
    version: "0.1.0",
  });

  // Register the single routing tool
  mcpServer.registerTool(
    "lightmcp_get_tools",
    {
      description:
        "Selects and returns the minimum set of MCP tool definitions needed for a given task. " +
        "Call this tool BEFORE attempting a task to discover which tools are available. " +
        "Returns full MCP tool schemas you can use immediately.",
      inputSchema: GetToolsInputSchema,
    },
    handleGetTools
  );

  // Express app with MCP transport
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "lightmcp",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
  });

  // MCP endpoint — stateless, one transport per request
  app.post("/mcp", async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP request error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // MCP GET (for SSE clients)
  app.get("/mcp", async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("MCP SSE error:", err);
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
      console.log(
        `\n🌐 LightMCP Router running at http://${host}:${port}/mcp`
      );
      console.log(
        `   Health: http://${host}:${port}/health\n`
      );
      resolve();
    });
    httpServer.on("error", reject);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received — shutting down…`);
      const { stopOllama } = await import("../ollama/manager.js");
      const { stopCatalogWatcher } = await import("../catalog/watcher.js");
      await Promise.all([stopOllama(), stopCatalogWatcher()]);
      httpServer.close(() => {
        console.log("👋 LightMCP stopped");
        process.exit(0);
      });
    };

    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
  });
}
