// ============================================================
// LightMCP — Tool Catalog Builder
// Connects to each MCP server and collects tool definitions.
// ============================================================
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";
import { getVersion } from "../version.js";
import { killProcess } from "../utils.js";
import type {
  MCPServerConfig,
  ToolCatalog,
  ToolEntry,
  CatalogServer,
} from "../types.js";

/** Returns a filtered copy of process.env without dangerous keys
 *  that could be exploited via mcpServers config env overrides.
 *  Keeps PATH/Path for command resolution. */
const DANGEROUS_ENV_KEYS = new Set([
  "LD_PRELOAD", "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH", "NODE_OPTIONS", "NODE_PATH",
]);

function safeProcessEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (!DANGEROUS_ENV_KEYS.has(key)) {
      env[key] = val;
    }
  }
  return env;
}

// ── MCP JSON-RPC helpers ─────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface ToolsDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

// ── STDIO transport ──────────────────────────────────────────

async function queryToolsViaStdio(
  serverKey: string,
  cfg: MCPServerConfig,
  timeoutMs = 15_000
): Promise<ToolsDef[]> {
  const command = cfg.command!;
  const args = cfg.args ?? [];
  const env = { ...safeProcessEnv(), ...(cfg.env ?? {}) };
  const version = await getVersion();

    return new Promise((resolve) => {
    const proc: ChildProcess = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stdout = "";
    let resolved = false;
    const allTools: ToolsDef[] = [];
    let nextReqId = 2;

    function cleanup(): void {
      try { proc.stdin?.end(); } catch { /* ignore */ }
      try { proc.stdout?.destroy(); } catch { /* ignore */ }
      try { proc.stderr?.destroy(); } catch { /* ignore */ }
    }

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        killProcess(proc);
        cleanup();
        console.warn(`  [WARN] ${serverKey}: stdio timeout, skipping`);
        resolve([]);
      }
    }, timeoutMs);

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          if (msg.id && msg.id >= 2 && msg.result) {
            const res = msg.result as { tools?: ToolsDef[]; nextCursor?: string };
            if (res.tools) allTools.push(...res.tools);

            if (res.nextCursor) {
              nextReqId++;
              send({
                jsonrpc: "2.0",
                id: nextReqId,
                method: "tools/list",
                params: { cursor: res.nextCursor },
              });
            } else {
              if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                killProcess(proc);
                cleanup();
                resolve(allTools);
              }
            }
          }
        } catch {
          // not a JSON line, ignore
        }
      }
    });

    proc.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        cleanup();
        console.warn(`  [WARN] ${serverKey}: spawn error — ${err.message}`);
        resolve([]);
      }
    });

    proc.on("close", () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        cleanup();
        resolve([]);
      }
    });

    // MCP handshake: initialize → initialized → tools/list
    const send = (msg: JsonRpcRequest) =>
      proc.stdin?.write(JSON.stringify(msg) + "\n");

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "lightmcp-builder", version },
      },
    });

    setTimeout(() => {
      send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      });
    }, 500);
  });
}

// ── HTTP transport ───────────────────────────────────────────

