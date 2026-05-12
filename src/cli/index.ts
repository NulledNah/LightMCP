#!/usr/bin/env node
// ============================================================
// LightMCP — CLI Entry Point
// Commands: start | build-catalog | status | test | setup
// ============================================================
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env silently — no stdout pollution (MCP protocol requires clean stdout)
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ quiet: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(__dirname, "../../package.json");

let version = "0.1.0";
try {
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as { version: string };
  version = pkg.version;
} catch {
  console.warn("[WARN] Could not read package.json, using fallback version.");
}

const program = new Command();

program
  .name("lightmcp")
  .description(
    "LightMCP — semantic MCP tool router powered by a local LLM.\n" +
    "Bypass the 100-tool limit and reduce context usage in Antigravity."
  )
  .version(version);

// ── lightmcp start ───────────────────────────────────────────
program
  .command("start")
  .description("Start the LightMCP MCP router server")
  .option("--no-watch", "Disable mcp_config.json file watcher")
  .action(async (opts) => {
    const { startServer } = await import("../server/mcp_server.js");
    const { buildCatalog } = await import("../catalog/builder.js");
    const { getCatalogTools } = await import("../catalog/loader.js");
    const { startCatalogWatcher } = await import("../catalog/watcher.js");
    const { loadConfig } = await import("../config.js");

    const cfg = await loadConfig();
    const outPath = path.resolve(process.cwd(), cfg.catalog.outputPath);

    // Build catalog on startup if missing
    if (!existsSync(outPath)) {
      console.log("[INFO] No catalog found - building now...");
      await buildCatalog();
    } else {
      const tools = await getCatalogTools();
      console.log(`[INFO] Catalog loaded: ${tools.length} tools`);
    }

    // Start file watcher
    if (opts.watch) {
      await startCatalogWatcher();
    }

    await startServer();
  });

// ── lightmcp build-catalog ───────────────────────────────────
program
  .command("build-catalog")
  .description("Build (or rebuild) the tool catalog from all MCP servers")
  .option("--active-only", "Only include tools from active (non-disabled) servers")
  .action(async (opts) => {
    const { buildCatalog } = await import("../catalog/builder.js");
    await buildCatalog({ activeOnly: opts.activeOnly });
  });

// ── lightmcp status ──────────────────────────────────────────
program
  .command("status")
  .description("Show LightMCP status: server, Ollama, catalog")
  .action(async () => {
    const { loadConfig } = await import("../config.js");
    const { getCatalogMeta } = await import("../catalog/loader.js");
    const { pingOllama } = await import("../ollama/manager.js");

    const cfg = await loadConfig();
    const meta = await getCatalogMeta();
    const ollamaAlive = await pingOllama(cfg.ollama.host);

    console.log("\n── LightMCP Status ──────────────────────────────");
    console.log(`  Server port:   ${cfg.server.port}`);
    console.log(`  Ollama:        ${ollamaAlive ? "[OK] running" : "[INFO] stopped"} (${cfg.ollama.host})`);
    console.log(`  Model:         ${cfg.ollama.model}`);
    if (meta) {
      console.log(`  Catalog:       [OK] ${meta.toolCount} tools across ${meta.serverCount} servers`);
      console.log(`  Built at:      ${new Date(meta.builtAt).toLocaleString()}`);
      console.log(`  Active-only:   ${meta.activeOnly}`);
    } else {
      console.log("  Catalog:       [WARN] not built (run: lightmcp build-catalog)");
    }
    console.log("─────────────────────────────────────────────────\n");
  });

// ── lightmcp test ────────────────────────────────────────────
program
  .command("test <task>")
  .description("Test tool routing locally without starting the MCP server")
  .option("--hints <hints>", "Comma-separated hints", "")
  .action(async (task: string, opts: { hints: string }) => {
    const { getCatalogTools } = await import("../catalog/loader.js");
    const { buildCatalog } = await import("../catalog/builder.js");
    const { ensureOllamaReady, stopOllama } = await import("../ollama/manager.js");
    const { selectTools } = await import("../ollama/client.js");

    let catalog = await getCatalogTools();
    if (catalog.length === 0) {
      console.log("[INFO] No catalog found - building first...");
      const built = await buildCatalog();
      catalog = built.tools;
    }

    const hints = opts.hints ? opts.hints.split(",").map((h) => h.trim()) : [];

    console.log(`\n[INFO] Task: "${task}"`);
    console.log(`[INFO] Catalog: ${catalog.length} tools\n`);

    await ensureOllamaReady();

    try {
      const selected = await selectTools(task, catalog, hints);
      const validTools = catalog.filter((t) => selected.includes(t.name));

      console.log(`\n[OK] Selected ${validTools.length} tools:\n`);
      for (const t of validTools) {
        console.log(`  • [${t.serverKey}] ${t.name}`);
        console.log(`    ${t.shortDesc}`);
      }

      if (selected.length > validTools.length) {
        const invalid = selected.filter(
          (n) => !catalog.some((t) => t.name === n)
        );
        console.log(
          `\n[WARN] ${invalid.length} hallucinated names (ignored): ${invalid.join(", ")}`
        );
      }
    } finally {
      await stopOllama();
    }
  });

