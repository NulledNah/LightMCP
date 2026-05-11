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

  const systemPrompt = `You are a precise tool selector for the LightMCP system.
Your ONLY job is to analyze a task description and select the minimum set of tools required to complete it.

RULES (MUST follow strictly):
1. Respond with ONLY a valid JSON array of tool name strings. No markdown, no explanation, no code blocks.
2. Include ONLY tools that are DIRECTLY necessary for the given task.
3. Do NOT include general-purpose or exploratory tools unless explicitly required.
4. If no tools are needed, respond with: []
5. Tool names must be copied EXACTLY as they appear in the catalog.
6. Maximum 15 tools per response.

Example response: ["create_footprint","list_footprint_libraries","get_footprint_info"]`;

  const hintsSection =
    hints.length > 0
      ? `\nAdditional context: ${hints.join(", ")}`
      : "";

  const userPrompt = `TASK: ${task}${hintsSection}

AVAILABLE TOOLS (format: {"n":"name","s":"server","d":"description"}):
${JSON.stringify(compact)}

Respond with the JSON array of tool names needed for this task.`;

  return { systemPrompt, userPrompt };
}
