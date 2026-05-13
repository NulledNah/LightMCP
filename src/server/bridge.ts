#!/usr/bin/env node
// ============================================================
// LightMCP — STDIO Bridge for Antigravity
//
// Two modes:
// 1. CLI: node bridge.js tool call <name> [json_args]
//    → constructs JSON-RPC tools/call, forwards to HTTP server
// 2. STDIO: reads JSON-RPC lines from stdin
//    → forwards to HTTP server, writes responses to stdout
//
// Auto-start: if the LightMCP server is unreachable, spawns
// `node dist/cli/index.js start` and retries.
// ============================================================
import { createInterface } from "node:readline";
import { request } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const LIGHTMCP_URL = process.env.LIGHTMCP_URL ?? "http://127.0.0.1:3131/mcp";
let _sessionId: string | null = null;
let _serverProc: ChildProcess | null = null;
let _serverStarting: Promise<void> | null = null;

// ── Auto-start server helper ────────────────────────────────

function startServer(): Promise<void> {
  if (_serverStarting) return _serverStarting;

  const cliPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../dist/cli/index.js"
  );

  _serverStarting = new Promise<void>((resolve, reject) => {
    const proc = spawn("node", [cliPath, "start"], {
      detached: false,
      stdio: "ignore",
      shell: process.platform === "win32",
      windowsHide: true,
    });

    _serverProc = proc;
    proc.on("error", (err) => {
      _serverStarting = null;
      reject(err);
    });

    // Give the server time to start listening
    setTimeout(() => {
      resolve();
    }, 3_000);
  });

  return _serverStarting;
}

// ── HTTP forward helper ────────────────────────────────────

async function forwardToServer(body: string): Promise<string> {
  const url = new URL(LIGHTMCP_URL);

  const doRequest = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      if (_sessionId) headers["mcp-session-id"] = _sessionId;

      const req = request(
        {
          hostname: url.hostname,
          port: url.port || 3131,
          path: url.pathname,
          method: "POST",
          headers,
        },
        (res) => {
          const sid = res.headers["mcp-session-id"];
          if (sid && typeof sid === "string") _sessionId = sid;

          let data = "";
          res.on("data", (chunk: Buffer) => (data += chunk.toString()));
          res.on("end", () => {
            if (res.headers["content-type"]?.includes("text/event-stream")) {
              const dataLine = data.split("\n").find((l) => l.startsWith("data:"));
              if (dataLine) {
                resolve(dataLine.slice(5).trim());
                return;
              }
            }
            resolve(data);
          });
        }
      );

      req.on("error", (err) => reject(err));
      req.write(body);
      req.end();
    });

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await doRequest();
    } catch (err: unknown) {
      const msg = err instanceof Error ? (err as NodeJS.ErrnoException).code ?? err.message : String(err);
      if (msg === "ECONNREFUSED" && attempt < 3) {
        if (process.env.LIGHTMCP_VERBOSE) {
          process.stderr.write(`[bridge] Server unreachable — starting LightMCP (attempt ${attempt}/3)...\n`);
        }
        await startServer();
        continue;
      }
      throw err;
    }
  }

  throw new Error("Server unreachable after 3 attempts");
}

// ── CLI mode: node bridge.js tool call <name> [json_args] ──

const args = process.argv.slice(2);

if (args[0] === "tool" && args[1] === "call" && args[2]) {
  const toolName = args[2];
  let toolArgs: unknown = {};

  if (args[3]) {
    try {
      toolArgs = JSON.parse(args[3]);
    } catch {
      toolArgs = { task: args.slice(3).join(" ") };
    }
  }

  const rpcRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: toolArgs,
    },
  };

  try {
    const response = await forwardToServer(JSON.stringify(rpcRequest));
    const parsed = JSON.parse(response);

    if (parsed.error) {
      console.error(JSON.stringify(parsed.error));
      process.exit(1);
    }

    // Extract text content
    const content = parsed.result?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text") {
          process.stdout.write(block.text + "\n");
        }
      }
    } else {
      process.stdout.write(JSON.stringify(parsed.result, null, 2) + "\n");
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  process.exit(0);
}

// ── STDIO mode: read JSON-RPC lines from stdin ─────────────

const rl = createInterface({ input: process.stdin });

// Silence stderr to avoid corrupting MCP JSON-RPC protocol
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const parsed = JSON.parse(trimmed);
    const isInitialize = parsed.method === "initialize";
    const response = await forwardToServer(trimmed);
    const result = JSON.parse(response);
    process.stdout.write(JSON.stringify(result) + "\n");

    // After initialize, send initialized notification (MCP protocol requirement)
    if (isInitialize && !result.error) {
      await forwardToServer(JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: msg },
    }) + "\n");
  }
});
