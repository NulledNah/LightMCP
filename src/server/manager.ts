// ============================================================
// LightMCP — Server Manager
// Manages MCP servers stored in lightmcp_config.json.
// Handles add/remove/disable/enable/list and agent restore.
// ============================================================
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, invalidateConfig } from "../config.js";
import type { MCPServerConfig, LightMCPConfig } from "../types.js";
import type { DetectedAgent } from "../setup/scanner.js";

export type ListEntry = {
  name: string;
  config: MCPServerConfig;
  source: "inline" | "agent";
  agentName?: string;
  disabled: boolean;
};

async function writeConfig(cfg: LightMCPConfig | Record<string, unknown>): Promise<void> {
  const { writeFile, rename } = await import("node:fs/promises");
  const configPath = resolveConfigFilePath();
  // Atomic write: write to temp file, then rename (prevents partial writes)
  const tmpPath = configPath + ".tmp";
  await writeFile(tmpPath, JSON.stringify(cfg, null, 2), "utf-8");
  await rename(tmpPath, configPath);
  invalidateConfig();
}

export function resolveConfigFilePath(): string {
  // Walk up to find lightmcp_config.json
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, "lightmcp_config.json");
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return path.resolve(process.cwd(), "lightmcp_config.json");
}

// Lazy import to avoid circular deps
async function detectAgents(): Promise<DetectedAgent[]> {
  const { detectAgents: da } = await import("../setup/scanner.js");
  return da();
}

async function buildCatalog(): Promise<void> {
  const { buildCatalog: bc } = await import("../catalog/builder.js");
  await bc();
}

/** List all servers, grouped by source (inline / agent). Never shows lightmcp. */
export async function listServers(showDisabled = false): Promise<ListEntry[]> {
  const cfg = await loadConfig();
  const results: ListEntry[] = [];

  const seenKeys = new Set<string>();

  function serverFingerprint(name: string, serverCfg: MCPServerConfig): string {
    if (serverCfg.serverUrl) return `http:${serverCfg.serverUrl}`;
    const cmd = serverCfg.command ?? "?";
    const argStr = (serverCfg.args ?? []).join(" ");
    return `stdio:${cmd} ${argStr}`.trim();
  }

  // 1. Inline servers
  for (const [name, serverCfg] of Object.entries(cfg.mcpServers ?? {})) {
    if (name === "lightmcp") continue;
    const fp = serverFingerprint(name, serverCfg);
    if (seenKeys.has(fp)) {
      console.warn(`  [WARN] Skipping duplicate server "${name}" (same endpoint as another server)`);
      continue;
    }
    seenKeys.add(fp);
    results.push({
      name,
      config: serverCfg,
      source: "inline",
      disabled: serverCfg.disabled === true,
    });
  }

  // 2. Agent-discovered servers
  try {
    const agents = await detectAgents();
    for (const agent of agents) {
      if (!agent.configExists) continue;
      try {
        const { mergeMcpConfigServers } = await import("../config.js");
        const agentServers: Record<string, import("../types.js").MCPServerConfig> = {};
        await mergeMcpConfigServers(agent.configPath, agentServers);
        for (const [name, serverCfg] of Object.entries(agentServers)) {
          if (name === "lightmcp") continue;
          // Only add if not already in inline
          if (results.some(r => r.name === name)) continue;
          const fp = serverFingerprint(name, serverCfg);
          if (seenKeys.has(fp)) {
            console.warn(`  [WARN] Skipping duplicate agent server "${name}" (same endpoint as another server)`);
            continue;
          }
          seenKeys.add(fp);
          results.push({
            name,
            config: { ...serverCfg },
            source: "agent",
            agentName: agent.name,
            disabled: serverCfg.disabled === true,
          });
        }
        } catch { console.warn(`  [WARN] Failed to read agent config for ${agent.name} during server listing`); }
      }
    } catch { console.warn("  [WARN] Agent detection failed during server listing"); }

  return showDisabled ? results : results.filter(r => !r.disabled);
}

