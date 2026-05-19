// ============================================================
// LightMCP — Transport Factory
// Creates the correct MCP transport (HTTP or STDIO) and wires
// it up for use with an McpServer instance.
// ============================================================
import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { LightMCPConfig } from "../types.js";
import { bumpActivity } from "../utils.js";

// ── Middleware shared by HTTP mode ─────────────────────────

function corsMiddleware(_req: express.Request, res: express.Response, next: express.NextFunction): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  if (_req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

function rateLimiter(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const RATE_LIMIT_WINDOW_MS = 60_000;
  const RATE_LIMIT_MAX_REQUESTS = 300;
  const map = _rateLimitMap;
  const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  let entry = map.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    map.set(key, entry);
  } else {
    entry.count++;
  }
  res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT_MAX_REQUESTS));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, RATE_LIMIT_MAX_REQUESTS - entry.count)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  if (Math.random() < 0.01) {
    for (const [k, v] of map) {
      if (now >= v.resetAt) map.delete(k);
    }
  }
  next();
}

const _rateLimitMap = new Map<string, { count: number; resetAt: number }>();

// ── Transport constructors ──────────────────────────────────

export interface TransportHandle {
  transport: Transport;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Express app (only set for HTTP transport) */
  app?: express.Application;
}

export async function createHttpTransport(cfg: LightMCPConfig): Promise<TransportHandle> {
  const { port, host } = cfg.server;

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  });

  const app = express();
  app.disable("x-powered-by");
  app.use(corsMiddleware);
  app.use(rateLimiter);
  app.use(express.json({ limit: "4mb" }));

  // Track server activity for idle timeout
  app.use((req, _res, next) => {
    if (req.path === "/mcp" && req.method === "POST") {
      bumpActivity();
    }
    next();
  });

  app.post("/mcp", async (req, res) => {
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP POST error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.get("/mcp", async (req, res) => {
    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("MCP GET error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.delete("/mcp", async (req, res) => {
    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("MCP DELETE error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "lightmcp", timestamp: new Date().toISOString() });
  });

  let httpServer: ReturnType<typeof app.listen> | null = null;

  const start = async () => {
    await new Promise<void>((resolve, reject) => {
      httpServer = app.listen(port, host, () => {
        console.log(`\n[INFO] LightMCP Router running at http://${host}:${port}/mcp`);
        console.log(`   Health: http://${host}:${port}/health`);
        console.log(`   Mode: ${cfg.server.mode}\n`);
        resolve();
      });
      httpServer!.on("error", reject);
    });
  };

  const stop = async () => {
    await transport.close();
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    }
  };

  return { transport, start, stop, app };
}

export function createStdioTransport(): TransportHandle {
  const transport = new StdioServerTransport();

  const start = async () => {
    // StdioServerTransport.start() is called by McpServer.connect().
    // Calling it twice throws "already started". No-op here.
    console.log("[INFO] LightMCP STDIO transport ready");
  };

  const stop = async () => {
    await transport.close();
  };

  return { transport, start, stop };
}