// ── lightmcp get-tools ─────────────────────────────────────
program
  .command("get-tools <task>")
  .description("Get relevant tools for a task via semantic LLM selection")
  .option("--hints <hints>", "Comma-separated hints", "")
  .action(async (task: string, opts: { hints: string }) => {
    const { getCatalogTools } = await import("../catalog/loader.js");
    const { buildCatalog } = await import("../catalog/builder.js");
    const { ensureOllamaReady, stopOllama } = await import("../ollama/manager.js");
    const { selectTools } = await import("../ollama/client.js");

    let catalog = await getCatalogTools();
    if (catalog.length === 0) {
      const built = await buildCatalog();
      catalog = built.tools;
    }

    const hints = opts.hints ? opts.hints.split(",").map((h) => h.trim()) : [];

    await ensureOllamaReady();

    try {
      const selected = await selectTools(task, catalog, hints);
      const validTools = catalog.filter((t) => selected.includes(t.name));

      // Output: one tool per line in a clean format
      for (const t of validTools) {
        console.log(`${t.name} [${t.serverKey}] ${t.shortDesc}`);
      }
    } finally {
      await stopOllama();
    }
  });

// ── lightmcp call ──────────────────────────────────────────
program
  .command("call <tool>")
  .description("Call a tool through LightMCP (forwards to the real MCP server)")
  .argument("[json_or_key=value...]", "JSON arguments or key=value pairs for the tool")
  .allowUnknownOption()
  .action(async (firstArg: string, rawArgs: string[]) => {
    const { loadConfig } = await import("../config.js");
    const cfg = await loadConfig();
    const url = `http://${cfg.server.host}:${cfg.server.port}/mcp`;

    // Antigravity may prefix with server key: lightmcp call kicad search_footprints --query "x"
    // Skip the server key if the firstArg looks like a server name, and use the next arg as tool
    let tool = firstArg;
    let argsStart = 0;
    const knownServers = ["kicad", "chrome-devtools-mcp", "sequential-thinking", "autodesk-fusion", "google-developer-knowledge"];
    if (rawArgs.length > 0 && knownServers.includes(firstArg)) {
      tool = rawArgs[0];
      argsStart = 1;
    }

    let toolArgs: Record<string, unknown> = {};
    const effectiveArgs = rawArgs.slice(argsStart);

    if (effectiveArgs.length === 1) {
      // Try parse as JSON, fallback to { input: text }
      try {
        toolArgs = JSON.parse(effectiveArgs[0]);
      } catch {
        toolArgs = { input: effectiveArgs[0] };
      }
    } else if (effectiveArgs.length > 1) {
      // Parse as key=value or --key value pairs
      for (let i = 0; i < effectiveArgs.length; i++) {
        let key = effectiveArgs[i].replace(/^--?/, "");
        const eqIdx = key.indexOf("=");
        if (eqIdx >= 0) {
          const val = key.slice(eqIdx + 1).replace(/^['"]|['"]$/g, ""); // strip quotes
          key = key.slice(0, eqIdx);
          toolArgs[key] = val;
        } else {
          const next = effectiveArgs[i + 1];
          if (next && !next.startsWith("-")) {
            toolArgs[key] = next.replace(/^['"]|['"]$/g, ""); // strip quotes
            i++;
          }
        }
      }
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: toolArgs },
      }),
    });

    const rawBody = await res.text();
    try {
      const data = JSON.parse(rawBody) as {
        error?: { code: number; message: string };
        result?: { content?: { type: string; text: string }[] };
      };
      if (data.error) {
        console.error(JSON.stringify(data.error));
        process.exit(1);
      }
      const content = data.result?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            process.stdout.write(block.text + "\n");
          }
        }
      } else {
        process.stdout.write(JSON.stringify(data.result, null, 2) + "\n");
      }
    } catch {
      if (rawBody) process.stdout.write(rawBody + "\n");
      else console.error(`Tool "${tool}" returned empty response`);
    }
  });

