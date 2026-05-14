// ============================================================
// LightMCP — Catalog Watcher
// Watches agent config files and triggers a catalog rebuild
// when any of them change. Supports multi-agent setups.
// ============================================================
import chokidar, { type FSWatcher } from "chokidar";
import { buildCatalog } from "./builder.js";
import { invalidateCatalog } from "./loader.js";
import { loadConfig, resolveWatchPaths } from "../config.js";

let _watcher: FSWatcher | null = null;
let _rebuildTimer: NodeJS.Timeout | null = null;
const DEBOUNCE_MS = 2_000;

export async function startCatalogWatcher(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.catalog.watchMcpConfig) return;

  const paths = await resolveWatchPaths();

  if (paths.length === 0) {
    console.log("[INFO] No config files to watch — skipping file watcher");
    return;
  }

  console.log(`[INFO] Watching ${paths.length} file(s) for changes`);
  for (const p of paths) {
    console.log(`  ${p}`);
  }

  _watcher = chokidar.watch(paths, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  _watcher.on("change", (changedPath) => {
    if (_rebuildTimer) clearTimeout(_rebuildTimer);
    _rebuildTimer = setTimeout(async () => {
      console.log(`[INFO] Config changed (${changedPath}) - rebuilding catalog...`);
      try {
        await buildCatalog();
        invalidateCatalog();
      } catch (err) {
        console.error("Catalog rebuild failed:", err);
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
