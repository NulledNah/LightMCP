// ============================================================
// LightMCP — uninstall command
// Delegates to the standalone uninstall script if available,
// otherwise falls back to in-process cleanup.
// ============================================================
import { spawn } from "node:child_process";
import { uninstallAll } from "../../server/manager.js";
import { removeAllAgentRules } from "../../setup/scanner.js";
import { scriptExists, getUninstallScriptPath } from "../../setup/uninstall_script.js";

export async function uninstallCommand(): Promise<void> {
  console.log("\n[INFO] LightMCP Uninstall\n");

  const scriptPath = getUninstallScriptPath();

  if (scriptExists()) {
    // Delegate to the standalone generated script (full cleanup incl. project dir deletion)
    console.log(`[INFO] Running standalone uninstall script: ${scriptPath}\n`);

    await new Promise<void>((resolve) => {
      const child = spawn(process.execPath, [scriptPath], {
        stdio: "inherit",
        detached: false,
      });

      child.on("close", (code) => {
        if (code === 0) {
          console.log("\n[OK] Uninstall completed via standalone script.");
        } else {
          console.log(`\n[WARN] Uninstall script exited with code ${code}.`);
          console.log("  Run manually: node ~/.lightmcp/uninstall.cjs");
        }
        resolve();
      });

      child.on("error", () => {
        console.log("\n[WARN] Could not spawn uninstall script.");
        console.log("  Run manually: node ~/.lightmcp/uninstall.cjs");
        resolve();
      });
    });
  } else {
    // Fallback: in-process cleanup (partial — can't delete project dir or npm binary)
    console.log("[INFO] No standalone uninstall script found.");
    console.log("[INFO] Performing in-process cleanup...\n");
    console.log("  (Run 'lightmcp setup' first if you need full cleanup via the standalone script)\n");

    const messages = await uninstallAll();
    for (const msg of messages) console.log(msg);

    console.log("");
    const ruleResults = await removeAllAgentRules();
    for (const msg of ruleResults) console.log(`  ${msg}`);

    console.log("\n  Remaining manual steps:");
    console.log("  Delete the LightMCP directory to remove source files.");
    console.log("  Run: npm uninstall -g lightmcp");
    console.log("  Uninstall Ollama separately if no longer needed.\n");
  }
}
