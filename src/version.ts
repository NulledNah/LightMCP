// ============================================================
// LightMCP — Shared Version Reader
// Single source of truth for the package version.
// Reads package.json at runtime; falls back to "0.0.0".
// ============================================================
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

let _version: string | null = null;

export async function getVersion(): Promise<string> {
  if (_version) return _version;
  try {
    const pkgPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../package.json"
    );
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as { version: string };
    _version = pkg.version;
  } catch {
    _version = "0.0.0";
  }
  return _version;
}
