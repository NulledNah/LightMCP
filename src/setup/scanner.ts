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
  /** Whether the config uses "mcpServers" or "servers" as the key */
  serverEntryStyle: "mcpServers" | "servers";
}

const AGENTS: AgentDef[] = [
  {
    name: "Antigravity",
    description: "Google Gemini AI IDE",
    detectPaths: [
      path.join(os.homedir(), ".gemini", "antigravity"),
      path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Antigravity"),
    ],
    configPath: path.join(os.homedir(), ".gemini", "antigravity", "mcp_config.json"),
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
      path.join(os.homedir(), ".opencode.json"),
    ],
    configPath: path.join(os.homedir(), ".opencode.json"),
    mcpServersKey: "mcpServers",
    lightMCPEntry: { type: "sse", url: "http://127.0.0.1:3131/mcp" },
    serverEntryStyle: "mcpServers",
  },
  {
    name: "openCode Desktop",
    description: "openCode desktop app",
    detectPaths: [
      path.join(process.env.APPDATA ?? "", "ai.opencode.desktop"),
    ],
    configPath: path.join(process.env.APPDATA ?? "", "ai.opencode.desktop", "opencode.global.dat"),
    mcpServersKey: "mcpServers",
    lightMCPEntry: { type: "sse", url: "http://127.0.0.1:3131/mcp" },
    serverEntryStyle: "mcpServers",
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
    // Save full server list for LightMCP internal use
    const configDir = path.dirname(agent.configPath);
    const fullServersPath = path.join(configDir, "lightmcp_servers.json");
    writeFileSync(
      fullServersPath,
      JSON.stringify(cfg, null, 2) + "\n",
      "utf-8"
    );

    // Replace agent config with ONLY LightMCP
    const cleanCfg = { [agent.mcpServersKey]: { lightmcp: agent.lightMCPEntry } };
    writeFileSync(agent.configPath, JSON.stringify(cleanCfg, null, 2) + "\n", "utf-8");

    const serverCount = Object.keys(servers).filter(k => k !== "lightmcp").length;
    return `saved full server list to ${fullServersPath}, agent config now LightMCP-only (was ${serverCount} servers)`;
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
