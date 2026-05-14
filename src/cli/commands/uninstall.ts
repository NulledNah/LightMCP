// ============================================================
// LightMCP — uninstall command
// Restores agent configs, cleans up generated files.
// ============================================================
import { uninstallAll } from "../../server/manager.js";

export async function uninstallCommand(): Promise<void> {
  console.log("\n[INFO] LightMCP Uninstall\n");

  const messages = await uninstallAll();
  for (const msg of messages) console.log(msg);

  console.log("\n  To completely remove LightMCP:");
  console.log("  Delete the LightMCP directory.");
  console.log("  Uninstall Ollama separately if no longer needed.\n");
}
