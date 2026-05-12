#!/usr/bin/env node
// ============================================================
// LightMCP — STDIO Bridge for Antigravity
//
// Two modes:
// 1. CLI: node bridge.js tool call <name> [json_args]
//    → constructs JSON-RPC tools/call, forwards to HTTP server
// 2. STDIO: reads JSON-RPC lines from stdin
//    → forwards to HTTP server, writes responses to stdout
// ============================================================
import { createInterface } from "node:readline";
import { request } from "node:http";

const LIGHTMCP_URL = process.env.LIGHTMCP_URL ?? "http://127.0.0.1:3131/mcp";
let _sessionId: string | null = null;

// ── HTTP forward helper ────────────────────────────────────

async function forwardToServer(body: string): Promise<string> {
  const url = new URL(LIGHTMCP_URL);

  return new Promise((resolve, reject) => {
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
      toolArgs = { input: args.slice(3).join(" ") };
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
    const response = await forwardToServer(trimmed);
    process.stdout.write(JSON.stringify(JSON.parse(response)) + "\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: msg },
    }) + "\n");
  }
});