/** Add a server to LightMCP. Removes it from any agent that has it, saves backup. */
export async function addServer(
  name: string,
  serverCfg: MCPServerConfig
): Promise<string> {
  const cfg = await loadConfig();

  if (cfg.mcpServers?.[name] && !cfg.mcpServers[name].disabled) {
    return `[WARN] Server "${name}" already exists in LightMCP.`;
  }

  // Add to inline
  cfg.mcpServers = { ...cfg.mcpServers, [name]: serverCfg };
  await writeConfig(cfg);

  // Remove from agents and save backup
  const messages: string[] = [];
  try {
    const agents = await detectAgents();
    for (const agent of agents) {
      if (!agent.configExists) continue;
      try {
        const { loadMcpConfig } = await import("../config.js");
        const mcp = await loadMcpConfig(agent.configPath);
        if (mcp.mcpServers[name]) {
          // Save full backup before modifying
          const configDir = path.dirname(agent.configPath);
          const backupPath = path.join(configDir, "lightmcp_servers.json");
          if (!existsSync(backupPath)) {
            const fullConfig = JSON.parse(readFileSync(agent.configPath, "utf-8"));
            writeFileSync(backupPath, JSON.stringify(fullConfig, null, 2) + "\n", "utf-8");
          }

          // Remove from agent
          delete mcp.mcpServers[name];
          writeFileSync(agent.configPath, JSON.stringify(
            { mcpServers: mcp.mcpServers }, null, 2
          ) + "\n", "utf-8");

          messages.push(`removed from ${agent.name}`);
        }
      } catch { console.warn(`  [WARN] Failed to update ${agent.name} config while adding server "${name}"`); }
    }
  } catch { console.warn("  [WARN] Agent detection failed while adding server"); }

  // Clear _removed flag from any backup (server was explicitly re-added)
  try {
    for (const backupDir of [
      path.join(os.homedir(), ".gemini", "antigravity"),
      ...(await detectAgents()).map(a => path.dirname(a.configPath)),
    ]) {
      const bp = path.join(backupDir, "lightmcp_servers.json");
      if (existsSync(bp)) {
        try {
          const backup = JSON.parse(readFileSync(bp, "utf-8"));
          if (backup.mcpServers?.[name]?._removed) {
            delete backup.mcpServers[name]._removed;
            writeFileSync(bp, JSON.stringify(backup, null, 2) + "\n", "utf-8");
          }
        } catch { console.warn(`  [WARN] Failed to update backup for "${name}" in ${bp}`); }
      }
    }
  } catch { console.warn("  [WARN] Agent detection failed while clearing _removed flags"); }

  await buildCatalog();
  const agentMsg = messages.length > 0 ? ` (${messages.join(", ")})` : "";
  return `[OK] Server "${name}" added to LightMCP${agentMsg}`;
}

/** Remove a server from LightMCP. Optionally restore to its original agent. */
export async function removeServer(
  name: string,
  opts: { restore?: boolean; interactive?: boolean } = {}
): Promise<string> {
  const cfg = await loadConfig();

  if (!cfg.mcpServers?.[name]) {
    return `[ERROR] Server "${name}" not found in LightMCP.`;
  }

  // Find backup
  let ownerAgent: DetectedAgent | null = null;
  let backupPath: string | null = null;
  try {
    const agents = await detectAgents();
    for (const agent of agents) {
      const bp = path.join(path.dirname(agent.configPath), "lightmcp_servers.json");
      if (existsSync(bp)) {
        try {
          const backup = JSON.parse(readFileSync(bp, "utf-8"));
          if (backup.mcpServers?.[name]) {
            if (agent.configExists) {
              ownerAgent = agent;
              backupPath = bp;
            }
            break;
          }
        } catch { console.warn(`  [WARN] Could not read backup for ${agent.name} during server removal`); }
      }
    }
  } catch { console.warn("  [WARN] Agent detection failed during server removal"); }

  let shouldRestore = opts.restore ?? false;

  // Interactive prompt
  if (opts.interactive && !opts.restore && !Object.hasOwn(opts, "restore")) {
    // Default interactive mode: non-interactive without TTY is not great
    // Just use the presence of the opts to decide
    shouldRestore = false;
  }

  // Apply
  if (shouldRestore && ownerAgent && backupPath) {
    const backup = JSON.parse(readFileSync(backupPath, "utf-8"));
    const current = JSON.parse(readFileSync(ownerAgent.configPath, "utf-8"));
    if (!current.mcpServers) current.mcpServers = {};
    current.mcpServers[name] = backup.mcpServers[name];
    writeFileSync(ownerAgent.configPath, JSON.stringify(current, null, 2) + "\n", "utf-8");
  }

  // When deleting (not restoring), mark as removed in backups so
  // uninstall won't restore it, but catalog building won't re-add it either.
  if (!shouldRestore) {
    // Remove from detected backup
    if (backupPath && existsSync(backupPath)) {
      try {
        const backup = JSON.parse(readFileSync(backupPath, "utf-8"));
        if (backup.mcpServers?.[name]) {
          // Mark as removed rather than deleting, so uninstall can skip it
          backup.mcpServers[name] = { ...backup.mcpServers[name], _removed: true };
          writeFileSync(backupPath, JSON.stringify(backup, null, 2) + "\n", "utf-8");
        }
      } catch { /* skip — backup write failure is non-fatal */ }
    }

    // Also mark in standalone Antigravity agent backup
    const standaloneBackup = path.join(os.homedir(), ".gemini", "antigravity", "lightmcp_servers.json");
    if (existsSync(standaloneBackup) && standaloneBackup !== backupPath) {
      try {
        const backup = JSON.parse(readFileSync(standaloneBackup, "utf-8"));
        if (backup.mcpServers?.[name]) {
          backup.mcpServers[name] = { ...backup.mcpServers[name], _removed: true };
          writeFileSync(standaloneBackup, JSON.stringify(backup, null, 2) + "\n", "utf-8");
        }
      } catch { /* skip — standalone backup write failure is non-fatal */ }
    }
  }

  // Remove from LightMCP
  delete cfg.mcpServers![name];
  await writeConfig(cfg);
  await buildCatalog();

  if (shouldRestore && ownerAgent) {
    return `[OK] Server "${name}" removed from LightMCP and restored to ${ownerAgent.name}.`;
  } else if (shouldRestore) {
    return `[OK] Server "${name}" removed from LightMCP. Original agent not found — permanently deleted.`;
  } else {
    return `[OK] Server "${name}" removed from LightMCP. Backup preserved on disk.`;
  }
}

