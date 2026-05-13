// ============================================================
// LightMCP — Config Loader
// ============================================================
import { readFile } from "node:fs/promises";
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
