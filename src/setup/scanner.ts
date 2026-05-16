// ============================================================
// LightMCP — Agent Scanner & Configurator
// Detects installed AI agents and configures their MCP servers
// for use with LightMCP.
// ============================================================
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __agentDir = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_PATH = path.resolve(__agentDir, "..", "server", "bridge.js");

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

/** Resolve Antigravity MCP config path (standalone vs VS Code extension install) */
function resolveAntigravityConfigPath(): string {
  const standalone = path.join(os.homedir(), ".gemini", "antigravity", "mcp_config.json");
  const vscode = path.join(process.env.APPDATA ?? "", "Code", "User", "globalStorage", "google.antigravity", "mcp_config.json");
  // Prefer VS Code path if the directory exists (most common for current Antigravity)
  if (existsSync(path.dirname(vscode))) return vscode;
  if (existsSync(path.dirname(standalone))) return standalone;
  return vscode; // default to VS Code path
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
  serverEntryStyle: "mcpServers" | "mcp" | "servers";
}

const AGENTS: AgentDef[] = [
  {
    name: "Antigravity",
    description: "Google Gemini AI IDE",
    detectPaths: [
      path.join(os.homedir(), ".gemini", "antigravity"),
      path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Antigravity"),
      path.join(process.env.APPDATA ?? "", "Code", "User", "globalStorage", "google.antigravity"),
    ],
    configPath: resolveAntigravityConfigPath(),
    mcpServersKey: "mcpServers",
    lightMCPEntry: { command: "node", args: [BRIDGE_PATH] },
    serverEntryStyle: "mcpServers",
  },
  {
    name: "Claude Code",
    description: "Anthropic Claude in terminal",
    detectPaths: [
      path.join(os.homedir(), ".claude.json"),
      path.join(os.homedir(), ".claude"),
    ],
    configPath: path.join(os.homedir(), ".claude.json"),
    mcpServersKey: "mcpServers",
    lightMCPEntry: { type: "http", url: "http://127.0.0.1:3131/mcp" },
    serverEntryStyle: "mcpServers",
  },
  {
    name: "openCode CLI",
    description: "openCode terminal AI agent",
    detectPaths: [
      path.join(os.homedir(), ".config", "opencode", "opencode.json"),
      path.join(os.homedir(), ".config", "opencode"),
    ],
    configPath: path.join(os.homedir(), ".config", "opencode", "opencode.json"),
    mcpServersKey: "mcp",
    lightMCPEntry: { type: "remote", url: "http://127.0.0.1:3131/mcp", enabled: true },
    serverEntryStyle: "mcp",
  },
  {
    name: "openCode Desktop",
    description: "openCode desktop app",
    detectPaths: [
      path.join(process.env.APPDATA ?? "", "ai.opencode.desktop"),
    ],
    configPath: path.join(os.homedir(), ".config", "opencode", "opencode.json"),
    mcpServersKey: "mcp",
    lightMCPEntry: { type: "remote", url: "http://127.0.0.1:3131/mcp", enabled: true },
    serverEntryStyle: "mcp",
  },
  {
    name: "Cursor",
    description: "Cursor AI editor",
    detectPaths: [
      path.join(os.homedir(), ".cursor"),
    ],
    configPath: path.join(os.homedir(), ".cursor", "mcp.json"),
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
  mcpServersKey: string;
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
      mcpServersKey: agent.mcpServersKey,
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
    writeFileSync(agent.configPath, JSON.stringify(newCfg, null, 2) + "\n", "utf-8");
    return "created new config with LightMCP only";
  }

  const raw = readFileSync(agent.configPath, "utf-8");
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(raw);
  } catch {
    writeFileSync(agent.configPath + ".backup", raw, "utf-8");
    const newCfg = { [agent.mcpServersKey]: { lightmcp: agent.lightMCPEntry } };
    writeFileSync(agent.configPath, JSON.stringify(newCfg, null, 2) + "\n", "utf-8");
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
        writeFileSync(lightmcpConfigPath, JSON.stringify(lcCfg, null, 2) + "\n", "utf-8");
      } catch { /* config write failed, non-fatal */ }
    }

    // Replace agent config with ONLY LightMCP
    const cleanCfg = { [agent.mcpServersKey]: { lightmcp: agent.lightMCPEntry } };
    writeFileSync(agent.configPath, JSON.stringify(cleanCfg, null, 2) + "\n", "utf-8");

    const serverCount = Object.keys(backupServers).length;
    return `saved ${serverCount} server(s) to LightMCP, agent config now LightMCP-only`;
  } else {
    // Just add LightMCP
    servers.lightmcp = agent.lightMCPEntry;
    cfg[agent.mcpServersKey] = servers;
    writeFileSync(agent.configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
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