// ── lightmcp setup ───────────────────────────────────────────
program
  .command("setup")
  .description(
    "Install Ollama, pull the model, build catalog, and configure AI agents"
  )
  .action(async () => {
    const { execSync } = await import("node:child_process");
    const { createInterface } = await import("node:readline");
    const osMod = await import("node:os");

    console.log("\n[INFO] LightMCP Setup\n");

    // 1. Check / install Ollama
    let ollamaInstalled = false;
    try {
      execSync("ollama --version", { stdio: "ignore" });
      ollamaInstalled = true;
      console.log("[OK] Ollama already installed");
    } catch {
      console.log("[INFO] Ollama not found. Running installer...");
    }

    if (!ollamaInstalled) {
      if (osMod.default.platform() === "win32") {
        const scriptPath = path.resolve(__dirname, "../../scripts/setup.ps1");
        if (existsSync(scriptPath)) {
          console.log(
            "  Please run the following command in an elevated PowerShell:\n"
          );
          console.log(
            `  powershell -ExecutionPolicy Bypass -File "${scriptPath}"\n`
          );
        } else {
          console.log(
            "  Download Ollama from: https://ollama.com/download/windows\n"
          );
        }
        console.log("  After installation, re-run: lightmcp setup");
        process.exit(0);
      }
    }

    // 2. Pull model
    const { loadConfig } = await import("../config.js");
    const { startOllama, ensureModelPulled, stopOllama } = await import(
      "../ollama/manager.js"
    );

    const cfg = await loadConfig();
    console.log(`\n[INFO] Checking model: ${cfg.ollama.model}`);
    await startOllama();
    await ensureModelPulled();
    await stopOllama();

    // 3. Build initial catalog
    console.log("\n[INFO] Building initial tool catalog...");
    const { buildCatalog } = await import("../catalog/builder.js");
    await buildCatalog();

    // 4. Scan for AI agents and configure
    console.log("\n[INFO] Scanning for AI agents...");
    const { detectAgents, configureAllAgents, generateManualInstructions } =
      await import("../setup/scanner.js");

    const agents = detectAgents();

    if (agents.length === 0) {
      console.log("  No compatible AI agents detected on this system.");
    } else {
      console.log(`\n  Detected ${agents.length} agent(s):`);
      for (const a of agents) {
        const status = a.hasLightMCP ? " (LightMCP already configured)" : "";
        console.log(`    • ${a.name} — ${a.currentServerCount} MCP server(s)${status}`);
      }

      console.log("\n  How should LightMCP configure these agents?\n");
      console.log("  [1] Isolate — disable all other MCP servers, keep only LightMCP (Recommended)");
      console.log("  [2] Add     — leave existing servers as-is, add LightMCP");
      console.log("  [3] Manual  — skip auto-config, show manual instructions");
      console.log("");

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const choice = await new Promise<string>((resolve) => {
        rl.question("  Choose [1/2/3]: ", (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });

      if (choice === "1" || choice === "2" || choice === "3") {
        const modes = ["isolate", "add", "manual"] as const;
        const mode = modes[parseInt(choice) - 1];

        console.log("");
        const results = configureAllAgents(mode, agents);
        for (const r of results) console.log(`  ${r}`);

        if (choice === "3") {
          console.log(generateManualInstructions(agents));
        }
      } else {
        console.log("  Invalid choice — skipping agent configuration.");
        console.log("  Run 'lightmcp configure' later to set it up.");
      }
    }

    // 5. Register Windows Task Scheduler
    if (osMod.default.platform() === "win32") {
      const scriptPath = path.resolve(__dirname, "../../scripts/setup.ps1");
      if (existsSync(scriptPath)) {
        console.log("\n[INFO] Registering Windows startup task...");
        try {
          execSync(
            `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -RegisterTask`,
            { stdio: "inherit" }
          );
        } catch {
          console.warn(
            "  [WARN] Could not register task automatically.\n" +
            `  Run manually in elevated PowerShell:\n` +
            `  powershell -ExecutionPolicy Bypass -File "${scriptPath}" -RegisterTask`
          );
        }
      }
    }

    console.log("\n[OK] LightMCP setup complete!");
    console.log("  Then run: lightmcp start\n");
  });

// ── lightmcp configure ─────────────────────────────────────
program
  .command("configure")
  .description("Re-run AI agent MCP configuration (scan, isolate/add/manual)")
  .action(async () => {
    const { createInterface } = await import("node:readline");
    const { detectAgents, configureAllAgents, generateManualInstructions } =
      await import("../setup/scanner.js");

    console.log("\n[INFO] Scanning for AI agents...\n");
    const agents = detectAgents();

    if (agents.length === 0) {
      console.log("  No compatible AI agents detected on this system.");
      return;
    }

    console.log(`  Detected ${agents.length} agent(s):`);
    for (const a of agents) {
      const status = a.hasLightMCP ? " (LightMCP already configured)" : "";
      console.log(`    • ${a.name} — ${a.currentServerCount} MCP server(s)${status}`);
    }

    console.log("\n  How should LightMCP configure these agents?\n");
    console.log("  [1] Isolate — disable all other MCP servers, keep only LightMCP (Recommended)");
    console.log("  [2] Add     — leave existing servers as-is, add LightMCP");
    console.log("  [3] Manual  — skip auto-config, show manual instructions");
    console.log("");

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const choice = await new Promise<string>((resolve) => {
      rl.question("  Choose [1/2/3]: ", (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });

    if (choice === "1" || choice === "2" || choice === "3") {
      const modes = ["isolate", "add", "manual"] as const;
      const mode = modes[parseInt(choice) - 1];

      console.log("");
      const results = configureAllAgents(mode, agents);
      for (const r of results) console.log(`  ${r}`);

      if (choice === "3") {
        console.log(generateManualInstructions(agents));
      }
    } else {
      console.log("  Invalid choice — no changes made.");
    }
    console.log("");
  });

program.parse(process.argv);
