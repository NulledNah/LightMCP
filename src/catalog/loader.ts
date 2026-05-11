// ============================================================
// LightMCP — Catalog Loader
// Reads and validates the persisted tool_catalog.json
// ============================================================
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";
import type { ToolCatalog, ToolEntry } from "../types.js";

let _catalog: ToolCatalog | null = null;

export function invalidateCatalog(): void {
  _catalog = null;
}

export async function loadCatalog(): Promise<ToolCatalog | null> {
  if (_catalog) return _catalog;

  const cfg = await loadConfig();
  const outPath = path.resolve(process.cwd(), cfg.catalog.outputPath);

  if (!existsSync(outPath)) return null;

  const raw = await readFile(outPath, "utf-8");
  _catalog = JSON.parse(raw) as ToolCatalog;
  return _catalog;
}

/** Returns all ToolEntry[] from the catalog, or empty array if not built yet */
export async function getCatalogTools(): Promise<ToolEntry[]> {
  const catalog = await loadCatalog();
  return catalog?.tools ?? [];
}

/** Looks up a tool by name — used for validation */
export async function findTool(name: string): Promise<ToolEntry | undefined> {
  const tools = await getCatalogTools();
  return tools.find((t) => t.name === name);
}

/** Returns catalog metadata (no tools array) — for status display */
export async function getCatalogMeta(): Promise<{
  builtAt: string;
  toolCount: number;
  serverCount: number;
  activeOnly: boolean;
} | null> {
  const catalog = await loadCatalog();
  if (!catalog) return null;
  return {
    builtAt: catalog.builtAt,
    toolCount: catalog.tools.length,
    serverCount: catalog.servers.length,
    activeOnly: catalog.activeOnly,
  };
}
