// ============================================================
// LightMCP — status command
// ============================================================

export async function statusAction(): Promise<void> {
  const { loadConfig } = await import("../../config.js");
  const { getCatalogMeta } = await import("../../catalog/loader.js");
  const { pingOllama } = await import("../../ollama/manager.js");

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
}
