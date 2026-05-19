// ============================================================
// LightMCP — Agent Scanner & Configurator
// Detects installed AI agents and configures their MCP servers
// for use with LightMCP.
// ============================================================
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __agentDir = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_PATH = path.resolve(__agentDir, "..", "server", "bridge.js");

const isWindows = process.platform === "win32";
const homeDir = os.homedir();

function atomicWriteSync(filePath: string, content: string): void {
  const tmpPath = filePath + ".tmp";
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, filePath);
}

/** Resolve the lightmcp_config.json path (mirrors config.ts) */
function resolveLightMCPConfigPath(): string {
  const CONFIG_FILENAME = "lightmcp_config.json";
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return path.join(__agentDir, "..", CONFIG_FILENAME);
}

/** Resolve Antigravity MCP config path. Antigravity 2.0 uses config/mcp_config.json. */
function resolveAntigravityConfigPath(): string {
  const configDir = path.join(homeDir, ".gemini", "config", "mcp_config.json");
  const standalone = path.join(homeDir, ".gemini", "antigravity", "mcp_config.json");

  // Antigravity 2.0
  if (existsSync(path.dirname(configDir))) return configDir;

  // Antigravity 1.x standalone
  if (existsSync(path.dirname(standalone))) return standalone;

  // Fall back to IDE-managed configs
  if (isWindows) {
    const vscode = path.join(process.env.APPDATA ?? "", "Code", "User", "globalStorage", "google.antigravity", "mcp_config.json");
    if (existsSync(path.dirname(vscode))) return vscode;
  } else {
    const vscodeLinux = path.join(homeDir, ".config", "Code", "User", "globalStorage", "google.antigravity", "mcp_config.json");
    const vscodiumLinux = path.join(homeDir, ".config", "VSCodium", "User", "globalStorage", "google.antigravity", "mcp_config.json");
    if (existsSync(path.dirname(vscodeLinux))) return vscodeLinux;
    if (existsSync(path.dirname(vscodiumLinux))) return vscodiumLinux;
  }

  return configDir;
}

// ── Agent definitions ─────────────────────────────────────

interface AgentDef {
  name: string;
  description: string;
  /** Paths to check for existence (installation detection) */
  detectPaths: string[];
  /** MCP config file path */
  configPath: string;
  /** Key under which MCP servers are stored */
  mcpServersKey: string;
  /** LightMCP entry to add */
  lightMCPEntry: Record<string, unknown>;
  /** Whether the config uses "mcpServers", "mcp", or "servers" as the key */
  serverEntryStyle: "mcpServers" | "servers" | "mcp";
}

