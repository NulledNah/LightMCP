// ============================================================
// LightMCP — Ollama REST Client
// Sends the tool-selection prompt and parses the response.
// ============================================================
import { z } from "zod";
import { loadConfig } from "../config.js";
import type { ToolEntry } from "../types.js";
import { buildToolSelectionPrompt } from "../prompts/tool_selector.js";

// Expected response: a JSON array of tool name strings
const SelectionSchema = z.array(z.string().min(1));

/** Domain keyword → server key mapping for pre-filtering the catalog */
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  "autodesk-fusion": ["fusion", "cad", "3d", "cube", "model", "sketch", "extrude", "body", "autodesk", "solid", "mesh", "render"],
  kicad: ["pcb", "kicad", "footprint", "schematic", "board", "trace", "pad", "routing", "circuit", "net", "drc", "erc", "gerber", "netlist", "copper"],
  "chrome-devtools-mcp": ["browser", "web", "page", "url", "chrome", "screenshot", "navigate", "console", "devtools", "javascript", "css", "html", "dom", "network", "performance", "lighthouse"],
  "sequential-thinking": ["think", "reason", "analyze", "step by step", "break down", "ponder", "deliberate"],
  "google-developer-knowledge": ["google", "api doc", "developer documentation", "gcp", "firebase", "adk"],
};

/**
 * Pre-filter the catalog based on domain keywords in the task.
 * Reduces prompt size and eliminates cross-domain noise.
 * Falls back to full catalog if no keywords match.
 */
function filterCatalogByTask(task: string, catalog: ToolEntry[]): ToolEntry[] {
  const lower = task.toLowerCase();

  // Collect matched servers
  const matched = new Set<string>();
  for (const [server, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        matched.add(server);
        break; // one match per server is enough
      }
    }
  }

  // No domain match → send full catalog (backward compatible)
  if (matched.size === 0) return catalog;

  const filtered = catalog.filter((t) => matched.has(t.serverKey));

  // Safety: if filtering removed ALL tools, fall back to full catalog
  if (filtered.length === 0) return catalog;

  if (process.env.LIGHTMCP_VERBOSE) {
    console.log(`\n[DEBUG] Pre-filter: ${catalog.length} → ${filtered.length} tools (servers: ${[...matched].join(", ")})`);
  }

  return filtered;
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

  const { systemPrompt, userPrompt } = buildToolSelectionPrompt(
    task,
    filterCatalogByTask(task, catalog),
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
