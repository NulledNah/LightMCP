// ============================================================
// LightMCP — Prompt Engineer
// Builds the system + user prompt sent to the local model.
// The model must respond with ONLY a JSON object containing
// reasoning + selected tool names.
// ============================================================
import type { ToolEntry } from "../types.js";
import { generateServerDomains } from "../ollama/keywords.js";

/** Compact catalog entry sent to the model */
interface CompactTool {
  n: string;  // name
  s: string;  // server key
  d: string;  // short description (up to 250 chars)
  p: string;  // parameter hints (e.g. "search_term, library, limit")
  t: string;  // procedural tip (when/why to use this tool)
}

function serverDomain(serverKey: string, domains: Record<string, string>): string {
  return domains[serverKey] ?? "General";
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

  const systemPrompt = `You are a precise semantic tool router for MCP (Model Context Protocol) servers. Your primary selection signal is the TIP attached to each tool — the tip describes the exact situation when that tool should be used.

REASONING FRAMEWORK:
1. TASK ANALYSIS — What is the user trying to accomplish?
2. TIP SCANNING — First scan ALL tool tips. Find tips whose situation matches the user's task. A tip saying "When you need to create 3D geometry" matches "create a cube" even if the tool name doesn't contain "cube".
3. TOOL SELECTION — Select tools whose TIP (or description, if no tip) matches the task's intent. Tool names may use technical jargon — IGNORE name mismatch if the tip/description describes the user's need.
4. DOMAIN CLASSIFICATION — Classify which server domain(s) are relevant before picking individual tools.

DOMAIN-TO-TERM MAPPINGS (use these to connect user words to domains):
- 3D / CAD / modeling: cube, sphere, cylinder, mesh, solid, surface, extrude, revolve, boolean, sculpt, animate, rig, bone, texture, render, STL, STEP, OBJ, scene, model, geometry, primitive, polygon, vertex, edge, face
- PCB / electronics / circuit: pcb, board, schematic, footprint, trace, route, via, pad, silkscreen, layer, drill, component, KiCad, Eagle, Altium, Gerber, netlist, BOM, placement
- Web / browser: page, site, URL, click, navigate, form, screenshot, DOM, HTML, CSS, JavaScript, Puppeteer, Playwright, scrape
- Code / development: code, function, class, module, debug, refactor, test, lint, build, deploy, git, API, endpoint

SELECTION GUIDELINES:
- The user's task may be in any language. Mentally translate it to English first.
- Tips are GOLD — a tip that describes the user's situation means SELECT THAT TOOL, even if the tool name looks unrelated.
- Cross-domain contamination is forbidden. Do NOT select browser/devtools for a 3D/PCB task.
- Maximum 8 tools. For simple tasks, 1-3 tools are usually enough.
- If no tool from the relevant domain matches, return empty. But when tools exist in the correct domain, ALWAYS select the best-fitting ones — the match may be imperfect at the surface level (tool name) but correct at the semantic level (tip/description).

RESPONSE FORMAT (STRICT):
Respond with ONLY a valid JSON object — no markdown fences, no extra text.
{"reasoning": "...", "tools": ["EXACT_TOOL_NAME", ...]}`;

  const hintsSection =
    hints.length > 0
      ? `\nAdditional Context / Hints: ${hints.join(", ")}`
      : "";

  const domains = generateServerDomains(catalog);

  const groupedBlock = Array.from(grouped.entries())
    .map(([server, tools]) => {
      const domain = serverDomain(server, domains);
      const toolLines = tools
        .map((t) => {
          const paramStr = t.p ? ` ${t.p}` : "";
          const tipStr = t.t ? `  TIP: ${t.t}\n    → ${t.d}${paramStr}` : `  → ${t.d}${paramStr}`;
          return `  - "${t.n}": ${tipStr}`;
        })
        .join("\n");
      return `=== ${server} [${domain}] ===\n${toolLines}`;
    })
    .join("\n\n");

  const userPrompt = `AVAILABLE TOOLS (with tips showing WHEN to use each tool):
${groupedBlock}

USER TASK:
"${task}"${hintsSection}

INSTRUCTIONS:
1. Scan ALL tool TIPs first — find tips whose situation matches the user's task.
2. Verify the match using the tool description. Select the matched tools.
3. Respond with ONLY: {"reasoning": "...", "tools": ["TOOL_NAME", ...]}`;

  return { systemPrompt, userPrompt };
}
