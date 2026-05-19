#!/usr/bin/env node
// ============================================================
// LightMCP — STDIO Bridge
// Thin STDIO→HTTP forwarder for agents that spawn one-shot
// processes (e.g. Antigravity). Reads JSON-RPC from stdin, POSTs
// to the LightMCP HTTP server, writes response to stdout.
//
// Usage in agent config:
//   "command": "node", "args": ["<path>/dist/server/bridge.js"]
// ============================================================
import { createInterface } from "node:readline";

let LIGHTMCP_URL = process.env.LIGHTMCP_URL ?? "http://127.0.0.1:3131/mcp";

if (!process.env.LIGHTMCP_URL) {
  try {
    const { loadConfig } = await import("../config.js");
    const cfg = await loadConfig();
    LIGHTMCP_URL = `http://${cfg.server.host}:${cfg.server.port}/mcp`;
  } catch { /* use default */ }
}

let _sessionId: string | null = null;

async function forward(body: string): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (_sessionId) headers["mcp-session-id"] = _sessionId;

  const resp = await fetch(LIGHTMCP_URL, { method: "POST", headers, body });

  const sid = resp.headers.get("mcp-session-id");
  if (sid) _sessionId = sid;

  const text = await resp.text();
  const ct = resp.headers.get("content-type") ?? "";

  if (ct.includes("text/event-stream")) {
    const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
    if (dataLine) return dataLine.slice(5).trim();
  }
  return text;
}

const rl = createInterface({ input: process.stdin });

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const parsed = JSON.parse(trimmed);
    const isInitialize = parsed.method === "initialize";
    const response = await forward(trimmed);
    const result = JSON.parse(response);
    process.stdout.write(JSON.stringify(result) + "\n");

    if (isInitialize && !result.error) {
      await forward(JSON.stringify({
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
