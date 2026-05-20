// ============================================================
// LightMCP — setup command
// ============================================================
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanTip } from "../utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function setupAction(): Promise<void> {
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
      let curlOk = false;
      try {
        execSync("curl --version", { stdio: "ignore" });
        curlOk = true;
      } catch { /* curl not found */ }

      if (!curlOk) {
        console.log(
          "  [WARN] curl not found. Install it first:\n" +
          "    Ubuntu/Debian: sudo apt install curl\n" +
          "    Fedora:        sudo dnf install curl"
        );
        console.log("  After installation, re-run: lightmcp setup");
        process.exit(0);
      }

      console.log("  Installing Ollama via curl (requires root/sudo)...");
      try {
        execSync(
          'curl -fsSL https://ollama.com/install.sh | sh',
          { stdio: "inherit" }
        );
        console.log("[OK] Ollama installed");
        ollamaInstalled = true;
      } catch {
        console.warn(
          "  [WARN] Could not install Ollama automatically.\n" +
          "  Run manually: curl -fsSL https://ollama.com/install.sh | sh"
        );
        console.log("  After installation, re-run: lightmcp setup");
        process.exit(0);
      }
    }
  }

  // 2. Pull model
  const { loadConfig } = await import("../../config.js");
  const { startOllama, ensureModelPulled, stopOllama } = await import(
    "../../ollama/manager.js"
  );

  const cfg = await loadConfig();
  console.log(`\n[INFO] Checking model: ${cfg.ollama.model}`);
  await startOllama();
  await ensureModelPulled();
  await stopOllama();

  // 3. Build initial catalog
  console.log("\n[INFO] Building initial tool catalog...");
  const { buildCatalog } = await import("../../catalog/builder.js");
  await buildCatalog();

  // 4. Generate tool tips and rebuild catalog with tips
  console.log("\n[INFO] Generating tool tips (improves selection accuracy)...");
  const { keepOllamaAlive } = await import("../../ollama/manager.js");
  const { getCatalogTools } = await import("../../catalog/loader.js");
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
  Bad:  "When you need to find a component, use 'my_tool' to locate it"

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

      const sorted: Record<string, string> = {};
      for (const key of Object.keys(existingTips).sort()) sorted[key] = existingTips[key];
      await writeFile(tipsPath, JSON.stringify(sorted, null, 2), "utf-8");
      console.log(`  [OK] ${tipsCount} new tip(s) generated`);
    } else {
      console.log("  [OK] All tools already have tips");
    }

    console.log("  [INFO] Rebuilding catalog with tips...");
    await buildCatalog();
  } finally {
    await stopOllama();
  }

  // 5. Scan for AI agents and configure
  console.log("\n[INFO] Scanning for AI agents...");
  const { detectAgents, configureAllAgents, generateManualInstructions } =
    await import("../../setup/scanner.js");

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

        // Install agent rules for all selected agents
        const templateDir = path.resolve(__dirname, "../../../scripts");
        const cliPath = path.resolve(__dirname, "../../../dist/cli/index.js");
        const { installAgentRule } = await import("../../setup/scanner.js");

        for (const agent of selectedAgents) {
          const replaced = installAgentRule(
            agent.name,
            templateDir,
            agent.name === "Antigravity" ? { "<path-to-LightMCP>": cliPath } : undefined
          );
          if (replaced) {
            console.log(`  [OK] ${agent.name} global rule installed`);
          }
        }
      } else {
        console.log("  Invalid choice — skipping agent configuration.");
        console.log("  Run 'lightmcp configure' later to set it up.");
      }
    }
  }

  // 6. Register startup task
  if (osMod.default.platform() === "win32") {
    const scriptPath = path.resolve(__dirname, "../../../scripts/setup.ps1");
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
  } else if (osMod.default.platform() === "linux") {
    const scriptPath = path.resolve(__dirname, "../../../scripts/setup.sh");
    if (existsSync(scriptPath)) {
      console.log("\n[INFO] Registering Linux systemd user service...");
      try {
        execSync(`bash "${scriptPath}"`, { stdio: "inherit" });
      } catch {
        console.warn(
          "  [WARN] Could not register service automatically.\n" +
          `  Run manually: bash "${scriptPath}"`
        );
      }
    }
  } else {
    console.log("\n[INFO] To run LightMCP at startup, add to your init system:");
    console.log("  Linux (systemd):");
    console.log("    Create ~/.config/systemd/user/lightmcp.service with:");
    console.log("    [Unit]");
    console.log("    Description=LightMCP MCP Router");
    console.log("    [Service]");
    console.log(`    ExecStart=${process.execPath} ${path.resolve(__dirname, "../../index.js")} start`);
    console.log("    Restart=on-failure");
    console.log("    [Install]");
    console.log("    WantedBy=default.target");
    console.log("    Then run: systemctl --user enable --now lightmcp.service");
  }

  console.log("\n[OK] LightMCP setup complete!");
  console.log("  Then run: lightmcp start\n");
}
