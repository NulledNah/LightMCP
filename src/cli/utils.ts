// ============================================================
// LightMCP — CLI Utilities
// ============================================================
import path from "node:path";

export function cleanTip(raw: string, toolName: string): string {
  let tip = raw;
  const n = toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  tip = tip.replace(new RegExp(`^Use\\s+['\`"]${n}['\`"]\\s+(when|to|for|in|as|with)\\s+`, 'i'),
    (_: string, w: string) => w.charAt(0).toUpperCase() + w.slice(1) + " ");
  tip = tip.replace(new RegExp(`^Use\\s+['\`"]${n}['\`"][,\\s]*`, 'i'), "");

  tip = tip.replace(new RegExp(`([,;])\\s*use\\s+['\`"]${n}['\`"]\\s+(to|for|as|when|in|with)\\s+`, 'gi'),
    (_: string, p: string, w: string) => p + " " + w + " ");
  tip = tip.replace(new RegExp(`([,;])\\s*use\\s+['\`"]${n}['\`"][.,]?\\s*`, 'gi'), "$1 ");

  tip = tip.replace(new RegExp(`\\.\\s*Use\\s+['\`"]${n}['\`"]\\s+(to|for|as|when|in|with)\\s+`, 'g'),
    (_: string, w: string) => ". " + w.charAt(0).toUpperCase() + w.slice(1) + " ");
  tip = tip.replace(new RegExp(`\\.\\s*Use\\s+['\`"]${n}['\`"][.,]?\\s*`, 'gi'), ". ");

  tip = tip.replace(/[,;]\s*Use this tool\s+(to|for|as|when)\s+/gi,
    (_: string, w: string) => ", " + w + " ");
  tip = tip.replace(/\.\s*Use this tool\s+(to|for|as|when)\s+/g,
    (_: string, w: string) => ". " + w.charAt(0).toUpperCase() + w.slice(1) + " ");

  tip = tip.replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").trim();
  if (tip.length > 0) tip = tip.charAt(0).toUpperCase() + tip.slice(1);
  return tip;
}

export function safePath(inputPath: string): string {
  const resolved = path.resolve(process.cwd(), inputPath);
  if (resolved.includes(".." + path.sep) || resolved.includes(path.sep + "..")) {
    throw new Error(`Path traversal detected: ${inputPath}`);
  }
  return resolved;
}