async function queryToolsViaHttp(
  serverKey: string,
  cfg: MCPServerConfig,
  timeoutMs = 10_000
): Promise<ToolsDef[]> {
  const url = cfg.serverUrl!;

  // Streamable HTTP: POST to /mcp
  const endpoint = url.endsWith("/mcp") ? url : `${url}/mcp`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // 1. Initialize
    const version = await getVersion();
    const initRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "lightmcp-builder", version },
        },
      }),
      signal: controller.signal,
    });

    // Extract session ID if present (MCP Streamable HTTP spec)
    const sessionId = initRes.headers.get("mcp-session-id") ?? undefined;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;

    let nextCursor: string | undefined = undefined;
    const allTools: ToolsDef[] = [];
    let reqId = 2;

    do {
      const listRes = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: reqId++,
          method: "tools/list",
          params: nextCursor ? { cursor: nextCursor } : {},
        }),
        signal: controller.signal,
      });

      const contentType = listRes.headers.get("content-type") ?? "";
      let data: JsonRpcResponse;

      if (contentType.includes("text/event-stream")) {
        const text = await listRes.text();
        const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) break;
        data = JSON.parse(dataLine.slice(5).trim()) as JsonRpcResponse;
      } else {
        data = (await listRes.json()) as JsonRpcResponse;
      }

      const res = data.result as { tools?: ToolsDef[]; nextCursor?: string } | undefined;
      if (res?.tools) allTools.push(...res.tools);
      nextCursor = res?.nextCursor;

    } while (nextCursor);

    clearTimeout(timer);
    return allTools;
  } catch (err: unknown) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  [WARN] ${serverKey}: HTTP error — ${msg}`);
    return [];
  }
}

// ── Main builder ─────────────────────────────────────────────

function shortDesc(desc: string | undefined): string {
  if (!desc) return "";
  if (desc.length > 250) {
    const sliced = desc.slice(0, 247);
    const lastSpace = sliced.lastIndexOf(" ");
    return (lastSpace > 200 ? sliced.slice(0, lastSpace) : sliced) + "…";
  }
  return desc;
}

/** Load tool_tips.json (tool name → procedural tip map) */
async function loadToolTips(): Promise<Record<string, string>> {
  const tipsPath = path.resolve(process.cwd(), "tool_tips.json");
  if (!existsSync(tipsPath)) return {};
  try {
    const raw = await readFile(tipsPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const tips: Record<string, string> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val === "string" && val.trim()) {
        tips[key] = val.trim();
      }
    }
    return tips;
  } catch {
    console.warn("  [WARN] Failed to parse tool_tips.json — skipping tips");
    return {};
  }
}

export async function buildCatalog(opts: {
  activeOnly?: boolean;
} = {}): Promise<ToolCatalog> {
  const cfg = await loadConfig();
  const { resolveMcpServers } = await import("../config.js");
  const mcpServers = await resolveMcpServers();

  const activeOnly = opts.activeOnly ?? cfg.catalog.activeOnly;
  const tools: ToolEntry[] = [];
  const servers: CatalogServer[] = [];

  console.log(
    `\n[INFO] Building catalog` +
    (activeOnly ? " [active-only]" : " [all tools]")
  );

  const toolTips = await loadToolTips();
  const seenEndpoints = new Set<string>();

  for (const [key, serverCfg] of Object.entries(mcpServers)) {
    if (key === "lightmcp") {
      console.log(`  [SKIP] ${key} - skipped (prevent self-loop)`);
      continue;
    }

    const isDisabled = serverCfg.disabled === true;
    if (activeOnly && isDisabled) {
      console.log(`  [SKIP] ${key} - skipped (disabled)`);
      continue;
    }

    const endpointKey = serverCfg.serverUrl
      ? `http:${serverCfg.serverUrl}`
      : `stdio:${serverCfg.command ?? "?"} ${(serverCfg.args ?? []).join(" ")}`.trim();
    if (seenEndpoints.has(endpointKey)) {
      console.warn(`  [WARN] Skipping duplicate "${key}" (same endpoint as another server)`);
      continue;
    }
    seenEndpoints.add(endpointKey);

    const transport: "stdio" | "http" = serverCfg.serverUrl ? "http" : "stdio";
    console.log(`  [INFO] ${key} [${transport}]${isDisabled ? " (disabled)" : ""}...`);

    let rawTools: ToolsDef[] = [];

    if (transport === "http") {
      rawTools = await queryToolsViaHttp(key, serverCfg);
    } else if (serverCfg.command) {
      rawTools = await queryToolsViaStdio(key, serverCfg);
    } else {
      console.warn(`  [WARN] ${key}: no command or serverUrl, skipping`);
    }

    let added = 0;

    for (const t of rawTools) {
      tools.push({
        name: t.name,
        serverKey: key,
        serverTransport: transport,
        description: t.description ?? "",
        inputSchema: t.inputSchema ?? {},
        shortDesc: shortDesc(t.description),
        tip: toolTips[t.name],
      });
      added++;
    }

    servers.push({
      key,
      transport,
      disabled: isDisabled,
      toolCount: added,
    });

    console.log(`     [OK] ${added} tools collected`);
  }

  const catalog: ToolCatalog = {
    version: 1,
    builtAt: new Date().toISOString(),
    activeOnly,
    servers,
    tools,
  };

  // Persist to disk
  const outPath = path.resolve(process.cwd(), cfg.catalog.outputPath);
  await writeFile(outPath, JSON.stringify(catalog, null, 2), "utf-8");
  console.log(`\n[OK] Catalog saved: ${outPath} (${tools.length} tools)\n`);

  // Auto-update lightmcp_config.json with discovered agent paths
  try {
    const { autoPopulateConfig } = await import("../config.js");
    await autoPopulateConfig(mcpServers);
  } catch { /* skip if config write fails */ }

  return catalog;
}
