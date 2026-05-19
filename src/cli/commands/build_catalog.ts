// ============================================================
// LightMCP — build-catalog command
// ============================================================

export async function buildCatalogAction(opts: { activeOnly?: boolean }): Promise<void> {
  const { buildCatalog } = await import("../../catalog/builder.js");
  await buildCatalog({ activeOnly: opts.activeOnly });
}
