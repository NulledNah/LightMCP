// ============================================================
// LightMCP — Catalog Watcher
// Watches mcp_config.json and triggers a catalog rebuild
// when the file changes.
// ============================================================
import chokidar, { type FSWatcher } from "chokidar";
import { buildCatalog } from "./builder.js";
import { invalidateCatalog } from "./loader.js";
import { loadConfig, resolveMcpConfigPath } from "../config.js";

let _watcher: FSWatcher | null = null;
let _rebuildTimer: NodeJS.Timeout | null = null;
const DEBOUNCE_MS = 2_000;

export async function startCatalogWatcher(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.catalog.watchMcpConfig) return;

  const mcpConfigPath = await resolveMcpConfigPath(cfg);

  console.log(`[INFO] Watching for changes: ${mcpConfigPath}`);

  _watcher = chokidar.watch(mcpConfigPath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  _watcher.on("change", () => {
    // Debounce to avoid rebuilding multiple times during saves
    if (_rebuildTimer) clearTimeout(_rebuildTimer);
    _rebuildTimer = setTimeout(async () => {
      console.log("[INFO] mcp_config.json changed - rebuilding catalog...");
      invalidateCatalog();
      try {
        await buildCatalog();
      } catch (err) {
        console.error("❌ Catalog rebuild failed:", err);
      }
    }, DEBOUNCE_MS);
  });

  _watcher.on("error", (err) => {
    console.error("Watcher error:", err);
  });
}

export async function stopCatalogWatcher(): Promise<void> {
  if (_rebuildTimer) clearTimeout(_rebuildTimer);
  if (_watcher) {
    await _watcher.close();
    _watcher = null;
  }
}
