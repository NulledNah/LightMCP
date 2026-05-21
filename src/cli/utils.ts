// ============================================================
// LightMCP — CLI Utilities
// ============================================================
import path from "node:path";
import os from "node:os";
import { existsSync, readFileSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { MCP_PROTOCOL_VERSION } from "../types.js";

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
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

interface SessionData {
  sessionId: string;
  host: string;
  port: number;
}

function readSession(): SessionData | null {
  try {
    if (!existsSync(SESSION_FILE)) return null;
    const age = Date.now() - statSync(SESSION_FILE).mtimeMs;
    if (age > SESSION_TTL_MS) {
      try { unlinkSync(SESSION_FILE); } catch { /* stale cleanup, non-critical */ }
      return null;
    }
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
      params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "lightmcp-cli", version: "1.0" } },
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

interface CallArgs {
  tool: string;
  args: Record<string, unknown>;
  file?: string;
  output?: string;
}

/** Parse CLI arguments into a tool name and arguments object.
 *  Handles: JSON blob, key=value, --key value, single positional arg.
 *  Detects server prefix (e.g. "kicad search_footprints").
 */
export async function parseCallArgs(
  firstArg: string,
  rawArgs: string[],
  opts: { file?: string; output?: string }
): Promise<CallArgs> {
  const { resolveMcpServers } = await import("../config.js");
  const mcpServers = await resolveMcpServers();
  const knownServers = Object.keys(mcpServers);

  let tool = firstArg;
  let argsStart = 0;

  if (rawArgs.length > 0 && knownServers.includes(firstArg)) {
    tool = rawArgs[0];
    argsStart = 1;
  }

  let toolArgs: Record<string, unknown> = {};

  if (opts.file) {
    const { readFile } = await import("node:fs/promises");
    const filePath = safePath(opts.file);
    const raw = await readFile(filePath, "utf-8");
    toolArgs = JSON.parse(raw);
  } else {
    const effectiveArgs = rawArgs.slice(argsStart);

    if (effectiveArgs.length === 1) {
      try {
        toolArgs = JSON.parse(effectiveArgs[0]);
      } catch {
        toolArgs = { input: effectiveArgs[0] };
      }
    } else if (effectiveArgs.length > 1) {
      for (let i = 0; i < effectiveArgs.length; i++) {
        let key = effectiveArgs[i].replace(/^--?/, "");
        const eqIdx = key.indexOf("=");
        if (eqIdx >= 0) {
          const val = key.slice(eqIdx + 1).replace(/^['"]|['"]$/g, "");
          key = key.slice(0, eqIdx);
          toolArgs[key] = val;
        } else {
          const next = effectiveArgs[i + 1];
          if (next && !next.startsWith("-")) {
            toolArgs[key] = next.replace(/^['"]|['"]$/g, "");
            i++;
          }
        }
      }
    }
  }

  return { tool, args: toolArgs };
}

/** Make a tools/call request to the LightMCP server and print the result. */
export async function callToolViaHttp(
  tool: string,
  toolArgs: Record<string, unknown>,
  opts: { output?: string } = {}
): Promise<void> {
  const { loadConfig } = await import("../config.js");
  const cfg = await loadConfig();
  const url = `http://${cfg.server.host}:${cfg.server.port}/mcp`;

  const sessionId = await mcpHandshake(url);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: toolArgs },
    }),
  });

  const rawBody = await res.text();
  try {
    const data = JSON.parse(rawBody) as {
      error?: { code: number; message: string };
      result?: { content?: { type: string; text?: string; data?: string; mimeType?: string }[] };
    };
    if (data.error) {
      console.error(JSON.stringify(data.error));
      process.exit(1);
    }
    const content = data.result?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && block.text) {
          process.stdout.write(block.text);
        } else if (block.type === "image" && block.data) {
          if (opts.output) {
            const { writeFile } = await import("node:fs/promises");
            const buf = Buffer.from(block.data, "base64");
            const outputPath = safePath(opts.output);
            await writeFile(outputPath, buf);
            process.stdout.write(`[OK] Image saved to ${opts.output}\n`);
          } else {
            process.stdout.write(block.data);
          }
        }
      }
      process.stdout.write("\n");
    } else {
      process.stdout.write(JSON.stringify(data.result, null, 2) + "\n");
    }
  } catch {
    if (rawBody) process.stdout.write(rawBody + "\n");
    else console.error(`Tool "${tool}" returned empty response`);
  }
}
