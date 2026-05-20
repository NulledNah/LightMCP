// ============================================================
// LightMCP — start command
// ============================================================
import { existsSync } from "node:fs";
import path from "node:path";

export async function startAction(opts: { stdio?: boolean; watch?: boolean; mode?: string }): Promise<void> {
  const { startServer } = await import("../../server/mcp_server.js");
  const { buildCatalog } = await import("../../catalog/builder.js");
  const { getCatalogTools } = await import("../../catalog/loader.js");
  const { startCatalogWatcher } = await import("../../catalog/watcher.js");
  const { loadConfig } = await import("../../config.js");

  const cfg = await loadConfig();

  if (opts.mode) {
    if (opts.mode !== "filtered" && opts.mode !== "full") {
      console.error("[ERROR] --mode must be 'filtered' or 'full'");
      process.exit(1);
    }
    cfg.server.mode = opts.mode;
  }

  const outPath = path.resolve(process.cwd(), cfg.catalog.outputPath);

  if (!existsSync(outPath)) {
    console.log("[INFO] No catalog found - building now...");
    await buildCatalog();
  } else {
    const tools = await getCatalogTools();
    console.log(`[INFO] Catalog loaded: ${tools.length} tools`);
  }

  if (opts.watch && !opts.stdio) {
    await startCatalogWatcher();
  }

  const mode = opts.stdio ? "stdio" : "http";
  await startServer(mode);
}
