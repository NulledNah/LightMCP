// ============================================================
// LightMCP — Transport Factory
// Creates the correct MCP transport (HTTP or STDIO) and wires
// it up for use with an McpServer instance.
//
// In HTTP mode, each session gets its own isolated McpServer
// instance — no shared mutable state between clients.
// ============================================================
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LightMCPConfig } from "../types.js";
import { getVersion } from "../version.js";
import { getCatalogTools } from "../catalog/loader.js";
import { callTool } from "./proxy.js";
import { handleGetToolsForSession, GetToolsInputSchema } from "./handlers.js";
import type { GetToolsInput } from "./handlers.js";
import { qualifyToolName } from "../types.js";
import { bumpActivity } from "../utils.js";
import { z } from "zod";

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

// ── Session isolation for HTTP mode ────────────────────────

interface SessionContext {
  sessionId: string;
  mcpServer: McpServer;
  transport: StreamableHTTPServerTransport;
  registeredTools: RegisteredTool[];
  lastActive: number;
  /** Serialises tool registration within a single session */
  _registrationLock: Promise<void>;
}

class SessionRegistry {
  private _sessions = new Map<string, SessionContext>();
  private _cleanupTimer: NodeJS.Timeout | null = null;
  private _idleTimeoutMs: number;

  constructor(idleTimeoutMs: number) {
    this._idleTimeoutMs = idleTimeoutMs;
  }

  get(sessionId: string): SessionContext | undefined {
    const ctx = this._sessions.get(sessionId);
    if (ctx) ctx.lastActive = Date.now();
    return ctx;
  }

  set(sessionId: string, ctx: SessionContext): void {
    this._sessions.set(sessionId, ctx);
  }

  delete(sessionId: string): void {
    this._sessions.delete(sessionId);
  }

  get size(): number {
    return this._sessions.size;
  }

  startCleanup(onSessionExpired: (ctx: SessionContext) => Promise<void>): void {
    if (this._cleanupTimer) return;
    this._cleanupTimer = setInterval(async () => {
      const now = Date.now();
      const expired: SessionContext[] = [];
      for (const [id, ctx] of this._sessions) {
        if (now - ctx.lastActive >= this._idleTimeoutMs) {
          expired.push(ctx);
          this._sessions.delete(id);
        }
      }
      for (const ctx of expired) {
        try {
          await onSessionExpired(ctx);
        } catch (err) {
          console.error(`[WARN] Session GC error for ${ctx.sessionId}:`, err);
        }
      }
    }, 60_000);
  }

  async shutdown(onSessionExpired: (ctx: SessionContext) => Promise<void>): Promise<void> {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    const all = [...this._sessions.values()];
    this._sessions.clear();
    await Promise.all(all.map((ctx) => onSessionExpired(ctx).catch(() => {})));
  }
}

async function destroySession(ctx: SessionContext): Promise<void> {
  try { await ctx.mcpServer.close(); } catch { /* ignore */ }
  try { await ctx.transport.close(); } catch { /* ignore */ }
}

async function registerBaseTools(
  mcpServer: McpServer,
  sessionCtx: SessionContext,
  cfg: LightMCPConfig
): Promise<void> {
  mcpServer.registerTool(
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
      const prev = sessionCtx._registrationLock;
      let release: () => void;
      sessionCtx._registrationLock = new Promise<void>((r) => { release = r; });
      await prev;
      try {
        return handleGetToolsForSession(args as GetToolsInput, mcpServer, sessionCtx.registeredTools);
      } finally {
        release!();
      }
    }
  );

  const alwaysOn = cfg.alwaysOn ?? [];
  if (alwaysOn.length > 0 || cfg.server.mode === "full") {
    const catalog = await getCatalogTools();
    const catalogMap = new Map(catalog.map((t) => [t.name, t]));

    if (alwaysOn.length > 0) {
      for (const toolName of alwaysOn) {
        const entry = catalogMap.get(toolName);
        if (!entry) {
          console.warn(`[WARN] alwaysOn tool "${toolName}" not found in catalog`);
          continue;
        }
        const qualifiedName = qualifyToolName(entry.serverKey, entry.name);
        mcpServer.registerTool(
          qualifiedName,
          {
            description: entry.description || `Tool from ${entry.serverKey}`,
            inputSchema: z.record(z.any()),
            _meta: { serverKey: entry.serverKey, transport: entry.serverTransport },
          },
          async (args: any) => {
            const result = await callTool(entry.serverKey, entry.name, args as Record<string, unknown> | undefined);
            return { content: result.content, isError: result.isError };
          }
        );
      }
    }

    if (cfg.server.mode === "full") {
      for (const tool of catalog) {
        if (alwaysOn.includes(tool.name)) continue;
        const qualifiedName = qualifyToolName(tool.serverKey, tool.name);
        mcpServer.registerTool(
          qualifiedName,
          {
            description: tool.description || `Tool from ${tool.serverKey}`,
            inputSchema: z.record(z.any()),
            _meta: { serverKey: tool.serverKey, transport: tool.serverTransport },
          },
          async (args: any) => {
            const result = await callTool(tool.serverKey, tool.name, args as Record<string, unknown> | undefined);
            return { content: result.content, isError: result.isError };
          }
        );
      }
      console.log(`[INFO] Full mode: registered ${catalog.length} tools for session`);
    }
  }
}

