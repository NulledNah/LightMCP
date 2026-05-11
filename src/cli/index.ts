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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(__dirname, "../../package.json");
const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as { version: string };

const program = new Command();

program
  .name("lightmcp")
  .description(
    "LightMCP — semantic MCP tool router powered by a local LLM.\n" +
    "Bypass the 100-tool limit and reduce context usage in Antigravity."
  )
  .version(pkg.version);

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
      console.log("📂 No catalog found — building now…");
      await buildCatalog();
    } else {
      const tools = await getCatalogTools();
      console.log(`📂 Catalog loaded: ${tools.length} tools`);
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
    console.log(`  Ollama:        ${ollamaAlive ? "✅ running" : "⭕ stopped"} (${cfg.ollama.host})`);
    console.log(`  Model:         ${cfg.ollama.model}`);
    if (meta) {
      console.log(`  Catalog:       ✅ ${meta.toolCount} tools across ${meta.serverCount} servers`);
      console.log(`  Built at:      ${new Date(meta.builtAt).toLocaleString()}`);
      console.log(`  Active-only:   ${meta.activeOnly}`);
    } else {
      console.log("  Catalog:       ⚠️  not built (run: lightmcp build-catalog)");
    }
    console.log("─────────────────────────────────────────────────\n");
  });

// ── lightmcp test ────────────────────────────────────────────
program
  .command("test <task>")
  .description("Test tool routing locally without starting the MCP server")
  .option("--hints <hints>", "Comma-separated hints", "")
  .action(async (task: string, opts: { hints: string }) => {
    const { getCatalogTools, loadCatalog } = await import("../catalog/loader.js");
    const { buildCatalog } = await import("../catalog/builder.js");
    const { ensureOllamaReady, stopOllama } = await import("../ollama/manager.js");
    const { selectTools } = await import("../ollama/client.js");

    let catalog = await getCatalogTools();
    if (catalog.length === 0) {
      console.log("📂 No catalog found — building first…");
      const built = await buildCatalog();
      catalog = built.tools;
    }

    const hints = opts.hints ? opts.hints.split(",").map((h) => h.trim()) : [];

    console.log(`\n🔍 Task: "${task}"`);
    console.log(`📚 Catalog: ${catalog.length} tools\n`);

    await ensureOllamaReady();

    try {
      const selected = await selectTools(task, catalog, hints);
      const validTools = catalog.filter((t) => selected.includes(t.name));

      console.log(`\n✅ Selected ${validTools.length} tools:\n`);
      for (const t of validTools) {
        console.log(`  • [${t.serverKey}] ${t.name}`);
        console.log(`    ${t.shortDesc}`);
      }

      if (selected.length > validTools.length) {
        const invalid = selected.filter(
          (n) => !catalog.some((t) => t.name === n)
        );
        console.log(
          `\n⚠️  ${invalid.length} hallucinated names (ignored): ${invalid.join(", ")}`
        );
      }
    } finally {
      await stopOllama();
    }
  });

// ── lightmcp setup ───────────────────────────────────────────
program
  .command("setup")
  .description(
    "Install Ollama, pull the model, and register Windows startup task"
  )
  .action(async () => {
    const { execSync } = await import("node:child_process");
    const os = await import("node:os");

    console.log("\n🔧 LightMCP Setup\n");

    // 1. Check / install Ollama
    let ollamaInstalled = false;
    try {
      execSync("ollama --version", { stdio: "ignore" });
      ollamaInstalled = true;
      console.log("✅ Ollama already installed");
    } catch {
      console.log("📦 Ollama not found. Running installer…");
    }

    if (!ollamaInstalled) {
      if (os.default.platform() === "win32") {
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
    console.log(`\n⬇️  Checking model: ${cfg.ollama.model}`);
    await startOllama();
    await ensureModelPulled();
    await stopOllama();

    // 3. Build initial catalog
    console.log("\n📂 Building initial tool catalog…");
    const { buildCatalog } = await import("../catalog/builder.js");
    await buildCatalog();

    // 4. Register Windows Task Scheduler
    if (os.default.platform() === "win32") {
      const scriptPath = path.resolve(__dirname, "../../scripts/setup.ps1");
      if (existsSync(scriptPath)) {
        console.log("\n⏰ Registering Windows startup task…");
        try {
          execSync(
            `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -RegisterTask`,
            { stdio: "inherit" }
          );
        } catch {
          console.warn(
            "  ⚠️  Could not register task automatically.\n" +
            `  Run manually in elevated PowerShell:\n` +
            `  powershell -ExecutionPolicy Bypass -File "${scriptPath}" -RegisterTask`
          );
        }
      }
    }

    console.log("\n🎉 LightMCP setup complete!");
    console.log("  Add to your mcp_config.json:");
    console.log(`    "lightmcp": { "serverUrl": "http://127.0.0.1:${cfg.server.port}/mcp" }`);
    console.log("\n  Then run: lightmcp start\n");
  });

program.parse(process.argv);
