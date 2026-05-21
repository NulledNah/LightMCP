// ============================================================
// LightMCP — Ollama REST Client
// Sends the tool-selection prompt and parses the response.
// ============================================================
import { z } from "zod";
import { loadConfig } from "../config.js";
import type { ToolEntry } from "../types.js";
import { buildToolSelectionPrompt } from "../prompts/tool_selector.js";
import { generateDomainKeywords } from "./keywords.js";
import { detectNonEnglish, translateToEnglish } from "./translator.js";

// Expected response: a JSON array of tool name strings
const SelectionSchema = z.array(z.string().min(1));

/**
 * Pre-filter the catalog based on domain keywords in the task.
 * Keywords are dynamically extracted from the catalog (server keys,
 * tool names, descriptions, tips) — no hardcoded server names.
 * Reduces prompt size and eliminates cross-domain noise.
 * Falls back to full catalog if no keywords match.
 */
function filterCatalogByTask(task: string, catalog: ToolEntry[]): ToolEntry[] {
  const lower = task.toLowerCase();
  const keywords = generateDomainKeywords(catalog);

  // Short tasks (≤3 content words) have too few tokens for reliable
  // keyword matching — skip keyword pre-filter, use domain filter only.
  const contentWords = lower.split(/\s+/).filter(w => w.length >= 2);
  const isShort = contentWords.length <= 3;

  if (isShort) {
    const filtered = filterByDomain(lower, catalog);
    if (filtered.length < catalog.length && process.env.LIGHTMCP_VERBOSE) {
      console.log(`\n[DEBUG] Pre-filter: short task ("${task}") — domain-filtered to ${filtered.length} tools`);
    }
    // If domain filter excluded everything, fall back to full catalog
    if (filtered.length === 0) return catalog;
    return filtered;
  }

  // Collect matched servers
  const matched = new Set<string>();
  for (const [server, serverKeywords] of Object.entries(keywords)) {
    for (const kw of serverKeywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`).test(lower)) {
        matched.add(server);
        break; // one match per server is enough
      }
    }
  }

  // No domain match → send full catalog (backward compatible)
  if (matched.size === 0) return catalog;

  // Domain-aware filtering: when the task has clear domain signals,
  // exclude servers from conflicting domains to prevent LLM confusion.
  if (matched.size > 1) {
    const matchedServers = [...matched];
    const domainScores = classifyTaskDomains(lower);
    const totalScore = Object.values(domainScores).reduce((a, b) => a + b, 0);
    // Only apply domain exclusion when the task has a DOMINANT domain
    // (score >= 2) to avoid excluding servers on ambiguous terms like "step".
    const strongDomains = Object.entries(domainScores)
      .filter(([, score]) => score >= 2)
      .map(([d]) => d);

    if (strongDomains.length > 0 && totalScore >= 2) {
      for (const server of [...matched]) {
        const serverDomain = inferServerDomain(server);
        if (serverDomain && !strongDomains.includes(serverDomain)) {
          matched.delete(server);
          if (process.env.LIGHTMCP_VERBOSE) {
            console.log(`\n[DEBUG] Pre-filter: excluded "${server}" (domain ${serverDomain}, task domains: [${strongDomains.join(", ")}])`);
          }
        }
      }
    }
  }

  const filtered = catalog.filter((t) => matched.has(t.serverKey));

  // Safety: if filtering removed ALL tools, fall back to full catalog
  if (filtered.length === 0) return catalog;

  if (process.env.LIGHTMCP_VERBOSE) {
    console.log(`\n[DEBUG] Pre-filter: ${catalog.length} → ${filtered.length} tools (servers: ${[...matched].join(", ")})`);
  }

  return filtered;
}

function filterByDomain(task: string, catalog: ToolEntry[]): ToolEntry[] {
  const domainScores = classifyTaskDomains(task);
  const totalScore = Object.values(domainScores).reduce((a, b) => a + b, 0);
  // For short tasks, use a lower threshold — any domain signal is significant.
  const strongDomains = Object.entries(domainScores)
    .filter(([, score]) => score > 0)
    .map(([d]) => d);

  if (strongDomains.length === 0 || totalScore === 0) return catalog;

  // Collect all server keys
  const allServers = new Set(catalog.map(t => t.serverKey));
  for (const srv of allServers) {
    const srvDomain = inferServerDomain(srv);
    if (srvDomain && !strongDomains.includes(srvDomain)) {
      allServers.delete(srv);
      if (process.env.LIGHTMCP_VERBOSE) {
        console.log(`[DEBUG] Domain filter: excluded "${srv}" (domain ${srvDomain}, task: [${strongDomains.join(", ")}])`);
      }
    }
  }

  return catalog.filter(t => allServers.has(t.serverKey));
}

const DOMAIN_WORDS: Record<string, string[]> = {
  "3d": ["cube", "sphere", "cylinder", "cone", "mesh", "3d", "render", "scene",
         "solid", "surface", "extrude", "primitive", "sculpt", "animate", "stl",
         "step", "obj", "cad", "sketch", "geometry", "modeling", "fusion",
         "blender", "maya", "shape", "polygon", "vertex", "edge", "face"],
  "pcb": ["pcb", "circuit", "board", "schematic", "footprint", "trace", "via",
          "pad", "component", "bom", "gerber", "netlist", "drill", "copper",
          "layer", "solder", "kicad", "eagle", "altium", "electronics",
          "resistor", "capacitor", "microcontroller", "routing"],
  "web": ["browser", "page", "website", "url", "click", "screenshot", "dom",
          "html", "css", "javascript", "js", "scrape", "puppeteer",
          "playwright", "navigate", "form", "tab", "window"],
  "code": ["code", "function", "class", "module", "debug", "refactor", "test",
           "lint", "build", "deploy", "git", "api", "endpoint", "compile",
           "import", "export", "variable", "package", "commit", "branch"],
  "search": ["search", "find", "query", "knowledge", "documentation", "docs",
             "reference", "datasheet", "lookup", "answer"],
};

function classifyTaskDomains(task: string): Record<string, number> {
  const scores: Record<string, number> = { "3d": 0, "pcb": 0, "web": 0, "code": 0, "search": 0 };
  for (const [domain, words] of Object.entries(DOMAIN_WORDS)) {
    for (const w of words) {
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`).test(task)) {
        scores[domain]++;
      }
    }
  }
  return scores;
}

