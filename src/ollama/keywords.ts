// ============================================================
// LightMCP — Dynamic Keyword & Domain Generation
// Generates domain keywords and server labels from the tool
// catalog at runtime. No hardcoded server names.
// ============================================================
import type { ToolEntry } from "../types.js";

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with",
  "by", "from", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "shall", "should", "can", "could", "may", "might",
  "it", "its", "this", "that", "these", "those", "you", "your", "he", "she", "his", "her",
  "not", "no", "nor", "as", "if", "then", "than", "so", "just", "also", "very", "too",
  "into", "onto", "up", "down", "out", "off", "over", "under", "about", "when", "where",
  "which", "who", "whom", "how", "all", "any", "both", "each", "few", "more", "most",
  "other", "some", "such", "only", "own", "same", "new", "now", "use", "used", "using",
  "need", "needs", "needed", "add", "get", "set", "run", "make", "makes", "made",
]);

function splitIntoWords(str: string): string[] {
  return str
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map(w => w.toLowerCase())
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w));
}

export function generateDomainKeywords(catalog: ToolEntry[]): Record<string, string[]> {
  const serverWords = new Map<string, Set<string>>();
  const serverKeyWords = new Map<string, Set<string>>();

  for (const t of catalog) {
    let words = serverWords.get(t.serverKey);
    let keyWords = serverKeyWords.get(t.serverKey);
    if (!words) {
      words = new Set();
      serverWords.set(t.serverKey, words);
      keyWords = new Set();
      serverKeyWords.set(t.serverKey, keyWords);
      // Server key words are always kept (most specific)
      for (const w of splitIntoWords(t.serverKey)) {
        words.add(w);
        keyWords.add(w);
      }
    }

    // Tool name words
    for (const w of splitIntoWords(t.name)) {
      words.add(w);
    }

    // Description / tip — collect for cross-server dedup below
    for (const field of [t.shortDesc, t.description, t.tip]) {
      if (field) {
        for (const w of splitIntoWords(field)) {
          words.add(w);
        }
      }
    }
  }

  // Remove words that appear in more than one server
  // (they're too generic to distinguish domains)
  const wordServerCount = new Map<string, number>();
  for (const wordSet of serverWords.values()) {
    for (const w of wordSet) {
      wordServerCount.set(w, (wordServerCount.get(w) ?? 0) + 1);
    }
  }

  const result: Record<string, string[]> = {};
  for (const [server, wordSet] of serverWords) {
    const keys = serverKeyWords.get(server) ?? new Set();
    result[server] = [...wordSet].filter(
      (w) => keys.has(w) || (wordServerCount.get(w) ?? 0) <= 1
    );
  }

  return result;
}

export function generateServerDomains(catalog: ToolEntry[]): Record<string, string> {
  const servers = new Map<string, string>();

  for (const t of catalog) {
    if (!servers.has(t.serverKey)) {
      const label = t.serverKey
        .split(/[-_]+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      servers.set(t.serverKey, label);
    }
  }

  return Object.fromEntries(servers);
}
