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

  const systemPrompt = `You are an elite, highly aggressive semantic tool router API.
Your ONLY job is to analyze a task description, think step-by-step about what tools are required, and select the ABSOLUTE MINIMUM set of tools.

CRITICAL RULES - VIOLATION RESULTS IN FATAL ERROR:
1. Respond with ONLY a valid JSON object. No markdown backticks, no text outside the JSON.
2. The JSON object MUST have exactly two properties: "reasoning" (a brief string explaining your choice) and "tools" (an array of tool names as strings).
3. The tool names in the array MUST BE THE EXACT TOOL NAMES from the list provided. NEVER use the Server name.
4. ZERO TOLERANCE FOR IRRELEVANCE: If a tool is not directly, immediately, and obviously required for the specific task domain, DO NOT INCLUDE IT.
5. CROSS-DOMAIN CONTAMINATION IS FORBIDDEN: Do NOT select browser/web tools for hardware/PCB tasks, and vice-versa.
6. PENALTY FOR OVER-SELECTION: Select the absolute minimum number of tools. If 1 tool is enough, only return 1. NEVER select more than 5 tools.
7. If no tools perfectly match, return an empty array: {"reasoning": "No applicable tools found.", "tools": []}

Example valid response:
{"reasoning": "The task asks to create a KiCad footprint. I need the footprint creation tool.", "tools": ["create_footprint"]}

You will be provided with a list of AVAILABLE TOOLS. You must select ONLY the TOOL NAMES from that exact list.`;

  const hintsSection =
    hints.length > 0
      ? `\nAdditional Context / Hints: ${hints.join(", ")}`
      : "";

  const userPrompt = `AVAILABLE TOOLS (Format: - "TOOL_NAME" (Server: SERVER_NAME): DESCRIPTION):
${compact.map(t => `- "${t.n}" (Server: ${t.s}): ${t.d}`).join("\n")}

USER TASK TO ACCOMPLISH:
"${task}"${hintsSection}

INSTRUCTIONS:
1. Read the USER TASK above carefully.
2. Write a short reasoning explaining which tools from the AVAILABLE TOOLS list are strictly necessary to accomplish the USER TASK.
3. Respond ONLY with the JSON object {"reasoning": "...", "tools": ["TOOL_NAME", ...]}. Be ruthlessly minimal.`;

  return { systemPrompt, userPrompt };
}
