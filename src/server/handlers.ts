// ============================================================
// LightMCP — MCP Server Handler
// Implements `get_task_tools` + dynamic tool registration.
// Selected tools are registered on the McpServer so the agent
// can call them through LightMCP (forwarded transparently).
// ============================================================
import { z } from "zod";
import { getCatalogTools } from "../catalog/loader.js";
import { buildCatalog } from "../catalog/builder.js";
import { ensureOllamaReady } from "../ollama/manager.js";
import { selectTools } from "../ollama/client.js";
import type { ToolEntry } from "../types.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";

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

let _registeredTools: RegisteredTool[] = [];
let _lastSelectedNames: string[] = [];

/** Remove all dynamically registered tools from the McpServer. */
async function unregisterAllTools(): Promise<void> {
  const { untrackTool } = await import("./mcp_server.js");
  for (const name of _lastSelectedNames) {
    untrackTool(name);
  }
  for (const reg of _registeredTools) {
    try {
      reg.remove();
    } catch {
      // Already removed or never registered
    }
  }
  _registeredTools = [];
  _lastSelectedNames = [];
}

/** Loose input schema for proxied tools — accepts any object. */
const PassthroughSchema = z.object({}).passthrough();

export async function handleGetTools(input: GetToolsInput): Promise<{
  content: { type: "text"; text: string }[];
}> {
  const { task, hints = [] } = input;

  // 1. Load catalog (auto-build if missing)
  let catalog = await getCatalogTools();
  if (catalog.length === 0) {
    console.log("[INFO] Catalog empty - building for the first time...");
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

  // 4. Validate: only keep tools that exist in the catalog
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

  // 5. Dynamically register selected tools on the McpServer
  //    so the agent can call them through LightMCP.
  try {
    const { getMcpServer, trackTool, untrackTool } = await import("./mcp_server.js");
    const { callTool } = await import("./proxy.js");
    const mcpServer = getMcpServer();

    // Remove previously registered tools
    for (const reg of _registeredTools) {
      try {
        reg.remove();
      } catch {
        // Already removed
      }
    }
    // Also untrack their names
    for (const t of _lastSelectedNames) {
      untrackTool(t);
    }
    _registeredTools = [];
    _lastSelectedNames = [];

    // Register each selected tool with a forward handler
    for (const entry of validEntries) {
      const serverKey = entry.serverKey;
      const toolName = entry.name;

      const registered = mcpServer.registerTool(
        toolName,
        {
          description: entry.description || `Tool from ${serverKey}`,
          inputSchema: PassthroughSchema,
          _meta: {
            serverKey,
            transport: entry.serverTransport,
          },
        },
        async (args) => {
          return callTool(serverKey, toolName, args as Record<string, unknown> | undefined);
        }
      );
      _registeredTools.push(registered);
      _lastSelectedNames.push(toolName);
      trackTool(toolName, entry.shortDesc || entry.description?.slice(0, 100) || `Tool from ${serverKey}`);
    }

    if (validEntries.length > 0) {
      console.log(`  [REG] Registered ${validEntries.length} tool(s) for agent use`);
    }
  } catch (err) {
    console.error("Failed to register tools on McpServer:", err);
  }

  // 6. Return summary as text content
  const result = {
    task,
    selected: validEntries.length,
    total: catalog.length,
    tools: validEntries.map((t) => ({
      name: t.name,
      serverKey: t.serverKey,
      transport: t.serverTransport,
      description: t.shortDesc || t.description?.slice(0, 100),
    })),
  };

  console.log(
    `  [OK] Selected ${validEntries.length}/${catalog.length} tools for: "${task.slice(0, 60)}..."`
  );

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
