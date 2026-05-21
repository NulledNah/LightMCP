#!/usr/bin/env node
// ============================================================
// LightMCP — CLI Entry Point
// Commands: start | build-catalog | status | test | setup
//            get-tools | call | configure | generate-tips
//            server | uninstall | default
// ============================================================
import { Command } from "commander";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getVersion } from "../version.js";
import { checkNodeVersion } from "../utils.js";

// Load .env silently — no stdout pollution (MCP protocol requires clean stdout)
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ quiet: true });

checkNodeVersion();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const version = await getVersion();

const program = new Command();

program
  .name("lightmcp")
  .description(
    "LightMCP — semantic MCP tool router powered by a local LLM.\n" +
    "Semantic MCP tool routing — keep only the tools your agent needs for each task."
  )
  .version(version);

// ── lightmcp start ───────────────────────────────────────────
program
  .command("start")
  .description("Start the LightMCP MCP router server")
  .option("--stdio", "Start in STDIO mode (for agents that spawn LightMCP as a child process)")
  .option("--no-watch", "Disable mcp_config.json file watcher")
  .option("--mode <mode>", "Server mode: 'filtered' (default, LLM selects tools) or 'full' (all tools visible)")
  .action(async (opts) => {
    const { startAction } = await import("./commands/start.js");
    await startAction(opts);
  });

// ── lightmcp build-catalog ───────────────────────────────────
program
  .command("build-catalog")
  .description("Build (or rebuild) the tool catalog from all MCP servers")
  .option("--active-only", "Only include tools from active (non-disabled) servers")
  .action(async (opts) => {
    const { buildCatalogAction } = await import("./commands/build_catalog.js");
    await buildCatalogAction(opts);
  });

// ── lightmcp status ──────────────────────────────────────────
program
  .command("status")
  .description("Show LightMCP status: server, Ollama, catalog")
  .action(async () => {
    const { statusAction } = await import("./commands/status_command.js");
    await statusAction();
  });

// ── lightmcp test ────────────────────────────────────────────
program
  .command("test <task>")
  .description("Test tool routing locally without starting the MCP server")
  .option("--hints <hints>", "Comma-separated hints", "")
  .action(async (task: string, opts: { hints: string }) => {
    const { testAction } = await import("./commands/test.js");
    await testAction(task, opts);
  });

// ── lightmcp get-tools ─────────────────────────────────────
program
  .command("get-tools <task>")
  .description("Get relevant tools for a task via semantic LLM selection")
  .option("--hints <hints>", "Comma-separated hints", "")
  .action(async (task: string, opts: { hints: string }) => {
    const { getToolsAction } = await import("./commands/get_tools.js");
    await getToolsAction(task, opts);
  });

// ── lightmcp call ──────────────────────────────────────────
program
  .command("call <tool>")
  .description("Call a tool through LightMCP (forwards to the real MCP server)")
  .argument("[json_or_key=value...]", "JSON arguments or key=value pairs for the tool")
  .option("--file <path>", "Read tool arguments from a JSON file")
  .option("--output <path>", "Save image results to file (auto-decodes base64)")
  .allowUnknownOption()
  .action(async (firstArg: string, rawArgs: string[], opts: { file?: string; output?: string }) => {
    const { callAction } = await import("./commands/call.js");
    await callAction(firstArg, rawArgs, opts);
  });

// ── lightmcp setup ───────────────────────────────────────────
program
  .command("setup")
  .description(
    "Install Ollama, pull the model, build catalog, and configure AI agents"
  )
  .action(async () => {
    const { setupAction } = await import("./commands/setup.js");
    await setupAction();
  });

// ── lightmcp configure ─────────────────────────────────────
program
  .command("configure")
  .description("Re-run AI agent MCP configuration (scan, isolate/add/manual)")
  .action(async () => {
    const { configureAction } = await import("./commands/configure.js");
    await configureAction();
  });

// ── lightmcp generate-tips ──────────────────────────────────
program
  .command("generate-tips")
  .description("Generate usage tips for each tool via local LLM (one call per tool, zero cross-contamination)")
  .option("--server <key>", "Only generate tips for a specific server")
  .option("--overwrite", "Overwrite existing tips (default: skip tools that already have tips)")
  .action(async (opts: { server?: string; overwrite?: boolean }) => {
    const { generateTipsAction } = await import("./commands/generate_tips.js");
    await generateTipsAction(opts);
  });

// ── lightmcp server ─────────────────────────────────────────
program
  .command("server <action> [name]")
  .description("Manage MCP servers: add, remove, list, disable, enable")
  .option("--command <cmd>", "Command to run (for add)")
  .option("--args <args>", "Arguments (space-separated, for add)")
  .option("--server-url <url>", "Server URL (for add)")
  .option("--env <vars>", "Environment variables (comma-separated KEY=VALUE, for add)")
  .option("--action <mode>", "restore or delete (for remove, skips prompt)")
  .option("--all", "Show disabled servers too (for list)")
  .action(async (action: string, name: string | undefined, opts: any) => {
    const { serverCommand } = await import("./commands/server.js");
    await serverCommand(action as any, name, opts);
  });

// ── lightmcp uninstall ──────────────────────────────────────
program
  .command("uninstall")
  .description("Restore agent configs and remove LightMCP")
  .action(async () => {
    const { uninstallCommand } = await import("./commands/uninstall.js");
    await uninstallCommand();
  });

// ── lightmcp generate-uninstall-script ──────────────────────
program
  .command("generate-uninstall-script")
  .description("Regenerate the standalone uninstall script (~/.lightmcp/uninstall.cjs)")
  .action(async () => {
    const { generateUninstallScript } = await import("../setup/uninstall_script.js");
    const { detectAgents } = await import("../setup/scanner.js");
    const { resolveConfigPath } = await import("../server/manager.js");
    const { fileURLToPath } = await import("node:url");

    const __modDir = path.dirname(fileURLToPath(import.meta.url));
    const agents = detectAgents();
    const cfgPath = resolveConfigPath();
    const lmRoot = path.resolve(__modDir, "..", "..");

    const scriptPath = generateUninstallScript(agents, cfgPath, lmRoot);
    console.log(`\n[OK] Uninstall script regenerated: ${scriptPath}`);
    console.log("  To uninstall: node ~/.lightmcp/uninstall.cjs\n");
  });

// ── Default: treat unknown args as "call <tool> [args...]" ─
program.action(async (...args: (string | unknown)[]) => {
  const { defaultAction } = await import("./commands/default_handler.js");
  await defaultAction(...args);
});

program.parse(process.argv);
