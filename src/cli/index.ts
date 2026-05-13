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

/** Strip tool name mentions and "Use this tool" cruft anywhere in the text */
function cleanTip(raw: string, toolName: string): string {
  let tip = raw;
  const n = toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // "Use 'toolname' when/to/for/..." at start
  tip = tip.replace(new RegExp(`^Use\\s+['\`"]${n}['\`"]\\s+(when|to|for|in|as|with)\\s+`, 'i'),
    (_: string, w: string) => w.charAt(0).toUpperCase() + w.slice(1) + " ");
  tip = tip.replace(new RegExp(`^Use\\s+['\`"]${n}['\`"][,\\s]*`, 'i'), "");

  // ", use 'toolname' to/..." mid-sentence
  tip = tip.replace(new RegExp(`([,;])\\s*use\\s+['\`"]${n}['\`"]\\s+(to|for|as|when|in|with)\\s+`, 'gi'),
    (_: string, p: string, w: string) => p + " " + w + " ");
  tip = tip.replace(new RegExp(`([,;])\\s*use\\s+['\`"]${n}['\`"][.,]?\\s*`, 'gi'), "$1 ");

  // ". Use 'toolname' to/..." after period
  tip = tip.replace(new RegExp(`\\.\\s*Use\\s+['\`"]${n}['\`"]\\s+(to|for|as|when|in|with)\\s+`, 'g'),
    (_: string, w: string) => ". " + w.charAt(0).toUpperCase() + w.slice(1) + " ");
  tip = tip.replace(new RegExp(`\\.\\s*Use\\s+['\`"]${n}['\`"][.,]?\\s*`, 'gi'), ". ");

  // "Use this tool to/when/..." (generic)
  tip = tip.replace(/[,;]\s*Use this tool\s+(to|for|as|when)\s+/gi,
    (_: string, w: string) => ", " + w + " ");
  tip = tip.replace(/\.\s*Use this tool\s+(to|for|as|when)\s+/g,
    (_: string, w: string) => ". " + w.charAt(0).toUpperCase() + w.slice(1) + " ");

  // Cleanup: collapse whitespace
  tip = tip.replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").trim();
  // Capitalize first letter
  if (tip.length > 0) tip = tip.charAt(0).toUpperCase() + tip.slice(1);
  return tip;
}

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
    const { loadConfig } = await import("../config.js");
    const cfg = await loadConfig();
    const url = `http://${cfg.server.host}:${cfg.server.port}/mcp`;
    const hints = opts.hints ? opts.hints.split(",").map((h) => h.trim()) : [];

    let serverStarted = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: 1, method: "tools/call",
            params: { name: "get_task_tools", arguments: { task, hints } },
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (res.ok) {
          const data = (await res.json()) as { result?: { content?: { type: string; text: string }[] } };
          const text = (data.result as any)?.content?.[0]?.text;
          if (text) {
            const result = JSON.parse(text);
            for (const t of result.tools ?? []) {
              console.log(`${t.name} [${t.serverKey}] ${t.description}`);
              if (t.usage) console.log(`  Usage: ${t.usage}`);
            }
            console.log(`\n${result.selected ?? result.tools?.length ?? 0}/${result.total ?? "?"} tools selected — ready to call`);
            return;
          }
        }
        // Server responded but with non-ok status or unexpected format — try local
        break;
      } catch (err: unknown) {
        const e = err as Error;
        const code = (e as any)?.cause?.code ?? (e as any)?.code ?? "";
        const isConnErr = /ECONNREFUSED|ENOTFOUND|EADDRNOTAVAIL|fetch failed/i.test(code) ||
          /ECONNREFUSED|fetch failed/i.test(e.message ?? "");
        if (isConnErr && attempt < 3) {
          if (!serverStarted) {
            serverStarted = true;
            const { spawn } = await import("node:child_process");
            const { fileURLToPath } = await import("node:url");
            const pathMod = await import("node:path");
            const cliPath = pathMod.resolve(
              pathMod.dirname(fileURLToPath(import.meta.url)),
              "index.js"
            );
            spawn("node", [cliPath, "start"], {
              detached: false,
              stdio: "ignore",
              shell: process.platform === "win32",
              windowsHide: true,
            });
            if (process.env.LIGHTMCP_VERBOSE) {
              console.error("[get-tools] Server unreachable — starting LightMCP...");
            }
          }
          // Wait for server to start, then retry
          await new Promise((r) => setTimeout(r, 3_000));
          continue;
        }
        // Other error — fall through to local mode
        break;
      }
    }

    // Fallback: local Ollama selection (tools won't be registered on McpServer)
    console.log("[INFO] Server not reachable — using local mode (tools not registered)");
    const { getCatalogTools } = await import("../catalog/loader.js");
    const { buildCatalog } = await import("../catalog/builder.js");
    const { ensureOllamaReady, stopOllama } = await import("../ollama/manager.js");
    const { selectTools } = await import("../ollama/client.js");

    let catalog = await getCatalogTools();
    if (catalog.length === 0) {
      const built = await buildCatalog();
      catalog = built.tools;
    }

    await ensureOllamaReady();

    try {
      const selected = await selectTools(task, catalog, hints);
      const validTools = catalog.filter((t) => selected.includes(t.name));

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
  .option("--file <path>", "Read tool arguments from a JSON file")
  .option("--output <path>", "Save image results to file (auto-decodes base64)")
  .allowUnknownOption()
  .action(async (firstArg: string, rawArgs: string[], opts: { file?: string; output?: string }) => {
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

    if (opts.file) {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(opts.file, "utf-8");
      toolArgs = JSON.parse(raw);
    } else {
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
            const val = key.slice(eqIdx + 1).replace(/^['"]|['"]$/g, "");
            key = key.slice(0, eqIdx);
            toolArgs[key] = val;
          } else {
            const next = effectiveArgs[i + 1];
            if (next && !next.startsWith("-")) {
              toolArgs[key] = next.replace(/^['"]|['"]$/g, "");
              i++;
            }
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
        result?: { content?: { type: string; text?: string; data?: string; mimeType?: string }[] };
      };
      if (data.error) {
        console.error(JSON.stringify(data.error));
        process.exit(1);
      }
      const content = data.result?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            process.stdout.write(block.text);
          } else if (block.type === "image" && block.data) {
            if (opts.output) {
              const { writeFile } = await import("node:fs/promises");
              const buf = Buffer.from(block.data, "base64");
              await writeFile(opts.output, buf);
              process.stdout.write(`[OK] Image saved to ${opts.output}\n`);
            } else {
              process.stdout.write(block.data);
            }
          }
        }
        process.stdout.write("\n");
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
    const { readFile, writeFile } = await import("node:fs/promises");

    console.log("\n[INFO] LightMCP Setup\n");

    // 1. Check / install Ollama
    let ollamaInstalled = false;
    try {
      execSync("ollama --version", { stdio: "ignore" });
      ollamaInstalled = true;
      console.log("[OK] Ollama already installed");
    } catch {
      console.log("[INFO] Ollama not found. Installing...");
    }

    if (!ollamaInstalled) {
      if (osMod.default.platform() === "win32") {
        try {
          execSync("winget --version", { stdio: "ignore" });
          console.log("  Installing Ollama via winget...");
          execSync(
            "winget install --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements",
            { stdio: "inherit" }
          );
          // Refresh PATH for this process
          process.env.PATH = (process.env.PATH ?? "") + ";" +
            (process.env.LOCALAPPDATA ?? "") + "\\Programs\\Ollama";
          console.log("[OK] Ollama installed");
          ollamaInstalled = true;
        } catch {
          console.log(
            "  [WARN] Could not install Ollama automatically.\n" +
            "  Download from: https://ollama.com/download/windows"
          );
          console.log("  After installation, re-run: lightmcp setup");
          process.exit(0);
        }
      } else {
        console.log(
          "  [INFO] Please install Ollama manually:\n" +
          "  Linux/macOS: curl -fsSL https://ollama.com/install.sh | sh"
        );
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

    // 4. Generate tool tips and rebuild catalog with tips
    console.log("\n[INFO] Generating tool tips (improves selection accuracy)...");
    const { keepOllamaAlive } = await import("../ollama/manager.js");
    const { getCatalogTools } = await import("../catalog/loader.js");
    const pathMod = await import("node:path");

    await startOllama();

    let tipsCount = 0;
    try {
      const catalog = await getCatalogTools();
      const tipsPath = pathMod.resolve(process.cwd(), "tool_tips.json");
      const existingTips: Record<string, string> = {};

      if (existsSync(tipsPath)) {
        try {
          const raw = await readFile(tipsPath, "utf-8");
          const parsed = JSON.parse(raw);
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string") existingTips[k] = v;
          }
        } catch { /* start fresh */ }
      }

      const toolsToTip = catalog.filter(t => !existingTips[t.name]);
      if (toolsToTip.length > 0) {
        const { host, model } = cfg.ollama;

        const tipPrompt = (t: typeof catalog[number]) =>
          `Write a concise usage tip (max 100 chars) explaining WHEN to select this tool — its role in a workflow.
CRITICAL: Never mention the tool name anywhere in the tip. Describe only the situation or need.
  Good: "When you need to quickly find a specific component by name in your library"
  Bad:  "When you need to find a component, use 'search_footprints' to locate it"

Tool name: "${t.name}"
Server: ${t.serverKey}
Description: ${t.description?.slice(0, 400) ?? "No description"}

Tip (max 100 chars):`;

        console.log(`  Generating tips for ${toolsToTip.length} tool(s)...`);
        for (let i = 0; i < toolsToTip.length; i++) {
          const t = toolsToTip[i];
          try {
            const res = await fetch(`${host}/api/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model,
                stream: false,
                messages: [{ role: "user", content: tipPrompt(t) }],
                options: { temperature: 0.1, num_predict: 128, top_k: 20, top_p: 0.9 },
              }),
              signal: AbortSignal.timeout(30_000),
            });
            if (res.ok) {
              const data = (await res.json()) as { message?: { content?: string } };
              const raw = (data.message?.content ?? "").trim()
                .replace(/^["']|["']$/g, "")
                .replace(/^Tip:\s*/i, "");

              const cleaned = cleanTip(raw, t.name);
              const tip = cleaned.length > 120
                ? (() => { const s = cleaned.slice(0, 120); const sp = s.lastIndexOf(" "); return sp > 60 ? s.slice(0, sp) : s; })()
                : cleaned;

              if (tip) {
                existingTips[t.name] = tip;
                tipsCount++;
                await keepOllamaAlive();
              }
            }
          } catch { /* skip individual failures */ }
        }

        // Sort and save
        const sorted: Record<string, string> = {};
        for (const key of Object.keys(existingTips).sort()) sorted[key] = existingTips[key];
        await writeFile(tipsPath, JSON.stringify(sorted, null, 2), "utf-8");
        console.log(`  [OK] ${tipsCount} new tip(s) generated`);
      } else {
        console.log("  [OK] All tools already have tips");
      }

      // Rebuild catalog with tips injected
      console.log("  [INFO] Rebuilding catalog with tips...");
      await buildCatalog();
    } finally {
      await stopOllama();
    }

    // 5. Scan for AI agents and configure
    console.log("\n[INFO] Scanning for AI agents...");
    const { detectAgents, configureAllAgents, generateManualInstructions } =
      await import("../setup/scanner.js");

    const agents = detectAgents();

    if (agents.length === 0) {
      console.log("  No compatible AI agents detected on this system.");
    } else {
      console.log(`\n  Detected ${agents.length} agent(s):`);
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        const status = a.hasLightMCP ? " (LightMCP already configured)" : "";
        console.log(`    [${i + 1}] ${a.name} — ${a.currentServerCount} MCP server(s)${status}`);
      }

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const agentChoice = await new Promise<string>((resolve) => {
        rl.question("\n  Which agents to configure? (1,2,... or 'all'): ", (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });

      let selectedAgents = agents;
      if (agentChoice.toLowerCase() !== "all") {
        const indices = agentChoice.split(",").map(s => parseInt(s.trim()) - 1).filter(i => !isNaN(i) && i >= 0 && i < agents.length);
        selectedAgents = indices.map(i => agents[i]);
        if (selectedAgents.length === 0) {
          console.log("  No valid agents selected — skipping configuration.");
          selectedAgents = [];
        }
      }

      if (selectedAgents.length > 0) {
        const rl2 = createInterface({ input: process.stdin, output: process.stdout });
        console.log("\n  How should LightMCP configure these agents?\n");
        console.log("  [1] Isolate — disable all other MCP servers, keep only LightMCP (Recommended)");
        console.log("  [2] Add     — leave existing servers as-is, add LightMCP");
        console.log("  [3] Manual  — skip auto-config, show manual instructions");
        console.log("");

        const choice = await new Promise<string>((resolve) => {
          rl2.question("  Choose [1/2/3]: ", (answer) => {
            rl2.close();
            resolve(answer.trim());
          });
        });

        if (choice === "1" || choice === "2" || choice === "3") {
          const modes = ["isolate", "add", "manual"] as const;
          const mode = modes[parseInt(choice) - 1];

          console.log("");
          const results = configureAllAgents(mode, selectedAgents);
          for (const r of results) console.log(`  ${r}`);

          if (choice === "3") {
            console.log(generateManualInstructions(selectedAgents));
          }

          // 6. Install Antigravity global rule
          if (selectedAgents.some(a => a.name === "Antigravity")) {
            const homedir = osMod.default.homedir();
            const geminiMdPath = pathMod.resolve(homedir, ".gemini", "GEMINI.md");
            const templatePath = path.resolve(__dirname, "../../scripts/antigravity_rule.md");

            if (existsSync(templatePath)) {
              const templateContent = await readFile(templatePath, "utf-8");
              let existingContent = "";
              if (existsSync(geminiMdPath)) {
                existingContent = await readFile(geminiMdPath, "utf-8");
              }

              // Prepend template to existing content
              const finalContent = templateContent.trim() + "\n\n" + existingContent.trim();
              await writeFile(geminiMdPath, finalContent.trim() + "\n", "utf-8");
              console.log(`  [OK] Antigravity global rule installed at ${geminiMdPath}`);
            } else {
              console.warn("  [WARN] antigravity_rule.md template not found — skip global rule");
            }
          }
        } else {
          console.log("  Invalid choice — skipping agent configuration.");
          console.log("  Run 'lightmcp configure' later to set it up.");
        }
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

// ── lightmcp generate-tips ──────────────────────────────────
program
  .command("generate-tips")
  .description("Generate usage tips for each tool via local LLM (one call per tool, zero cross-contamination)")
  .option("--server <key>", "Only generate tips for a specific server")
  .option("--overwrite", "Overwrite existing tips (default: skip tools that already have tips)")
  .action(async (opts: { server?: string; overwrite?: boolean }) => {
    const { readFile, writeFile } = await import("node:fs/promises");
    const { existsSync } = await import("node:fs");
    const pathMod = await import("node:path");
    const { getCatalogTools } = await import("../catalog/loader.js");
    const { buildCatalog } = await import("../catalog/builder.js");
    const { loadConfig } = await import("../config.js");
    const { ensureOllamaReady, stopOllama, keepOllamaAlive } = await import("../ollama/manager.js");

    let catalog = await getCatalogTools();
    if (catalog.length === 0) {
      console.log("[INFO] No catalog found - building first...");
      const built = await buildCatalog();
      catalog = built.tools;
    }

    // Filter by server if specified
    let tools = catalog;
    if (opts.server) {
      tools = catalog.filter((t) => t.serverKey === opts.server);
      if (tools.length === 0) {
        console.log(`[INFO] No tools found for server "${opts.server}"`);
        process.exit(0);
      }
      console.log(`[INFO] Generating tips for server "${opts.server}" (${tools.length} tools)`);
    } else {
      console.log(`[INFO] Generating tips for ${tools.length} tools across all servers`);
    }

    // Load existing tips
    const tipsPath = pathMod.resolve(process.cwd(), "tool_tips.json");
    const existingTips: Record<string, string> = {};
    if (existsSync(tipsPath)) {
      try {
        const raw = await readFile(tipsPath, "utf-8");
        const parsed = JSON.parse(raw);
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") existingTips[k] = v;
        }
      } catch { /* start fresh */ }
    }

    // Filter out tools that already have tips (unless --overwrite)
    if (!opts.overwrite) {
      const skipped = tools.filter((t) => existingTips[t.name]);
      tools = tools.filter((t) => !existingTips[t.name]);
      if (skipped.length > 0) {
        console.log(`[INFO] Skipping ${skipped.length} tool(s) with existing tips (use --overwrite to regenerate)`);
      }
    }

    if (tools.length === 0) {
      console.log("[INFO] All tools already have tips — nothing to do.");
      process.exit(0);
    }

    await ensureOllamaReady();
    const cfg = await loadConfig();
    const { host, model } = cfg.ollama;

    const serverDomains: Record<string, string> = {
      kicad: "PCB / EDA design",
      "chrome-devtools-mcp": "Browser / Web DevTools",
      "autodesk-fusion": "3D CAD / Fusion 360",
      "sequential-thinking": "Structured reasoning / analysis",
      "google-developer-knowledge": "Google developer documentation",
    };

    const tipPrompt = (t: typeof tools[number]) =>
      `Write a concise usage tip (max 100 chars) explaining WHEN to select this tool — its role in a workflow.
CRITICAL: Never mention the tool name anywhere in the tip. Describe only the situation or need.
  Good: "When you need to quickly find a specific component by name in your library"
  Bad:  "When you need to find a component, use 'search_footprints' to locate it"

Tool name: "${t.name}"
Server: ${t.serverKey}${serverDomains[t.serverKey] ? ` [${serverDomains[t.serverKey]}]` : ""}
Description: ${t.description?.slice(0, 400) ?? "No description"}

Tip (max 100 chars):`;

    let generated = 0;
    let failed = 0;

    for (let i = 0; i < tools.length; i++) {
      const t = tools[i];
      process.stdout.write(`  [${i + 1}/${tools.length}] "${t.name}" ... `);

      try {
        const res = await fetch(`${host}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            messages: [{ role: "user", content: tipPrompt(t) }],
            options: { temperature: 0.1, num_predict: 128, top_k: 20, top_p: 0.9 },
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (!res.ok) {
          console.log(`FAIL (HTTP ${res.status})`);
          failed++;
          continue;
        }

        const data = (await res.json()) as { message?: { content?: string } };
        const raw = (data.message?.content ?? "").trim()
          .replace(/^["']|["']$/g, "")   // strip quotes
          .replace(/^Tip:\s*/i, "");     // strip "Tip:" prefix

        const cleaned = cleanTip(raw, t.name);

        // Truncate at last word boundary within 120 chars (no mid-word cut)
        const tip = cleaned.length > 120
          ? (() => { const s = cleaned.slice(0, 120); const sp = s.lastIndexOf(" "); return sp > 60 ? s.slice(0, sp) : s; })()
          : cleaned;
        if (!tip) {
          console.log("SKIP (empty response)");
          failed++;
          continue;
        }

        existingTips[t.name] = tip;
        console.log(`"${tip}"`);
        generated++;
        await keepOllamaAlive();  // reset idle timer
      } catch (err) {
        console.log(`FAIL (${err instanceof Error ? err.message : String(err)})`);
        failed++;
      }
    }

    // Save to file
    const sorted: Record<string, string> = {};
    for (const key of Object.keys(existingTips).sort()) {
      sorted[key] = existingTips[key];
    }
    await writeFile(tipsPath, JSON.stringify(sorted, null, 2), "utf-8");

    console.log(`\n[OK] ${generated} tip(s) generated, ${failed} failed`);
    console.log(`[OK] Saved to ${tipsPath}`);
    console.log("[INFO] Run 'lightmcp build-catalog' to rebuild the catalog with tips.\n");

    await stopOllama();
  });

// ── Default: treat unknown args as "call <tool> [args...]" ─
// Antigravity may run: lightmcp kicad search_footprints --query "x"
program.action(async (...args: (string | unknown)[]) => {
  // Guard: ignore non-string args (Commander edge case with circular objects)
  const strs = args.filter((a): a is string => typeof a === "string");
  if (strs.length === 0) return;

  // Filter out known server key prefix
  const knownServers = ["kicad", "chrome-devtools-mcp", "sequential-thinking", "autodesk-fusion", "google-developer-knowledge"];
  let toolIdx = 0;
  if (strs.length > 1 && knownServers.includes(strs[0])) {
    toolIdx = 1;
  }
  if (strs.length <= toolIdx) return;

  const tool = strs[toolIdx];
  const rawArgs = strs.slice(toolIdx + 1);

  const { loadConfig } = await import("../config.js");
  const cfg = await loadConfig();
  const url = `http://${cfg.server.host}:${cfg.server.port}/mcp`;

  let toolArgs: Record<string, unknown> = {};
  if (rawArgs.length === 1) {
    try { toolArgs = JSON.parse(rawArgs[0]); } catch { toolArgs = { input: rawArgs[0] }; }
  } else if (rawArgs.length > 1) {
    for (let i = 0; i < rawArgs.length; i++) {
      let key = rawArgs[i].replace(/^--?/, "");
      const eqIdx = key.indexOf("=");
      if (eqIdx >= 0) {
        toolArgs[key.slice(0, eqIdx)] = key.slice(eqIdx + 1).replace(/^['"]|['"]$/g, "");
      } else {
        const next = rawArgs[i + 1];
        if (next && !next.startsWith("-")) { toolArgs[key] = next.replace(/^['"]|['"]$/g, ""); i++; }
      }
    }
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: toolArgs } }),
  });

  const rawBody = await res.text();
  try {
    const data = JSON.parse(rawBody) as any;
    if (data.error) { console.error(JSON.stringify(data.error)); process.exit(1); }
    const content = data.result?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && block.text) process.stdout.write(block.text);
        else if (block.type === "image" && block.data) process.stdout.write(block.data);
      }
      process.stdout.write("\n");
    } else {
      process.stdout.write(JSON.stringify(data.result, null, 2) + "\n");
    }
  } catch {
    if (rawBody) process.stdout.write(rawBody + "\n");
    else console.error(`Tool "${tool}" returned empty response`);
  }
});

program.parse(process.argv);
