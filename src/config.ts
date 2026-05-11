// ============================================================
// LightMCP — Config Loader
// ============================================================
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { LightMCPConfig, MCPConfig } from "./types.js";

const CONFIG_FILENAME = "lightmcp_config.json";

function resolveConfigPath(): string {
  // Walk up from CWD to find lightmcp_config.json
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  // Fallback: beside the executable
  return path.join(path.dirname(process.execPath), CONFIG_FILENAME);
}

let _config: LightMCPConfig | null = null;

export async function loadConfig(): Promise<LightMCPConfig> {
  if (_config) return _config;
  const configPath = resolveConfigPath();
  const raw = await readFile(configPath, "utf-8");
  _config = JSON.parse(raw) as LightMCPConfig;
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

export async function loadMcpConfig(mcpConfigPath: string): Promise<MCPConfig> {
  const raw = await readFile(mcpConfigPath, "utf-8");
  return JSON.parse(raw) as MCPConfig;
}
