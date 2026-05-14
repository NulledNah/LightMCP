// ============================================================
// LightMCP — Config Loader
// ============================================================
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { z } from "zod";
import type { LightMCPConfig, MCPConfig } from "./types.js";

const CONFIG_FILENAME = "lightmcp_config.json";

const LightMCPConfigSchema = z.object({
  server: z.object({
    port: z.number().int().min(1).max(65535).default(3131),
    host: z.string().default("127.0.0.1"),
    idleTimeoutSeconds: z.number().int().min(0).default(0),
  }),
  ollama: z.object({
    host: z.string().default("http://127.0.0.1:11434"),
    model: z.string().default("qwen2.5-coder:7b-instruct"),
    idleTimeoutSeconds: z.number().int().min(1).default(120),
    startupTimeoutSeconds: z.number().int().min(1).default(30),
    maxRetries: z.number().int().min(0).default(2),
  }),
  catalog: z.object({
    activeOnly: z.boolean().default(false),
    outputPath: z.string().default("tool_catalog.json"),
    watchMcpConfig: z.boolean().default(true),
  }),
  mcpConfigPath: z.string().nullable().default(null),
  mcpServers: z.record(z.object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    serverUrl: z.string().optional(),
    disabled: z.boolean().optional(),
    disabledTools: z.array(z.string()).optional(),
  })).optional().default({}),
});

function resolveConfigPath(): string {
  // Walk up from CWD to find lightmcp_config.json
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  // Fallback: beside the current module
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", CONFIG_FILENAME);
}

let _config: LightMCPConfig | null = null;

export async function loadConfig(): Promise<LightMCPConfig> {
  if (_config) return _config;
  const configPath = resolveConfigPath();
  const raw = await readFile(configPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse ${CONFIG_FILENAME}: invalid JSON`);
  }
  const result = LightMCPConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid ${CONFIG_FILENAME}: ${result.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("; ")}`
    );
  }
  _config = result.data;
  return _config;
}

export function invalidateConfig(): void {
  _config = null;
}

/** Resolves the Antigravity mcp_config.json path */
export async function resolveMcpConfigPath(cfg: LightMCPConfig): Promise<string> {
  if (cfg.mcpConfigPath) return cfg.mcpConfigPath;

  // Standard Antigravity location: %USERPROFILE%\.gemini\antigravity\mcp_config.json
  const defaultPath = path.join(
    os.homedir(),
    ".gemini",
    "antigravity",
    "mcp_config.json"
  );
  if (existsSync(defaultPath)) return defaultPath;

  throw new Error(
    `Cannot find mcp_config.json. Set "mcpConfigPath" in ${CONFIG_FILENAME}.`
  );
}

/**
 * Resolves the full mcpServers map using cascading sources:
 *  1. $LIGHTMCP_MCP_CONFIG env var → read that file
 *  2. mcpServers inline in lightmcp_config.json
 *  3. mcpConfigPath → read agent's mcp_config.json
 *  4. detectAgents() → read each detected agent's config → merge
 *  5. Empty fallback (no crash)
 */
export async function resolveMcpServers(): Promise<Record<string, import("./types.js").MCPServerConfig>> {
  const cfg = await loadConfig();

  // 1. Env var override
  const envPath = process.env.LIGHTMCP_MCP_CONFIG;
  if (envPath && existsSync(envPath)) {
    const mcp = await loadMcpConfig(envPath);
    return mcp.mcpServers;
  }

  // 2. Inline servers in lightmcp_config.json
  if (cfg.mcpServers && Object.keys(cfg.mcpServers).length > 0) {
    return cfg.mcpServers;
  }

  // 3. Agent's mcp_config.json
  if (cfg.mcpConfigPath) {
    try {
      const mcp = await loadMcpConfig(cfg.mcpConfigPath);
      return mcp.mcpServers;
    } catch { /* fall through */ }
  }

  // 4. Auto-detect agents and merge their configs
  try {
    const { detectAgents } = await import("./setup/scanner.js");
    const agents = detectAgents();
    const merged: Record<string, import("./types.js").MCPServerConfig> = {};

    for (const agent of agents) {
      if (!agent.configExists) continue;
      try {
        const mcp = await loadMcpConfig(agent.configPath);
        Object.assign(merged, mcp.mcpServers);
      } catch { /* skip unreadable configs */ }
    }

    if (Object.keys(merged).length > 0) return merged;
  } catch { /* scanner not available or no agents */ }

  // 5. Empty — no servers found anywhere
  console.warn("[WARN] No MCP servers found. Create a lightmcp_config.json with 'mcpServers' or install an AI agent.");
  return {};
}

/**
 * Auto-populates lightmcp_config.json with discovered agent paths and servers.
 * Called after buildCatalog() to keep the config in sync with reality.
 */
export async function autoPopulateConfig(discoveredServers: Record<string, import("./types.js").MCPServerConfig>): Promise<void> {
  const cfg = await loadConfig();
  const paths: string[] = [];

  // Collect paths from auto-detected agents
  try {
    const { detectAgents } = await import("./setup/scanner.js");
    const agents = detectAgents();
    for (const agent of agents) {
      if (agent.configExists && agent.configPath) {
        paths.push(agent.configPath);
      }
    }
  } catch { /* scanner not available */ }

  // Merge with user-specified path
  if (cfg.mcpConfigPath) {
    paths.unshift(cfg.mcpConfigPath);
  }

  // Merge discovered servers with inline servers
  const mergedServers = { ...discoveredServers, ...cfg.mcpServers };

  // Write updated config back to disk
  const configPath = resolveConfigPath();
  const updated = {
    ...cfg,
    mcpConfigPath: paths.length > 0 ? paths.join(path.delimiter) : null,
    mcpServers: mergedServers,
  };

  await writeFile(configPath, JSON.stringify(updated, null, 2), "utf-8");
  // Invalidate cached config so next loadConfig() picks up the changes
  invalidateConfig();
  console.log(`  [INFO] Auto-configured ${paths.length} agent path(s), ${Object.keys(mergedServers).length} server(s)`);
}

/**
 * Resolves all paths that the watcher should monitor.
 * Returns deduplicated list of agent config file paths.
 */
export async function resolveWatchPaths(): Promise<string[]> {
  const cfg = await loadConfig();
  const paths: string[] = [];

  if (cfg.mcpConfigPath) {
    // Could be a single path or path.delimiter-joined list
    for (const p of cfg.mcpConfigPath.split(path.delimiter)) {
      const trimmed = p.trim();
      if (trimmed && existsSync(trimmed)) paths.push(trimmed);
    }
  }

  // Also check auto-detected agents (in case config is stale)
  try {
    const { detectAgents } = await import("./setup/scanner.js");
    const agents = detectAgents();
    for (const agent of agents) {
      if (agent.configExists && agent.configPath && !paths.includes(agent.configPath)) {
        paths.push(agent.configPath);
      }
    }
  } catch { /* scanner not available */ }

  return [...new Set(paths)];
}

export async function loadMcpConfig(mcpConfigPath: string): Promise<MCPConfig> {
  const raw = await readFile(mcpConfigPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse ${mcpConfigPath}: invalid JSON`);
  }
  const McpConfigSchema = z.object({
    mcpServers: z.record(z.object({
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string()).optional(),
      serverUrl: z.string().optional(),
      disabled: z.boolean().optional(),
      disabledTools: z.array(z.string()).optional(),
    })),
  });
  const result = McpConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid mcp_config.json: ${result.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("; ")}`
    );
  }
  return result.data;
}
