// ============================================================
// LightMCP — Prompt Engineer
// Builds the system + user prompt sent to the local model.
// The model must respond with ONLY a JSON object containing
// reasoning + selected tool names.
// ============================================================
import type { ToolEntry } from "../types.js";

/** Compact catalog entry sent to the model */
interface CompactTool {
  n: string;  // name
  s: string;  // server key
  d: string;  // short description (up to 250 chars)
  p: string;  // parameter hints (e.g. "search_term, library, limit")
  t: string;  // procedural tip (when/why to use this tool)
}

/** Server-level domain hints for faster filtering */
const SERVER_DOMAINS: Record<string, string> = {
  kicad: "PCB / EDA design",
  "chrome-devtools-mcp": "Browser / Web DevTools",
  "autodesk-fusion": "3D CAD / Fusion 360",
  "sequential-thinking": "Structured reasoning / analysis",
  "google-developer-knowledge": "Google developer documentation",
  "mcp-server-fetch": "HTTP / web fetching",
  figma: "UI design / Figma",
};

function serverDomain(serverKey: string): string {
  return SERVER_DOMAINS[serverKey] ?? "General";
}

function paramHints(inputSchema: Record<string, unknown> | undefined): string {
  const props = inputSchema?.properties as Record<string, unknown> | undefined;
  if (!props) return "";
  const keys = Object.keys(props).filter((k) => !k.startsWith("$"));
  if (keys.length === 0) return "";
  return ` [params: ${keys.join(", ")}]`;
}

export function buildToolSelectionPrompt(
  task: string,
  catalog: ToolEntry[],
  hints: string[] = []
): { systemPrompt: string; userPrompt: string } {
  // Compress catalog with enriched context
  const compact: CompactTool[] = catalog.map((t) => ({
    n: t.name,
    s: t.serverKey,
    d: t.shortDesc,
    p: paramHints(t.inputSchema),
    t: t.tip ?? "",
  }));

  // Group tools by server
  const grouped = new Map<string, CompactTool[]>();
  for (const t of compact) {
    const list = grouped.get(t.s);
    if (list) {
      list.push(t);
    } else {
      grouped.set(t.s, [t]);
    }
  }

  const systemPrompt = `You are a precise semantic tool router for MCP (Model Context Protocol) servers.

Your job: Given a user's task description, analyze it carefully and select the most relevant tools from the available catalog.

REASONING FRAMEWORK:
1. TASK ANALYSIS — What is the user trying to accomplish? Which domain? (PCB/electronics, 3D CAD, web/browser, code analysis, etc.)
2. CAPABILITY MAPPING — What operations are needed? (searching, creating, listing, modifying, debugging, navigating, etc.)
3. TOOL SELECTION — Which available tools best provide those capabilities? Match tool descriptions and parameter hints to the required operations.

SELECTION GUIDELINES:
- Return tools that are directly necessary to accomplish the task. Exclude tools from irrelevant domains.
- For simple tasks (single operation), 1-3 tools are usually enough.
- For complex multi-step workflows (e.g. search → create → verify), include the complementary tools needed.
- Cross-domain contamination is forbidden: do NOT select browser/devtools for a PCB task, do NOT select CAD tools for a web task.
- Maximum 8 tools, even for the most complex tasks. If in doubt, prefer precision over quantity.
- If no tool from the relevant domain(s) can help with the task, return empty. But when tools exist in the correct domain, always select the best-fitting ones — even if the match is imperfect.

RESPONSE FORMAT (STRICT):
Respond with ONLY a valid JSON object — no markdown fences, no extra text.
The JSON must have exactly two properties:
  "reasoning": a concise string explaining your step-by-step selection logic
  "tools": an array of exact tool names from the provided list

Examples:
{"reasoning": "Task asks to create a KiCad footprint. Domain: PCB. Capability: creating. One tool matches.", "tools": ["create_footprint"]}
{"reasoning": "Task requires searching for existing footprints, creating one, then verifying. Three complementary PCB tools needed.", "tools": ["search_footprints", "create_footprint", "get_footprint_info"]}
{"reasoning": "Task is about cooking recipes. No tools in the available catalog match this domain.", "tools": []}`;

  const hintsSection =
    hints.length > 0
      ? `\nAdditional Context / Hints: ${hints.join(", ")}`
      : "";

  const groupedBlock = Array.from(grouped.entries())
    .map(([server, tools]) => {
      const domain = serverDomain(server);
      const toolLines = tools
        .map((t) => {
          const paramStr = t.p ? ` ${t.p}` : "";
          const tipStr = t.t ? ` [tip: ${t.t}]` : "";
          return `  - "${t.n}": ${t.d}${paramStr}${tipStr}`;
        })
        .join("\n");
      return `=== ${server} [${domain}] ===\n${toolLines}`;
    })
    .join("\n\n");

  const userPrompt = `AVAILABLE TOOLS (grouped by server domain — select TOOL NAMES only):
${groupedBlock}

USER TASK TO ACCOMPLISH:
"${task}"${hintsSection}

INSTRUCTIONS:
1. Read the USER TASK carefully. Identify which server domain(s) are relevant.
2. From the relevant servers, select only the exact tools needed to accomplish the task.
3. Respond with ONLY the JSON object: {"reasoning": "...", "tools": ["TOOL_NAME", ...]}`;

  return { systemPrompt, userPrompt };
}