/** Toggle disabled flag on a server. */
export async function disableServer(name: string): Promise<string> {
  const cfg = await loadConfig();
  if (!cfg.mcpServers?.[name]) return `[ERROR] Server "${name}" not found.`;

  cfg.mcpServers[name] = { ...cfg.mcpServers[name], disabled: true };
  await writeConfig(cfg);
  await buildCatalog();
  return `[OK] Server "${name}" disabled.`;
}

/** Toggle disabled flag off. */
export async function enableServer(name: string): Promise<string> {
  const cfg = await loadConfig();
  if (!cfg.mcpServers?.[name]) return `[ERROR] Server "${name}" not found.`;

  cfg.mcpServers[name] = { ...cfg.mcpServers[name], disabled: false };
  await writeConfig(cfg);
  await buildCatalog();
  return `[OK] Server "${name}" enabled.`;
}

/** Full uninstall: restore all agents, clean up all artifacts. */
export async function uninstallAll(): Promise<string[]> {
  const messages: string[] = [];
  const { rm } = await import("node:fs/promises");

  // Resolve LightMCP root directory for VBS launcher cleanup
  const __modDir = path.dirname(fileURLToPath(import.meta.url));
  const lightmcpRoot = path.resolve(__modDir, "..", "..");

  // 1. Restore all agents from backups and clean up artifacts per agent
  try {
    const agents = await detectAgents();
    for (const agent of agents) {
      const configDir = path.dirname(agent.configPath);
      const bp = path.join(configDir, "lightmcp_servers.json");

      if (existsSync(bp)) {
        // Restore agent config from backup
        try {
          const backup = JSON.parse(readFileSync(bp, "utf-8"));
          // Support both new format { key, servers } and legacy { mcpServers }
          let srvKey = "mcpServers";
          let srvs = backup.servers;
          if (!srvs && backup.mcpServers) {
            srvs = backup.mcpServers;
          } else if (backup.key) {
            srvKey = backup.key;
          }
          if (srvs) {
            for (const srv of Object.keys(srvs)) {
              if (srvs[srv]?._removed) {
                delete srvs[srv];
              }
            }
          }
          const restored: Record<string, unknown> = { [srvKey]: srvs ?? {} };
          writeFileSync(agent.configPath, JSON.stringify(restored, null, 2) + "\n", "utf-8");
          messages.push(`[OK] Restored ${agent.name} to original config`);
        } catch {
          console.warn(`  [WARN] Failed to restore ${agent.name} from backup`);
        }

        // Delete the backup file now that restoration is complete
        try { await rm(bp); } catch { /* skip */ }
      } else {
        // No backup — just remove the lightmcp entry from agent config
        if (agent.configExists && agent.hasLightMCP) {
          try {
            const current = JSON.parse(readFileSync(agent.configPath, "utf-8"));
            let removed = false;
            for (const rk of ["mcp", "mcpServers"]) {
              if (current[rk] && current[rk].lightmcp) {
                delete current[rk].lightmcp;
                removed = true;
              }
            }
            if (removed) {
              writeFileSync(agent.configPath, JSON.stringify(current, null, 2) + "\n", "utf-8");
            }
            messages.push(`[OK] Removed LightMCP from ${agent.name}`);
          } catch {
            console.warn(`  [WARN] Could not update ${agent.name} config`);
          }
        }
      }

      // Clean up stale .backup file (from invalid JSON during setup)
      const backupFile = agent.configPath + ".backup";
      if (existsSync(backupFile)) {
        try { await rm(backupFile); } catch { /* skip */ }
      }

      // Clean up stale .tmp file (from interrupted atomic writes)
      const tmpFile = agent.configPath + ".tmp";
      if (existsSync(tmpFile)) {
        try { await rm(tmpFile); } catch { /* skip */ }
      }
    }

    // Clean up standalone Antigravity backup that may exist outside detected agents
    const standaloneBackup = path.join(os.homedir(), ".gemini", "antigravity", "lightmcp_servers.json");
    if (existsSync(standaloneBackup)) {
      try { await rm(standaloneBackup); } catch { /* skip */ }
    }

    // Clean up home-dir backup (Claude Code config lives in ~/.claude.json, backup is ~/lightmcp_servers.json)
    const homeBackup = path.join(os.homedir(), "lightmcp_servers.json");
    if (existsSync(homeBackup)) {
      try { await rm(homeBackup); } catch { /* skip */ }
    }
  } catch { console.warn("  [WARN] Agent detection failed during uninstall — continuing cleanup"); }

  // 2. Clean up generated files
  const cleanupFiles = ["tool_catalog.json", "tool_tips.json"];
  for (const f of cleanupFiles) {
    const fp = path.resolve(process.cwd(), f);
    if (existsSync(fp)) {
      try { await rm(fp); } catch { /* skip */ }
    }
  }

  // 3. Clean up residual lightmcp_config.json.tmp and .backup
  const configPath = resolveConfigFilePath();
  const configTmp = configPath + ".tmp";
  if (existsSync(configTmp)) {
    try { await rm(configTmp); } catch { /* skip */ }
  }
  const configBackup = configPath + ".backup";
  if (existsSync(configBackup)) {
    try { await rm(configBackup); } catch { /* skip */ }
  }

  // 4. Stop Ollama if managed
  try {
    const { stopOllama } = await import("../ollama/manager.js");
    await stopOllama();
  } catch { /* skip */ }

  // 5. Platform-specific cleanup: Windows Task Scheduler, VBS launcher, Linux systemd service
  if (process.platform === "win32") {
    try {
      const { execSync } = await import("node:child_process");
      try {
        execSync(
          `powershell -Command "Unregister-ScheduledTask -TaskName 'LightMCP_AutoStart' -Confirm:$false -ErrorAction SilentlyContinue"`,
          { stdio: "pipe", timeout: 10000 },
        );
        messages.push("[OK] Removed Windows startup task");
      } catch { /* task may not exist or we lack admin rights — non-fatal */ }

      // Remove the VBS launcher used by the scheduled task
      const vbsPath = path.join(lightmcpRoot, "start_hidden.vbs");
      if (existsSync(vbsPath)) {
        try { await rm(vbsPath); } catch { /* skip */ }
      }
    } catch { /* skip */ }
  } else {
    try {
      const { execSync } = await import("node:child_process");
      const serviceFile = path.join(os.homedir(), ".config", "systemd", "user", "lightmcp.service");
      try {
        execSync("systemctl --user disable lightmcp.service 2>/dev/null || true", { stdio: "pipe" });
        execSync("systemctl --user daemon-reload 2>/dev/null || true", { stdio: "pipe" });
        if (existsSync(serviceFile)) {
          await rm(serviceFile);
        }
        messages.push("[OK] Removed Linux systemd service");
      } catch { /* non-fatal */ }
    } catch { /* skip */ }
  }

  messages.push("[INFO] LightMCP uninstalled. Config file preserved for reinstall.");
  return messages;
}
