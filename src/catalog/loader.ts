// ============================================================
// LightMCP — Catalog Loader
// Reads and validates the persisted tool_catalog.json
// ============================================================
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadConfig } from "../config.js";
import type { ToolCatalog, ToolEntry } from "../types.js";

const ToolCatalogSchema = z.object({
  version: z.literal(1),
  builtAt: z.string(),
  activeOnly: z.boolean(),
  servers: z.array(z.object({
    key: z.string(),
    transport: z.enum(["stdio", "http"]),
    disabled: z.boolean(),
    toolCount: z.number().int().min(0),
  })),
  tools: z.array(z.object({
    name: z.string(),
    serverKey: z.string(),
    serverTransport: z.enum(["stdio", "http"]),
    description: z.string(),
    inputSchema: z.record(z.unknown()),
    shortDesc: z.string(),
    tip: z.string().optional(),
  })),
});

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
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`[ERROR] Failed to parse ${outPath}: invalid JSON`);
    return null;
  }
  const result = ToolCatalogSchema.safeParse(parsed);
  if (!result.success) {
    console.error(
      `[ERROR] Invalid catalog schema in ${outPath}:`,
      result.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("; ")
    );
    return null;
  }
  _catalog = result.data as ToolCatalog;
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