const DOMAIN_KEY_SIGNALS: Record<string, string> = {
  "fusion": "3d", "blender": "3d", "cad": "3d", "autodesk": "3d",
  "onshape": "3d", "sketchup": "3d", "rhino": "3d", "maya": "3d",
  "mesh": "3d", "geometry": "3d", "render": "3d", "sculpt": "3d",
  "kicad": "pcb", "eagle": "pcb", "altium": "pcb", "easyeda": "pcb",
  "pcb": "pcb", "breadboard": "pcb", "schematic": "pcb",
  "chrome": "web", "browser": "web", "puppeteer": "web", "playwright": "web",
  "selenium": "web", "scrape": "web",
  "context7": "search", "brave": "search", "search": "search",
  "knowledge": "search", "google": "search", "docs": "search",
  "sequential": "code", "devtools": "code", "refactor": "code",
  "linter": "code", "codegraph": "code",
};

function inferServerDomain(serverKey: string): string | null {
  const words = serverKey.toLowerCase().split(/[-_]+/);
  for (const signal of Object.keys(DOMAIN_KEY_SIGNALS)) {
    if (words.includes(signal)) return DOMAIN_KEY_SIGNALS[signal];
  }
  // Fallback: substring match (for compound keys like "autodesk-fusion")
  for (const signal of Object.keys(DOMAIN_KEY_SIGNALS)) {
    if (serverKey.includes(signal)) return DOMAIN_KEY_SIGNALS[signal];
  }
  return null;
}

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream: false;
  format: "json" | Record<string, any>;
  options?: {
    temperature?: number;
    num_predict?: number;
    top_k?: number;
    top_p?: number;
  };
}

interface OllamaChatResponse {
  message: { role: string; content: string };
  done: boolean;
}

export async function selectTools(
  task: string,
  catalog: ToolEntry[],
  hints: string[] = []
): Promise<string[]> {
  const cfg = await loadConfig();
  const { host, model, maxRetries } = cfg.ollama;

  // If the task is in a non-English language, translate it so the
  // keyword pre-filter can match English tool names and descriptions.
  let filterTask = task;
  if (detectNonEnglish(task)) {
    try {
      const translated = await translateToEnglish(task, host, model);
      if (translated && translated !== task) {
        filterTask = translated;
        if (process.env.LIGHTMCP_VERBOSE) {
          console.log(`\n[DEBUG] Translated task: "${task}" → "${translated}"`);
        }
      }
    } catch {
      // Translation failed — use original task, no harm done
    }
  }

  // Pre-filter: Match keywords against the (possibly translated) task.
  // Only the translated query is used for keyword matching — the original
  // non-English query would match accidental keywords and pollute domain selection.
  const filtered = filterCatalogByTask(filterTask, catalog);

  const { systemPrompt, userPrompt } = buildToolSelectionPrompt(
    task,
    filtered,
    hints
  );

  const body: OllamaChatRequest = {
    model,
    stream: false,
    format: {
      type: "object",
      properties: {
        reasoning: { type: "string" },
        tools: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["reasoning", "tools"]
    },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    options: {
      temperature: 0.0,   // Deterministic — we want reliable JSON
      num_predict: 1024,  // More room for structured reasoning over large catalogs
      top_k: 20,
      top_p: 0.9,
    },
  };

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const res = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as OllamaChatResponse;
      const raw = data.message?.content ?? "[]";
      if (process.env.LIGHTMCP_VERBOSE) {
        console.log("\n[DEBUG] Raw model output:", raw, "\n");
      }

      // Parse and validate
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Model returned invalid JSON: ${raw.slice(0, 200)}`);
      }

      const result = SelectionSchema.safeParse((parsed as any).tools);
      if (!result.success) {
        throw new Error(
          `Model returned unexpected schema: ${JSON.stringify(parsed).slice(0, 200)}`
        );
      }

      return result.data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt <= maxRetries) {
        console.warn(
          `  [retry ${attempt}/${maxRetries}] Ollama error: ${lastError.message}`
        );
        await new Promise((r) => setTimeout(r, 1_000 * attempt));
      }
    }
  }

  throw lastError ?? new Error("Unknown Ollama error");
}
