// ============================================================
// LightMCP — MCP Server Handler
// Implements the `lightmcp_get_tools` tool logic.
// ============================================================
import { z } from "zod";
import { getCatalogTools } from "../catalog/loader.js";
import { buildCatalog } from "../catalog/builder.js";
import { ensureOllamaReady } from "../ollama/manager.js";
import { selectTools } from "../ollama/client.js";
import type { ToolEntry } from "../types.js";

export const GetToolsInputSchema = z.object({
  task: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      "Natural language description of the task you need tools for. Be specific."
    ),
  hints: z
    .array(z.string())
    .optional()
    .describe(
      "Optional keywords to guide selection (e.g. server names, tool categories)"
    ),
});

export type GetToolsInput = z.infer<typeof GetToolsInputSchema>;

/** MCP tool definition shape returned to the main agent */
interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  _lightmcp: {
    serverKey: string;
    transport: "stdio" | "http";
  };
}

function toolEntryToMCPDef(entry: ToolEntry): MCPToolDefinition {
  return {
    name: entry.name,
    description: entry.description,
    inputSchema: entry.inputSchema,
    _lightmcp: {
      serverKey: entry.serverKey,
      transport: entry.serverTransport,
    },
  };
}

export async function handleGetTools(input: GetToolsInput): Promise<{
  content: { type: "text"; text: string }[];
}> {
  const { task, hints = [] } = input;

  // 1. Load catalog (auto-build if missing)
  let catalog = await getCatalogTools();
  if (catalog.length === 0) {
    console.log("📂 Catalog empty — building for the first time…");
    const built = await buildCatalog();
    catalog = built.tools;
  }

  // 2. Start Ollama on-demand
  await ensureOllamaReady();

  // 3. Ask the local model to select tools
  let selectedNames: string[];
  try {
    selectedNames = await selectTools(task, catalog, hints);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Tool selection failed: ${msg}`, tools: [] }),
        },
      ],
    };
  }

  // 4. Validate: only return tools that actually exist in the catalog
  const catalogMap = new Map<string, ToolEntry>(
    catalog.map((t) => [t.name, t])
  );
  const validEntries: ToolEntry[] = [];
  const invalid: string[] = [];

  for (const name of selectedNames) {
    const entry = catalogMap.get(name);
    if (entry) {
      validEntries.push(entry);
    } else {
      invalid.push(name);
    }
  }

  if (invalid.length > 0) {
    console.warn(
      `  [warn] Model hallucinated ${invalid.length} non-existent tools: ${invalid.join(", ")}`
    );
  }

  // 5. Return MCP tool definitions as JSON text content
  const result = {
    task,
    selected: validEntries.length,
    total: catalog.length,
    tools: validEntries.map(toolEntryToMCPDef),
  };

  console.log(
    `  ✔ Selected ${validEntries.length}/${catalog.length} tools for: "${task.slice(0, 60)}…"`
  );

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
