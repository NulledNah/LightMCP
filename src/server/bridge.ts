#!/usr/bin/env node
// ============================================================
// LightMCP — STDIO Bridge
// Antigravity connects via STDIO (command: node bridge.js)
// Bridge forwards JSON-RPC to LightMCP HTTP server.
// ============================================================
import { createInterface } from "node:readline";
import { request } from "node:http";

const LIGHTMCP_URL = process.env.LIGHTMCP_URL ?? "http://127.0.0.1:3131/mcp";
let _sessionId: string | null = null;

const rl = createInterface({ input: process.stdin });

function sendResponse(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

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
        // Extract session ID if present
        const sid = res.headers["mcp-session-id"];
        if (sid && typeof sid === "string") _sessionId = sid;

        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          // If SSE response, extract the data line
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

    req.on("error", (err) => {
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

console.error("[bridge] LightMCP STDIO bridge started →", LIGHTMCP_URL);

// Handle process shutdown
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

// Read JSON-RPC lines from stdin, forward to HTTP, write response to stdout
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const parsed = JSON.parse(trimmed);

    // Initialize: store session
    if (parsed.method === "initialize") {
      const response = await forwardToServer(trimmed);
      sendResponse(JSON.parse(response));
      return;
    }

    // Forward everything else
    const response = await forwardToServer(trimmed);
    sendResponse(JSON.parse(response));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendResponse({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: msg },
    });
  }
});
