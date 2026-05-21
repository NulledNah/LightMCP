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
    if (!words) {
      words = new Set();
      serverWords.set(t.serverKey, words);
      const skw = new Set<string>();
      serverKeyWords.set(t.serverKey, skw);
      // Server key words are always kept (most specific)
      for (const w of splitIntoWords(t.serverKey)) {
        words.add(w);
        skw.add(w);
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

  // Semantic domain expansion: add common user-facing terms per inferred domain.
  // This bridges the gap between user vocabulary ("cube") and tool vocabulary ("mesh").
  expandDomainKeywords(result, catalog);

  return result;
}

/** Generate a one-line capability summary per server from its tools. */
export function generateServerCapabilities(catalog: ToolEntry[]): Record<string, string> {
  const cap: Record<string, string> = {};
  const serverDescs = new Map<string, string[]>();

  for (const t of catalog) {
    const descs = serverDescs.get(t.serverKey) ?? [];
    descs.push(t.name);
    serverDescs.set(t.serverKey, descs);
  }

  for (const [server, toolNames] of serverDescs) {
    const verbs = new Set<string>();
    const nouns = new Set<string>();
    for (const name of toolNames) {
      const parts = name.split("_");
      for (const p of parts) {
        const lower = p.toLowerCase();
        if (["get", "list", "search", "find", "create", "add", "update", "edit",
             "delete", "remove", "export", "import", "route", "place", "move",
             "rotate", "execute", "read", "write", "download", "check", "run",
             "generate", "sync", "snapshot", "open", "save", "set", "annotate",
             "replace", "duplicate", "align", "group", "refill", "enrich",
             "suggest", "register", "launch", "suggest", "connect",
            ].includes(lower)) {
          verbs.add(lower);
        }
        if (["footprint", "symbol", "schematic", "board", "pcb", "component", "trace",
             "via", "net", "zone", "layer", "pad", "project", "library", "model",
             "script", "sketch", "geometry", "mesh", "scene", "bom", "gerber",
             "drill", "drc", "erc", "netlist", "datasheet", "jlcpcb", "part",
             "parts", "database", "label", "wire", "text", "hole", "outline",
             "pour", "pair", "category", "tool", "view", "svg", "pdf", "stl",
             "step", "vrml", "pin", "annotation", "array", "position", "file",
             "constraints", "rules", "design", "routing", "pattern",
            ].includes(lower)) {
          nouns.add(lower);
        }
      }
    }

    const verbList = [...verbs].slice(0, 6);
    const nounList = [...nouns].slice(0, 6);
    cap[server] = `Capabilities: ${verbList.join("/")} ${nounList.join("|")}`;
  }

  return cap;
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

  // Append inferred domain category to labels for stronger LLM guidance
  const result: Record<string, string> = {};
  for (const [server, label] of servers) {
    const domain = inferDomain([...splitIntoWords(server)]);
    if (domain) {
      const domainLabels: Record<string, string> = {
        "3d": "3D CAD / Modeling",
        "pcb": "PCB / Electronics",
        "web": "Web / Browser",
        "code": "Code / Development",
        "search": "Search / Knowledge",
      };
      result[server] = `${label} [${domainLabels[domain] ?? domain}]`;
    } else {
      result[server] = label;
    }
  }

  return result;
}

// Domain expansion: maps common user-facing terms to domain categories.
// When a server's tools/descriptions suggest a domain, the server inherits
// these expansion keywords so user vocabulary matches (e.g. "cube" → 3D server).
const DOMAIN_SIGNALS: Record<string, string[]> = {
  "3d": [
    "cube", "sphere", "cylinder", "cone", "torus", "pyramid", "box",
    "mesh", "3d", "geometry", "model", "render", "scene", "solid",
    "surface", "extrude", "revolve", "primitive", "shape", "sculpt",
    "animate", "rig", "bone", "texture", "stl", "step", "obj", "cad",
    "sketch", "assembly", "mechanical", "parametric", "boolean",
    "polygon", "vertex", "edge", "face", "dimension", "drawing",
    "blueprint", "prototype", "manufacturing", "cnc", "print",
  ],
  "pcb": [
    "pcb", "circuit", "board", "schematic", "layout", "trace", "via",
    "pad", "component", "bom", "gerber", "netlist", "drill", "copper",
    "layer", "solder", "assembly", "footprint", "silkscreen",
    "electrical", "electronics", "resistor", "capacitor", "diode",
    "microcontroller", "connector", "header", "routing",
    "design", "rules", "clearance", "width", "thickness",
  ],
  "web": [
    "web", "browser", "page", "site", "url", "click", "screenshot",
    "dom", "html", "css", "javascript", "js", "scrape", "puppeteer",
    "playwright", "navigate", "form", "input", "button", "tab",
    "window", "iframe", "console", "network", "cookie", "storage",
  ],
  "code": [
    "code", "debug", "refactor", "test", "lint", "build", "deploy",
    "git", "api", "endpoint", "function", "class", "module", "import",
    "export", "variable", "type", "interface", "compile", "runtime",
    "dependency", "package", "version", "commit", "branch", "merge",
  ],
  "search": [
    "search", "find", "query", "lookup", "knowledge", "documentation",
    "docs", "reference", "specification", "datasheet", "manual",
    "guide", "tutorial", "example", "sample", "answer", "question",
  ],
};

const DOMAIN_KEY_SIGNALS: Record<string, string> = {
  "fusion": "3d",
  "blender": "3d",
  "cad": "3d",
  "freecad": "3d",
  "solidworks": "3d",
  "autodesk": "3d",
  "onshape": "3d",
  "sketchup": "3d",
  "rhino": "3d",
  "maya": "3d",
  "mesh": "3d",
  "model": "3d",
  "geometry": "3d",
  "render": "3d",
  "stl": "3d",
  "step": "3d",
  "obj": "3d",
  "kicad": "pcb",
  "pcb": "pcb",
  "circuit": "pcb",
  "board": "pcb",
  "eagle": "pcb",
  "altium": "pcb",
  "easyeda": "pcb",
  "schematic": "pcb",
  "breadboard": "pcb",
  "chrome": "web",
  "browser": "web",
  "puppeteer": "web",
  "playwright": "web",
  "selenium": "web",
  "web": "web",
  "page": "web",
  "scrape": "web",
  "context7": "search",
  "brave": "search",
  "search": "search",
  "knowledge": "search",
  "docs": "search",
  "google": "search",
  "sequential": "code",
  "code": "code",
  "devtools": "code",
  "debug": "code",
  "refactor": "code",
  "linter": "code",
  "lint": "code",
};

function inferDomain(existingKeywords: string[]): string | null {
  const scores: Record<string, number> = {};
  for (const kw of existingKeywords) {
    const domain = DOMAIN_KEY_SIGNALS[kw];
    if (domain) {
      scores[domain] = (scores[domain] ?? 0) + 1;
    }
  }
  let best: string | null = null;
  let bestScore = 0;
  for (const [domain, score] of Object.entries(scores)) {
    if (score > bestScore) { best = domain; bestScore = score; }
  }
  return best;
}

function expandDomainKeywords(
  result: Record<string, string[]>,
  catalog: ToolEntry[]
): void {
  for (const [server, keywords] of Object.entries(result)) {
    const domain = inferDomain(keywords);
    if (!domain) continue;

    const expansions = DOMAIN_SIGNALS[domain];
    if (!expansions) continue;

    const set = new Set(keywords);
    for (const w of expansions) {
      if (!set.has(w)) {
        keywords.push(w);
        set.add(w);
      }
    }
  }
}