export async function createHttpTransport(
  cfg: LightMCPConfig
): Promise<TransportHandle> {
  const { port, host } = cfg.server;
  const sessionTimeout = (cfg.server.idleTimeoutSeconds || 1800) * 1000;
  const registry = new SessionRegistry(sessionTimeout);

  const app = express();
  app.disable("x-powered-by");
  app.use(corsMiddleware);
  app.use(rateLimiter);
  app.use(express.json({ limit: "4mb" }));

  app.use((req, _res, next) => {
    if (req.path === "/mcp" && req.method === "POST") {
      bumpActivity();
    }
    next();
  });

  async function createSession(sessionId: string): Promise<SessionContext> {
    const version = await getVersion();

    const mcpServer = new McpServer({ name: "lightmcp", version });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      enableJsonResponse: true,
    });

    const ctx: SessionContext = {
      sessionId,
      mcpServer,
      transport,
      registeredTools: [],
      lastActive: Date.now(),
      _registrationLock: Promise.resolve(),
    };

    await registerBaseTools(mcpServer, ctx, cfg);
    await mcpServer.connect(transport);

    transport.onclose = () => {
      registry.delete(sessionId);
      destroySession(ctx).catch(() => {});
    };

    return ctx;
  }

  async function getOrCreateSession(
    sessionIdHeader: string | string[] | undefined,
    body: any
  ): Promise<{ ctx: SessionContext; isNew: boolean }> {
    if (typeof sessionIdHeader === "string" && sessionIdHeader.length > 0) {
      const existing = registry.get(sessionIdHeader);
      if (existing) return { ctx: existing, isNew: false };
    }

    const newSessionId = randomUUID();
    const ctx = await createSession(newSessionId);
    registry.set(newSessionId, ctx);
    return { ctx, isNew: true };
  }

  app.post("/mcp", async (req, res) => {
    try {
      const sessionIdHeader = req.headers["mcp-session-id"];

      if (typeof sessionIdHeader === "string" && sessionIdHeader.length > 0) {
        const ctx = registry.get(sessionIdHeader);
        if (!ctx) {
          res.status(404).json({ error: "Session not found" });
          return;
        }
        await ctx.transport.handleRequest(req, res, req.body);
        return;
      }

      const body = req.body;
      const isInitialize = body && (
        (body.method === "initialize") ||
        (Array.isArray(body) && body.some((msg: any) => msg && msg.method === "initialize"))
      );

      if (isInitialize) {
        const { ctx } = await getOrCreateSession(undefined, body);
        await ctx.transport.handleRequest(req, res, req.body);
      } else {
        res.status(400).json({ error: "Bad Request: Mcp-Session-Id header is required" });
      }
    } catch (err) {
      console.error("MCP POST error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.get("/mcp", async (req, res) => {
    try {
      const sessionIdHeader = req.headers["mcp-session-id"];
      const { ctx } = await getOrCreateSession(sessionIdHeader, undefined);
      await ctx.transport.handleRequest(req, res);
    } catch (err) {
      console.error("MCP GET error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.delete("/mcp", async (req, res) => {
    try {
      const sessionIdHeader = req.headers["mcp-session-id"];
      if (typeof sessionIdHeader === "string" && sessionIdHeader.length > 0) {
        const ctx = registry.get(sessionIdHeader);
        if (ctx) {
          await ctx.transport.handleRequest(req, res);
          return;
        }
      }
      res.status(404).json({ error: "Session not found" });
    } catch (err) {
      console.error("MCP DELETE error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "lightmcp",
      sessions: registry.size,
      timestamp: new Date().toISOString()
    });
  });

  // Session GC
  registry.startCleanup(destroySession);

  let httpServer: ReturnType<typeof app.listen> | null = null;

  const noopTransport: Transport = {
    start: async () => {},
    close: async () => {},
    send: async () => {},
    onclose: undefined,
    onerror: undefined,
    onmessage: undefined,
  };

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
    await registry.shutdown(destroySession);
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    }
  };

  return { transport: noopTransport, start, stop, app };
}

export function createStdioTransport(): TransportHandle {
  const transport = new StdioServerTransport();

  const start = async () => {
    console.log("[INFO] LightMCP STDIO transport ready");
  };

  const stop = async () => {
    await transport.close();
  };

  return { transport, start, stop };
}
