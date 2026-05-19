// ============================================================
// LightMCP — CLI Utilities
// ============================================================
import path from "node:path";

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

/** Performs MCP initialize handshake. Returns the session ID for subsequent requests. */
export async function mcpHandshake(url: string): Promise<string | null> {
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

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    signal: AbortSignal.timeout(10_000),
  });

  return sessionId;
}
