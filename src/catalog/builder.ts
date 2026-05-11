// ============================================================
// LightMCP — Tool Catalog Builder
// Connects to each MCP server and collects tool definitions.
// ============================================================
import { spawn, type ChildProcess } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { loadMcpConfig, resolveMcpConfigPath, loadConfig } from "../config.js";
import type {
  MCPServerConfig,
  ToolCatalog,
  ToolEntry,
  CatalogServer,
} from "../types.js";

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
  const env = { ...process.env, ...(cfg.env ?? {}) };

  return new Promise((resolve, reject) => {
    const proc: ChildProcess = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        // Timeout is not fatal — return empty
        console.warn(`  [warn] ${serverKey}: stdio timeout, skipping`);
        resolve([]);
      }
    }, timeoutMs);

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      // Try to parse each newline-delimited JSON-RPC response
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          if (msg.id === 2 && msg.result) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              proc.kill();
              const tools =
                (msg.result as { tools?: ToolsDef[] }).tools ?? [];
              resolve(tools);
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
        console.warn(`  [warn] ${serverKey}: spawn error — ${err.message}`);
        resolve([]);
      }
    });

    proc.on("close", () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
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
        clientInfo: { name: "lightmcp-builder", version: "0.1.0" },
      },
    });

    // Small delay to let the server initialize before we list tools
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
          clientInfo: { name: "lightmcp-builder", version: "0.1.0" },
        },
      }),
      signal: controller.signal,
    });

    // Extract session ID if present (MCP Streamable HTTP spec)
    const sessionId = initRes.headers.get("mcp-session-id") ?? undefined;

    // 2. tools/list
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;

    const listRes = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    const contentType = listRes.headers.get("content-type") ?? "";
    let data: JsonRpcResponse;

    if (contentType.includes("text/event-stream")) {
      // Parse SSE stream — pick the first data event
      const text = await listRes.text();
      const dataLine = text
        .split("\n")
        .find((l) => l.startsWith("data:"));
      if (!dataLine) return [];
      data = JSON.parse(dataLine.slice(5).trim()) as JsonRpcResponse;
    } else {
      data = (await listRes.json()) as JsonRpcResponse;
    }

    return (data.result as { tools?: ToolsDef[] })?.tools ?? [];
  } catch (err: unknown) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  [warn] ${serverKey}: HTTP error — ${msg}`);
    return [];
  }
}

// ── Main builder ─────────────────────────────────────────────

function shortDesc(desc: string | undefined): string {
  if (!desc) return "";
  return desc.length > 100 ? desc.slice(0, 97) + "…" : desc;
}

export async function buildCatalog(opts: {
  activeOnly?: boolean;
} = {}): Promise<ToolCatalog> {
  const cfg = await loadConfig();
  const mcpConfigPath = await resolveMcpConfigPath(cfg);
  const mcpConfig = await loadMcpConfig(mcpConfigPath);

  const activeOnly = opts.activeOnly ?? cfg.catalog.activeOnly;
  const tools: ToolEntry[] = [];
  const servers: CatalogServer[] = [];

  console.log(
    `\n📂 Building catalog from: ${mcpConfigPath}` +
    (activeOnly ? " [active-only]" : " [all tools]")
  );

  for (const [key, serverCfg] of Object.entries(mcpConfig.mcpServers)) {
    const isDisabled = serverCfg.disabled === true;
    if (activeOnly && isDisabled) {
      console.log(`  ⏭  ${key} — skipped (disabled)`);
      continue;
    }

    const transport: "stdio" | "http" = serverCfg.serverUrl ? "http" : "stdio";
    console.log(`  🔌 ${key} [${transport}]${isDisabled ? " (disabled)" : ""}…`);

    let rawTools: ToolsDef[] = [];

    if (transport === "http") {
      rawTools = await queryToolsViaHttp(key, serverCfg);
    } else if (serverCfg.command) {
      rawTools = await queryToolsViaStdio(key, serverCfg);
    } else {
      console.warn(`  [warn] ${key}: no command or serverUrl, skipping`);
    }

    const disabledTools = new Set(serverCfg.disabledTools ?? []);
    let added = 0;

    for (const t of rawTools) {
      // Skip tools explicitly disabled in config
      if (disabledTools.has(t.name)) continue;

      tools.push({
        name: t.name,
        serverKey: key,
        serverTransport: transport,
        description: t.description ?? "",
        inputSchema: t.inputSchema ?? {},
        shortDesc: shortDesc(t.description),
      });
      added++;
    }

    servers.push({
      key,
      transport,
      disabled: isDisabled,
      toolCount: added,
    });

    console.log(`     ✔ ${added} tools collected`);
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
  console.log(`\n✅ Catalog saved: ${outPath} (${tools.length} tools)\n`);

  return catalog;
}
