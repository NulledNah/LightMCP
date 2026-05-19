// ============================================================
// LightMCP — CLI Utilities
// ============================================================
import path from "node:path";
import os from "node:os";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function cleanTip(raw: string, toolName: string): string {
  let tip = raw;
  const n = toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  tip = tip.replace(new RegExp(`^Use\\s+['\`"]${n}['\`"]\\s+(when|to|for|in|as|with)\\s+`, 'i'),
    (_: string, w: string) => w.charAt(0).toUpperCase() + w.slice(1) + " ");
  tip = tip.replace(new RegExp(`^Use\\s+['\`"]${n}['\`"][,\\s]*`, 'i'), "");

  tip = tip.replace(new RegExp(`([,;])\\s*use\\s+['\`"]${n}['\`"]\\s+(to|for|as|when|in|with)\\s+`, 'gi'),
    (_: string, p: string, w: string) => p + " " + w + " ");
  tip = tip.replace(new RegExp(`([,;])\\s*use\\s+['\`"]${n}['\`"][.,]?\\s*`, 'gi'), "$1 ");

  tip = tip.replace(new RegExp(`\\.\\s*Use\\s+['\`"]${n}['\`"]\\s+(to|for|as|when|in|with)\\s+`, 'g'),
    (_: string, w: string) => ". " + w.charAt(0).toUpperCase() + w.slice(1) + " ");
  tip = tip.replace(new RegExp(`\\.\\s*Use\\s+['\`"]${n}['\`"][.,]?\\s*`, 'gi'), ". ");

  tip = tip.replace(/[,;]\s*Use this tool\s+(to|for|as|when)\s+/gi,
    (_: string, w: string) => ", " + w + " ");
  tip = tip.replace(/\.\s*Use this tool\s+(to|for|as|when)\s+/g,
    (_: string, w: string) => ". " + w.charAt(0).toUpperCase() + w.slice(1) + " ");

  tip = tip.replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").trim();
  if (tip.length > 0) tip = tip.charAt(0).toUpperCase() + tip.slice(1);
  return tip;
}

export function safePath(inputPath: string): string {
  const resolved = path.resolve(process.cwd(), inputPath);
  if (resolved.includes(".." + path.sep) || resolved.includes(path.sep + "..")) {
    throw new Error(`Path traversal detected: ${inputPath}`);
  }
  return resolved;
}

const SESSION_FILE = path.join(os.tmpdir(), "lightmcp_session.json");

interface SessionData {
  sessionId: string;
  host: string;
  port: number;
}

function readSession(): SessionData | null {
  try {
    if (!existsSync(SESSION_FILE)) return null;
    const raw = readFileSync(SESSION_FILE, "utf-8");
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

function writeSession(data: SessionData): void {
  try {
    writeFileSync(SESSION_FILE, JSON.stringify(data), "utf-8");
  } catch { /* non-critical */ }
}

/** Gets a valid MCP session ID, reusing cached one if still valid. */
export async function mcpHandshake(url: string): Promise<string | null> {
  const urlObj = new URL(url);
  const host = urlObj.hostname;
  const port = parseInt(urlObj.port) || 3131;

  // Try cached session first
  const cached = readSession();
  if (cached && cached.host === host && cached.port === port) {
    try {
      const testRes = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Mcp-Session-Id": cached.sessionId,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list" }),
        signal: AbortSignal.timeout(5_000),
      });
      if (testRes.ok) return cached.sessionId;
    } catch { /* expired, re-handshake */ }
  }

  // Fresh handshake
  const initRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 0, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "lightmcp-cli", version: "1.0" } },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!initRes.ok) return null;

  const rawId = initRes.headers.get("mcp-session-id");
  const sessionId = rawId && rawId.length > 0 ? rawId : null;
  if (!sessionId) return null;

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Mcp-Session-Id": sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    signal: AbortSignal.timeout(10_000),
  });

  writeSession({ sessionId, host, port });
  return sessionId;
}
