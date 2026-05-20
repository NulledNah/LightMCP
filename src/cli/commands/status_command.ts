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

  const lines: string[] = [];
  lines.push(`  Server port:   ${cfg.server.port}`);
  lines.push(`  Ollama:        ${ollamaAlive ? "[OK] running" : "[INFO] stopped"} (${cfg.ollama.host})`);
  lines.push(`  Model:         ${cfg.ollama.model}`);
  if (meta) {
    lines.push(`  Catalog:       [OK] ${meta.toolCount} tools across ${meta.serverCount} servers`);
    lines.push(`  Built at:      ${new Date(meta.builtAt).toLocaleString()}`);
    lines.push(`  Active-only:   ${meta.activeOnly}`);
  } else {
    lines.push("  Catalog:       [WARN] not built (run: lightmcp build-catalog)");
  }

  const maxLen = Math.max(...lines.map(l => l.length), 20);
  const title = "── LightMCP Status ";
  const bar = "─".repeat(Math.max(0, maxLen - title.length + 2));

  console.log(`\n${title}${bar}`);
  for (const l of lines) console.log(l);
  console.log("─".repeat(maxLen + 2) + "\n");
}
