// ============================================================
// LightMCP — Prompt Engineer
// Builds the system + user prompt sent to the local model.
// The model must respond with ONLY a JSON array of tool names.
// ============================================================
import type { ToolEntry } from "../types.js";

/** Compact catalog entry sent to the model */
interface CompactTool {
  n: string;  // name
  s: string;  // server key
  d: string;  // short description
}

export function buildToolSelectionPrompt(
  task: string,
  catalog: ToolEntry[],
  hints: string[] = []
): { systemPrompt: string; userPrompt: string } {
  // Compress catalog to minimal representation to save tokens
  const compact: CompactTool[] = catalog.map((t) => ({
    n: t.name,
    s: t.serverKey,
    d: t.shortDesc,
  }));

  const systemPrompt = `You are a strict JSON-only API.
Your ONLY job is to analyze a task description and select the minimum set of tools required to complete it.

RULES:
1. Respond with ONLY a valid JSON object. Do not use markdown backticks.
2. The JSON object MUST have a single property "tools", which is an array of strings.
3. The strings must be ONLY the names of the tools you select.
4. Example of valid response: {"tools": ["create_footprint", "list_footprint_libraries"]}
5. If no tools are needed, respond with: {"tools": []}
6. Include ONLY tools that are DIRECTLY necessary. Maximum 15 tools.`;

  const hintsSection =
    hints.length > 0
      ? `\nAdditional context: ${hints.join(", ")}`
      : "";

  const userPrompt = `TASK: ${task}${hintsSection}

AVAILABLE TOOLS:
${compact.map(t => `- "${t.n}" (${t.s}): ${t.d}`).join("\n")}

Respond ONLY with the JSON object {"tools": [...]}.`;

  return { systemPrompt, userPrompt };
}
