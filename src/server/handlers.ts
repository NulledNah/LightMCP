// ============================================================
// LightMCP — MCP Server Handler
// Implements `get_task_tools` + dynamic tool registration.
// Selected tools are registered on the McpServer so the agent
// can call them through LightMCP (forwarded transparently).
// Uses SDK-native patterns — no manual tool tracking.
// ============================================================
import { z } from "zod";
import { getCatalogTools } from "../catalog/loader.js";
import { buildCatalog } from "../catalog/builder.js";
import { ensureOllamaReady } from "../ollama/manager.js";
import { selectTools } from "../ollama/client.js";
import { getMcpServer } from "./mcp_server.js";
import { callTool } from "./proxy.js";
import { qualifyToolName } from "../types.js";
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
let _registrationLock: Promise<void> = Promise.resolve();

async function withRegistrationLock(fn: () => Promise<void>): Promise<void> {
  const prev = _registrationLock;
  let release: () => void;
  _registrationLock = new Promise<void>((r) => { release = r; });
  await prev;
  try {
    await fn();
  } finally {
    release!();
  }
}

const INJECTION_PATTERNS = [
  /system:\s*/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /\[INST\]/gi,
  /\[SYS\]/gi,
  /<<SYS>>/gi,
  /ignore (all |previous )?instructions/i,
  /disregard previous/i,
  /you are now/i,
  /forget (everything|all)/i,
];

function containsInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

export async function handleGetTools(input: GetToolsInput): Promise<{
  content: { type: "text"; text: string }[];
}> {
  const { task, hints = [] } = input;

  if (containsInjection(task) || hints.some((h: string) => containsInjection(h))) {
    return {
      content: [{ type: "text", text: JSON.stringify({ selected: 0, tools: [], total: 0 }) }],
    };
  }

  let catalog = await getCatalogTools();
  if (catalog.length === 0) {
    console.log("[INFO] Catalog empty - building for the first time...");
    const built = await buildCatalog();
    catalog = built.tools;
  }

  await ensureOllamaReady();

  let selectedNames: string[];
  try {
    selectedNames = await selectTools(task, catalog, hints);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: JSON.stringify({ error: `Tool selection failed: ${msg}`, tools: [] }) }],
    };
  }

  const catalogMap = new Map<string, ToolEntry>(catalog.map((t) => [t.name, t]));
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
    console.warn(`  [WARN] Model hallucinated ${invalid.length} non-existent tools: ${invalid.join(", ")}`);
  }

  await withRegistrationLock(async () => {
    const mcpServer = getMcpServer();

    for (const reg of _registeredTools) {
      try { reg.remove(); } catch { /* ignore */ }
    }
    _registeredTools = [];

    for (const entry of validEntries) {
      const serverKey = entry.serverKey;
      const toolName = entry.name;
      const qualifiedName = qualifyToolName(serverKey, toolName);

      try {
        const registered = mcpServer.registerTool(
          qualifiedName,
          {
            description: entry.description || `Tool from ${serverKey}`,
            _meta: { serverKey, toolName, transport: entry.serverTransport },
          },
          async (args) => {
            const result = await callTool(serverKey, toolName, args as Record<string, unknown> | undefined);
            return { content: result.content, isError: result.isError };
          }
        );
        _registeredTools.push(registered);
      } catch (err) {
        console.error(`  [WARN] Failed to register tool "${qualifiedName}":`, err instanceof Error ? err.message : String(err));
      }
    }

    // Notify all connected clients that the tool list changed
    mcpServer.sendToolListChanged();

    if (validEntries.length > 0) {
      console.log(`  [REG] Registered ${validEntries.length} tool(s) for agent use`);
    }
  }).catch((err) => {
    console.error("Failed to register tools on McpServer:", err);
  });

  const result = {
    task,
    selected: validEntries.length,
    total: catalog.length,
    tools: validEntries.map((t) => {
      const qualifiedName = qualifyToolName(t.serverKey, t.name);
      const props = (t.inputSchema as Record<string, unknown>)?.properties as Record<string, unknown> | undefined;
      const argNames = props ? Object.keys(props) : [];
      const exampleArgs = argNames.length > 0
        ? "--" + argNames.map(k => `${k} "<value>"`).join(" --")
        : "";
      return {
        name: qualifiedName,
        originalName: t.name,
        serverKey: t.serverKey,
        transport: t.serverTransport,
        description: t.shortDesc || t.description?.slice(0, 100),
        inputSchema: t.inputSchema,
        usage: `lightmcp call ${qualifiedName} ${exampleArgs}`.trim(),
        tip: t.tip || undefined,
      };
    }),
  };

  console.log(`  [OK] Selected ${validEntries.length}/${catalog.length} tools for: "${(task ?? "").slice(0, 60)}..."`);

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