const AGENTS: AgentDef[] = [
  {
    name: "Antigravity",
    description: "Google Gemini AI IDE",
    detectPaths: (() => {
      const paths = [
        path.join(homeDir, ".gemini", "antigravity"),
      ];
      if (isWindows) {
        paths.push(
          path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Antigravity"),
          path.join(process.env.APPDATA ?? "", "Code", "User", "globalStorage", "google.antigravity"),
        );
      } else {
        paths.push(
          path.join(homeDir, ".config", "Code", "User", "globalStorage", "google.antigravity"),
          path.join(homeDir, ".config", "VSCodium", "User", "globalStorage", "google.antigravity"),
        );
      }
      return paths;
    })(),
    configPath: resolveAntigravityConfigPath(),
    mcpServersKey: "mcpServers",
    lightMCPEntry: { command: "node", args: [BRIDGE_PATH] },
    serverEntryStyle: "mcpServers",
  },
  {
    name: "Claude Code",
    description: "Anthropic Claude in terminal",
    detectPaths: [
      path.join(homeDir, ".claude.json"),
      path.join(homeDir, ".claude"),
    ],
    configPath: path.join(homeDir, ".claude.json"),
    mcpServersKey: "mcpServers",
    lightMCPEntry: { type: "http", url: "http://127.0.0.1:3131/mcp" },
    serverEntryStyle: "mcpServers",
  },
  {
    name: "openCode CLI",
    description: "openCode terminal AI agent",
    detectPaths: [
      path.join(homeDir, ".config", "opencode"),
    ],
    configPath: path.join(homeDir, ".config", "opencode", "opencode.json"),
    mcpServersKey: "mcp",
    lightMCPEntry: { type: "remote", url: "http://127.0.0.1:3131/mcp", enabled: true },
    serverEntryStyle: "mcp",
  },
  {
    name: "openCode Desktop",
    description: "openCode desktop app",
    detectPaths: (() => {
      const paths: string[] = [];
      if (isWindows) {
        // Check for the desktop app executable directory, not the data directory
        paths.push(
          path.join(process.env.LOCALAPPDATA ?? "", "Programs", "ai.opencode.desktop"),
        );
      } else {
        paths.push(
          path.join(homeDir, ".local", "share", "applications"),
        );
      }
      // Both CLI and Desktop share the same config file
      paths.push(path.join(homeDir, ".config", "opencode", "opencode.json"));
      return paths;
    })(),
    configPath: path.join(homeDir, ".config", "opencode", "opencode.json"),
    mcpServersKey: "mcp",
    lightMCPEntry: { type: "remote", url: "http://127.0.0.1:3131/mcp", enabled: true },
    serverEntryStyle: "mcp",
  },
  {
    name: "Cursor",
    description: "Cursor AI editor",
    detectPaths: [
      path.join(homeDir, ".cursor"),
    ],
    configPath: path.join(homeDir, ".cursor", "mcp.json"),
    mcpServersKey: "mcpServers",
    lightMCPEntry: { url: "http://127.0.0.1:3131/mcp" },
    serverEntryStyle: "mcpServers",
  },
];

// ── Detection ─────────────────────────────────────────────

export interface DetectedAgent {
  name: string;
  description: string;
  configPath: string;
  configExists: boolean;
  currentServerCount: number;
  hasLightMCP: boolean;
  canAutoConfigure: boolean;
  note?: string;
}

export function detectAgents(): DetectedAgent[] {
  const results: DetectedAgent[] = [];

  for (const agent of AGENTS) {
    const installed = agent.detectPaths.some((p) => existsSync(p));
    if (!installed) continue;

    const configExists = existsSync(agent.configPath);
    let currentServerCount = 0;
    let hasLightMCP = false;

    if (configExists) {
      try {
        const raw = readFileSync(agent.configPath, "utf-8");
        const cfg = JSON.parse(raw);
        const servers = cfg[agent.mcpServersKey];
        if (servers && typeof servers === "object") {
          const keys = Object.keys(servers);
          currentServerCount = keys.length;
          hasLightMCP = keys.includes("lightmcp");
        }
      } catch {
        // unreadable config, treat as configExists=true but unparseable
      }
    }

    const canAutoConfigure = !agent.configPath.endsWith(".dat");

    results.push({
      name: agent.name,
      description: agent.description,
      configPath: agent.configPath,
      configExists,
      currentServerCount,
      hasLightMCP,
      canAutoConfigure,
      ...(canAutoConfigure ? {} : { note: "Config is a binary file — manual setup required." }),
    });
  }

  return results;
}

// ── Configuration actions ─────────────────────────────────

export type ConfigureChoice = "isolate" | "add" | "manual";

function getAgentDef(name: string): AgentDef | undefined {
  return AGENTS.find((a) => a.name === name);
}

