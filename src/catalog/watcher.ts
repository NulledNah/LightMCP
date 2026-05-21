// ============================================================
// LightMCP — Catalog Watcher
// Watches agent config files + tool_tips.json and triggers
// a catalog rebuild when any of them change.
// ============================================================
import path from "node:path";
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

  const configPaths = await resolveWatchPaths();
  const tipsPath = path.resolve(process.cwd(), "tool_tips.json");
  const paths = [...configPaths, tipsPath];

  if (paths.length === 0) {
    console.log("[INFO] No files to watch — skipping file watcher");
    return;
  }

  console.log(`[INFO] Watching ${paths.length} path(s) for changes`);
  for (const p of paths) {
    console.log(`  ${p}`);
  }

  const rebuild = async (changedPath: string) => {
    console.log(`[INFO] File changed (${changedPath}) - rebuilding catalog...`);
    try {
      await buildCatalog();
      invalidateCatalog();
    } catch (err) {
      console.error("Catalog rebuild failed:", err);
    }
  };

  _watcher = chokidar.watch(paths, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  _watcher.on("change", (changedPath) => {
    if (_rebuildTimer) clearTimeout(_rebuildTimer);
    _rebuildTimer = setTimeout(() => { rebuild(changedPath); }, DEBOUNCE_MS);
  });

  _watcher.on("add", (addedPath) => {
    if (addedPath.endsWith("tool_tips.json")) {
      if (_rebuildTimer) clearTimeout(_rebuildTimer);
      _rebuildTimer = setTimeout(() => { rebuild(addedPath); }, DEBOUNCE_MS);
    }
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
