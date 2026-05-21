// ============================================================
// LightMCP — Config Loader
// ============================================================
import { readFile, writeFile, rename } from "node:fs/promises";
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
    mode: z.enum(["filtered", "full"]).default("filtered"),
  }),
  ollama: z.object({
    host: z.string().default("http://127.0.0.1:11434"),
    model: z.string().default("gemma3:4b"),
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
  mcpConfigPaths: z.array(z.string()).default([]),
  mcpServers: z.record(z.object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    serverUrl: z.string().optional(),
    disabled: z.boolean().optional(),
    disabledTools: z.array(z.string()).optional(),
  })).optional().default({}),
  alwaysOn: z.array(z.string()).optional().default([]),
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
let _configPromise: Promise<LightMCPConfig> | null = null;

export async function loadConfig(): Promise<LightMCPConfig> {
  if (_config) return _config;
  if (!_configPromise) {
    _configPromise = doLoadConfig();
  }
  return _configPromise;
}

async function doLoadConfig(): Promise<LightMCPConfig> {
  try {
    const configPath = resolveConfigPath();
    let raw: string;
    try {
      raw = await readFile(configPath, "utf-8");
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        _config = LightMCPConfigSchema.parse({ server: {}, ollama: {}, catalog: {} });
        return _config;
      }
      throw err;
    }
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
    // Normalize: merge legacy mcpConfigPath into mcpConfigPaths
    if (_config.mcpConfigPath && (!_config.mcpConfigPaths || _config.mcpConfigPaths.length === 0)) {
      const paths = parseMcpConfigPathValue(_config.mcpConfigPath);
      if (paths.length > 0) {
        _config.mcpConfigPaths = paths;
      }
    }
    // Clean up: filter out any non-MCP-config paths (.dat files, etc.)
    _config.mcpConfigPaths = (_config.mcpConfigPaths ?? []).filter(isValidConfigPath);
    return _config;
  } finally {
    _configPromise = null;
  }
}

/** Parse the legacy mcpConfigPath field (which may be a JSON-encoded array or plain path) */
function parseMcpConfigPathValue(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((p): p is string => typeof p === "string")
        .filter((p) => isValidConfigPath(p)); // filter out non-JSON config paths
    }
  } catch {
    // Not valid JSON — treat as single path
  }
  if (isValidConfigPath(value)) return [value];
  return [];
}

/** Only accept paths that look like actual MCP config files */
function isValidConfigPath(p: string): boolean {
  if (p.includes("..")) return false;
  if (p.endsWith(".dat") || p.endsWith(".db") || p.endsWith(".sqlite")) return false;
  if (!p.endsWith(".json")) return false;
  return true;
}

export function invalidateConfig(): void {
  _config = null;
  _configPromise = null;
}

/** Resolves the Antigravity agent's mcp_config.json path */
export async function resolveMcpConfigPath(cfg: LightMCPConfig): Promise<string> {
  if (cfg.mcpConfigPath) return cfg.mcpConfigPath;

  // Antigravity 2.0 uses config/mcp_config.json
  const configDir = path.join(os.homedir(), ".gemini", "config", "mcp_config.json");
  if (existsSync(path.dirname(configDir))) return configDir;

  // Antigravity 1.x standalone
  const defaultPath = path.join(os.homedir(), ".gemini", "antigravity", "mcp_config.json");
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

  // 1. Env var override (highest priority)
  const envPath = process.env.LIGHTMCP_MCP_CONFIG;
  if (envPath && existsSync(envPath)) {
    // Validate path is under user's home directory
    const homedir = os.homedir();
    const resolvedEnvPath = path.resolve(envPath);
    if (!resolvedEnvPath.startsWith(homedir + path.sep) && resolvedEnvPath !== homedir) {
      console.warn(`[WARN] $LIGHTMCP_MCP_CONFIG path outside home directory — ignored: ${envPath}`);
    } else {
      const mcp = await loadMcpConfig(envPath);
      return mcp.mcpServers;
    }
  }

  // Build merged result by cascading all sources
  const merged: Record<string, import("./types.js").MCPServerConfig> = {
    ...(cfg.mcpServers ?? {}),
  };

  // 2. Merge from explicit mcpConfigPaths
  for (const configPath of (cfg.mcpConfigPaths ?? [])) {
    if (!existsSync(configPath)) continue;
    try {
      await mergeMcpConfigServers(configPath, merged);
    } catch { /* skip unreadable configs */ }
  }

  // 3. Auto-detect agents and merge their configs
  try {
    const { detectAgents } = await import("./setup/scanner.js");
    const agents = detectAgents();

    for (const agent of agents) {
      if (!agent.configExists) continue;
      try {
        await mergeMcpConfigServers(agent.configPath, merged);
      } catch { /* skip unreadable configs */ }
    }
  } catch { /* scanner not available or no agents */ }

  if (Object.keys(merged).length > 0) return merged;

  // 4. Empty — no servers found anywhere
  console.warn("[WARN] No MCP servers found. Create a lightmcp_config.json with 'mcpServers' or install an AI agent.");
  return {};
}

