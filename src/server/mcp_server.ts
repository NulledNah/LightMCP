// ============================================================
// LightMCP — MCP Router Server
// Singleton McpServer with dynamic tool registration.
// Agents connect here; LightMCP forwards tool calls to
// the real downstream MCP servers.
// ============================================================
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { getVersion } from "../version.js";
import {
  handleGetTools,
  GetToolsInputSchema,
} from "./handlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _mcpServer: McpServer | null = null;
let _transport: StreamableHTTPServerTransport | null = null;
let _lastActivity: number = Date.now();

// Track registered tool info for compatibility tools/list handler
const _toolList: { name: string; description: string; inputSchema: Record<string, unknown> }[] = [];
const _toolMeta = new Map<string, string>(); // toolName → serverKey

// ── Security: In-memory rate limiter ──────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 300;
const _rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function rateLimiter(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  let entry = _rateLimitMap.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    _rateLimitMap.set(key, entry);
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
  // Periodic cleanup of expired entries (every 100 requests)
  if (Math.random() < 0.01) {
    for (const [k, v] of _rateLimitMap) {
      if (now >= v.resetAt) _rateLimitMap.delete(k);
    }
  }
  next();
}

// ── Security: CORS middleware ─────────────────────────────
function corsMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

// ── Security: Prompt injection guard ──────────────────────
const INJECTION_PATTERNS = [
  /system:\s*/gi,           // Attempts to define a system role
  /<\|im_start\|>/gi,        // ChatML injection
  /<\|im_end\|>/gi,
  /\[INST\]/gi,              // Llama-style injection
  /\[SYS\]/gi,
  /<<SYS>>/gi,
  /ignore (all |previous )?instructions/i,  // Instruction override
  /disregard previous/i,
  /you are now/i,            // Role reassignment
  /forget (everything|all)/i,
];

function containsInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

/** Track a tool for the tools/list compatibility handler */
export function trackTool(name: string, description: string, serverKey: string, inputSchema?: Record<string, unknown>): void {
  const idx = _toolList.findIndex(t => t.name === name);
  const entry = { name, description, inputSchema: inputSchema ?? { type: "object" } };
  if (idx >= 0) _toolList[idx] = entry;
  else _toolList.push(entry);
  _toolMeta.set(name, serverKey);
}

/** Remove a tracked tool */
export function untrackTool(name: string): void {
  const idx = _toolList.findIndex(t => t.name === name);
  if (idx >= 0) _toolList.splice(idx, 1);
  _toolMeta.delete(name);
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
  app.disable("x-powered-by");
  app.use(corsMiddleware);
  app.use(rateLimiter);
  app.use(express.json({ limit: "4mb" }));

  // Inject missing Accept header for non-compliant MCP clients
  app.use((req, _res, next) => {
    if (req.path === "/mcp" && req.method === "POST") {
      if (!req.headers["accept"]) {
        req.headers["accept"] = "application/json, text/event-stream";
      }
    }
    next();
  });

  // Track server activity for idle timeout
  app.use((req, _res, next) => {
    if (req.path === "/mcp" && req.method === "POST") {
      _lastActivity = Date.now();
    }
    next();
  });

  // ── Health check ──────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "lightmcp",
      version,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Singleton MCP transport (stateful — SDK manages sessions for Streamable HTTP clients) ──
  _transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  _mcpServer = new McpServer({ name: "lightmcp", version });

  // Permanent tool: the semantic selector — the ONLY tool at startup
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
    handleGetTools
  );
  trackTool("get_task_tools",
    "Call this before any task to discover which tools are available. " +
    "Provide a description of what you need to accomplish and receive " +
    "the exact set of tools relevant to your task.",
    "lightmcp",
    {
      type: "object",
      properties: {
        task: { type: "string", description: "Natural language description of the task you need tools for." },
        hints: { type: "array", items: { type: "string" }, description: "Optional keywords to guide selection." },
      },
      required: ["task"],
    }
  );

  // Connect transport ONCE
  await _mcpServer.connect(_transport);

  // ── MCP endpoints ─────────────────────────────────────────
  //
  // Dual-mode: SDK transport handles stateful Streamable HTTP sessions
  // (openCode, Claude Code, Cursor). Custom handlers support stateless
  // Antigravity which spawns fresh processes per call without sessions.

  app.post("/mcp", async (req, res) => {
    try {
      const body = req.body;
      const method = body?.method;
      const hasSession = !!req.headers["mcp-session-id"];

      // initialize: always delegate to SDK for proper session management.
      // The SDK generates a session ID and returns it in Mcp-Session-Id header.
      if (method === "initialize") {
        await _transport!.handleRequest(req, res, body);
        return;
      }

      // Stateless Antigravity: tools/list without session header
      if (method === "tools/list" && !hasSession) {
        const tools = [..._toolList];
        res.json({ jsonrpc: "2.0", id: body.id, result: { tools } });
        return;
      }

      // Stateless Antigravity & CLI: tools/call without session header
      if (method === "tools/call" && !hasSession) {
        const toolName = body?.params?.name;
        const toolArgs = body?.params?.arguments ?? {};

        // get_task_tools: handle directly
        if (toolName === "get_task_tools") {
          const task = String(toolArgs.task ?? "");
          const hints = Array.isArray(toolArgs.hints) ? toolArgs.hints.map(String) : [];
          if (containsInjection(task) || hints.some((h: string) => containsInjection(h))) {
            res.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ selected: 0, tools: [], total: 0 }) }] } });
            return;
          }
          const result = await handleGetTools(toolArgs as Parameters<typeof handleGetTools>[0]);
          res.json({ jsonrpc: "2.0", id: body.id, result });
          return;
        }

        // Look up dynamically registered tool and forward via proxy
        try {
          const serverKey = _toolMeta.get(toolName);
          if (serverKey) {
            const { callTool } = await import("./proxy.js");
            const proxyResult = await callTool(serverKey, toolName, toolArgs);
            res.json({ jsonrpc: "2.0", id: body.id, result: proxyResult });
            return;
          }
        } catch (err) {
          console.error("Proxy call failed:", err);
        }

        // Tool not found: return clean JSON error
        res.json({
          jsonrpc: "2.0",
          id: body.id,
          error: {
            code: -32601,
            message: `Tool "${toolName}" not found. Call get_task_tools first to discover available tools.`,
          },
        });
        return;
      }

      // Stateful Streamable HTTP: delegate to SDK transport
      // (handles tools/list, tools/call, notifications, etc. with proper session matching)
      await _transport!.handleRequest(req, res, body);
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
  const { port, host, idleTimeoutSeconds } = cfg.server;

  const app = await createMcpServer();

  await new Promise<void>((resolve, reject) => {
    const httpServer = app.listen(port, host, () => {
      console.log(`\n[INFO] LightMCP Router running at http://${host}:${port}/mcp`);
      console.log(`   Health: http://${host}:${port}/health`);
      if (idleTimeoutSeconds > 0) {
        console.log(`   Idle timeout: ${idleTimeoutSeconds}s\n`);
      } else {
        console.log("");
      }
      resolve();
    });
    httpServer.on("error", reject);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      if (_idleInterval) clearInterval(_idleInterval);
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

    // ── Server idle timeout (auto-shutdown) ────────────────
    let _idleInterval: NodeJS.Timeout | null = null;
    if (idleTimeoutSeconds > 0) {
      _idleInterval = setInterval(() => {
        const elapsed = (Date.now() - _lastActivity) / 1_000;
        if (elapsed >= idleTimeoutSeconds) {
          shutdown("IDLE");
        }
      }, 10_000); // check every 10s
    }
  });
}