/** Apply "isolate" or "add" to a single agent's config. Returns the action taken. */
function applyToConfig(agent: AgentDef, choice: "isolate" | "add"): string {
  if (!existsSync(agent.configPath)) {
    // Create new config with just LightMCP
    const newCfg = { [agent.mcpServersKey]: { lightmcp: agent.lightMCPEntry } };
    atomicWriteSync(agent.configPath, JSON.stringify(newCfg, null, 2) + "\n");
    return "created new config with LightMCP only";
  }

  const raw = readFileSync(agent.configPath, "utf-8");
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(raw);
  } catch {
    writeFileSync(agent.configPath + ".backup", raw, "utf-8");
    const newCfg = { [agent.mcpServersKey]: { lightmcp: agent.lightMCPEntry } };
    atomicWriteSync(agent.configPath, JSON.stringify(newCfg, null, 2) + "\n");
    return "backed up invalid config, created new with LightMCP";
  }

  const servers = (cfg[agent.mcpServersKey] ?? {}) as Record<string, unknown>;

  if (choice === "isolate") {
    // Save full server list as backup (for uninstall restoration only).
    // Exclude lightmcp from the backup since it's the bridge, not a real server.
    const configDir = path.dirname(agent.configPath);
    const fullServersPath = path.join(configDir, "lightmcp_servers.json");
    const backupServers: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(servers)) {
      if (key !== "lightmcp") {
        backupServers[key] = val;
      }
    }
    writeFileSync(
      fullServersPath,
      JSON.stringify({ mcpServers: backupServers }, null, 2) + "\n",
      "utf-8"
    );

    // Also register servers in LightMCP's own inline config so
    // the catalog builder can discover them without reading the backup.
    const lightmcpConfigPath = resolveLightMCPConfigPath();
    if (existsSync(lightmcpConfigPath)) {
      try {
        const lcRaw = readFileSync(lightmcpConfigPath, "utf-8");
        const lcCfg = JSON.parse(lcRaw);
        if (!lcCfg.mcpServers) lcCfg.mcpServers = {};
        for (const key of Object.keys(backupServers)) {
          lcCfg.mcpServers[key] = backupServers[key];
        }
        atomicWriteSync(lightmcpConfigPath, JSON.stringify(lcCfg, null, 2) + "\n");
      } catch { /* config write failed, non-fatal */ }
    }

    // Replace agent config with ONLY LightMCP
    const cleanCfg = { [agent.mcpServersKey]: { lightmcp: agent.lightMCPEntry } };
    atomicWriteSync(agent.configPath, JSON.stringify(cleanCfg, null, 2) + "\n");

    const serverCount = Object.keys(backupServers).length;
    return `saved ${serverCount} server(s) to LightMCP, agent config now LightMCP-only`;
  } else {
    // Just add LightMCP
    servers.lightmcp = agent.lightMCPEntry;
    cfg[agent.mcpServersKey] = servers;
    atomicWriteSync(agent.configPath, JSON.stringify(cfg, null, 2) + "\n");
    return "added LightMCP to existing servers";
  }
}

/** Apply the user's choice to all detected agents. */
export function configureAllAgents(
  choice: ConfigureChoice,
  agents: DetectedAgent[]
): string[] {
  const results: string[] = [];

  for (const detected of agents) {
    if (!detected.canAutoConfigure) {
      results.push(`[${detected.name}] SKIPPED: ${detected.note}`);
      continue;
    }
    if (choice === "manual") {
      results.push(`[${detected.name}] Manual setup — see instructions below.`);
      continue;
    }

    const agent = getAgentDef(detected.name);
    if (!agent) continue;

    try {
      const msg = applyToConfig(agent, choice);
      results.push(`[${detected.name}] ${msg}`);
    } catch (err) {
      results.push(`[${detected.name}] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return results;
}

/** Generate manual setup instructions for all detected agents. */
export function generateManualInstructions(agents: DetectedAgent[]): string {
  const lines: string[] = [];
  lines.push("\n── Manual Setup Instructions ─────────────────────────────\n");

  for (const detected of agents) {
    const agent = getAgentDef(detected.name);
    if (!agent) continue;

    lines.push(`  • ${agent.name} (${agent.description})`);
    lines.push(`    Config file: ${agent.configPath}`);
    lines.push(`    Add this entry under "${agent.mcpServersKey}":`);
    lines.push(`    ${JSON.stringify({ lightmcp: agent.lightMCPEntry }, null, 2).replace(/\n/g, "\n    ")}`);
    lines.push("");
  }

  lines.push("  After editing, restart the agent for changes to take effect.");
  lines.push("─────────────────────────────────────────────────────────\n");

  return lines.join("\n");
}
