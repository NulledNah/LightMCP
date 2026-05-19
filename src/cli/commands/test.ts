// ============================================================
// LightMCP — test command
// ============================================================

export async function testAction(task: string, opts: { hints: string }): Promise<void> {
  const { getCatalogTools } = await import("../../catalog/loader.js");
  const { buildCatalog } = await import("../../catalog/builder.js");
  const { ensureOllamaReady, stopOllama } = await import("../../ollama/manager.js");
  const { selectTools } = await import("../../ollama/client.js");

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
}
