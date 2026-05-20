// ============================================================
// LightMCP — configure command
// ============================================================

export async function configureAction(): Promise<void> {
  const { createInterface } = await import("node:readline");
  const { detectAgents, configureAllAgents, generateManualInstructions } =
    await import("../../setup/scanner.js");

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
}