/**
 * Auto-populates lightmcp_config.json with discovered agent paths and servers.
 * Called after buildCatalog() to keep the config in sync with reality.
 */
export async function autoPopulateConfig(discoveredServers: Record<string, import("./types.js").MCPServerConfig>): Promise<void> {
  const cfg = await loadConfig();
  const paths: string[] = [...(cfg.mcpConfigPaths ?? [])];

  // Collect paths from auto-detected agents
  try {
    const { detectAgents } = await import("./setup/scanner.js");
    const agents = detectAgents();
    for (const agent of agents) {
      if (agent.configExists && agent.configPath && !paths.includes(agent.configPath)) {
        paths.push(agent.configPath);
      }
    }
  } catch { /* scanner not available */ }

  // Merge with legacy mcpConfigPath
  if (cfg.mcpConfigPath) {
    const legacyPaths = parseMcpConfigPathValue(cfg.mcpConfigPath);
    for (const p of legacyPaths) {
      if (!paths.includes(p)) paths.unshift(p);
    }
  }

  // Merge discovered servers with inline servers
  const mergedServers = { ...discoveredServers, ...cfg.mcpServers };

  // Filter out non-MCP-config paths (.dat, etc.)
  const cleanPaths = paths.filter(isValidConfigPath);

  // Write updated config back to disk (atomic: tmp + rename)
  const configPath = resolveConfigPath();
  const updated = {
    ...cfg,
    mcpConfigPath: null,
    mcpConfigPaths: cleanPaths,
    mcpServers: mergedServers,
  };

  const tmpPath = configPath + ".tmp";
  await writeFile(tmpPath, JSON.stringify(updated, null, 2), "utf-8");
  await rename(tmpPath, configPath);
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

  for (const p of (cfg.mcpConfigPaths ?? [])) {
    if (existsSync(p)) paths.push(p);
  }

  // Also parse legacy mcpConfigPath for backward compat
  if (cfg.mcpConfigPath) {
    const legacyPaths = parseMcpConfigPathValue(cfg.mcpConfigPath);
    for (const p of legacyPaths) {
      if (existsSync(p) && !paths.includes(p)) paths.push(p);
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

  // Filter out non-MCP-config paths (.dat files, databases, etc.)
  const filtered = paths.filter(isValidConfigPath);
  return [...new Set(filtered)];
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

/**
 * Reads servers from both mcpServers (Antigravity/standard) and mcp (openCode)
 * formats. Converts openCode-style entries to MCPServerConfig.
 */
export async function mergeMcpConfigServers(
  configPath: string,
  merged: Record<string, import("./types.js").MCPServerConfig>
): Promise<void> {
  const raw = await readFile(configPath, "utf-8");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return; }

  const obj = parsed as Record<string, unknown>;

  // Standard format: mcpServers
  if (obj.mcpServers && typeof obj.mcpServers === "object") {
    for (const [key, val] of Object.entries(obj.mcpServers as Record<string, unknown>)) {
      const entry = val as Record<string, unknown>;
      merged[key] = {
        command: typeof entry.command === "string" ? entry.command : undefined,
        args: Array.isArray(entry.args) ? entry.args as string[] : undefined,
        env: entry.env as Record<string, string> | undefined,
        serverUrl: typeof entry.serverUrl === "string" ? entry.serverUrl : undefined,
        disabled: entry.disabled === true || undefined,
        disabledTools: Array.isArray(entry.disabledTools) ? entry.disabledTools as string[] : undefined,
      };
    }
  }

  // openCode format: mcp
  if (obj.mcp && typeof obj.mcp === "object") {
    for (const [key, val] of Object.entries(obj.mcp as Record<string, unknown>)) {
      const entry = val as Record<string, unknown>;
      merged[key] = {
        serverUrl: typeof entry.url === "string" ? entry.url : undefined,
        command: Array.isArray(entry.command) ? (entry.command as string[])[0] : undefined,
        args: Array.isArray(entry.command) ? (entry.command as string[]).slice(1) : undefined,
        disabled: entry.enabled === false || undefined,
      };
    }
  }
}
