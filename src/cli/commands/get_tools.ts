// ============================================================
// LightMCP — get-tools command
// ============================================================
import { mcpHandshake } from "../utils.js";

export async function getToolsAction(task: string, opts: { hints: string }): Promise<void> {
  const { loadConfig } = await import("../../config.js");
  const cfg = await loadConfig();
  const url = `http://${cfg.server.host}:${cfg.server.port}/mcp`;
  const hints = opts.hints ? opts.hints.split(",").map((h) => h.trim()) : [];

  let serverStarted = false;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const sessionId = await mcpHandshake(url);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "tools/call",
          params: { name: "get_task_tools", arguments: { task, hints } },
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.ok) {
        const data = (await res.json()) as { result?: { content?: { type: string; text: string }[] } };
        const text = (data.result as any)?.content?.[0]?.text;
        if (text) {
          const result = JSON.parse(text);
          for (const t of result.tools ?? []) {
            console.log(`${t.name} [${t.serverKey}] ${t.description}`);
            if (t.usage) console.log(`  Usage: ${t.usage}`);
          }
          console.log(`\n${result.selected ?? result.tools?.length ?? 0}/${result.total ?? "?"} tools selected — ready to call`);
          return;
        }
      }
      break;
    } catch (err: unknown) {
      const e = err as Error;
      const code = (e as any)?.cause?.code ?? (e as any)?.code ?? "";
      const isAbort = e.name === "AbortError" || e.name === "TimeoutError" || (e as any)?.code === 23;
      const isConnErr = /ECONNREFUSED|ENOTFOUND|EADDRNOTAVAIL|fetch failed/i.test(code) ||
        /ECONNREFUSED|fetch failed/i.test(e.message ?? "");
      if ((isConnErr || isAbort) && attempt < 3) {
        if (!serverStarted) {
          serverStarted = true;
          const { spawn } = await import("node:child_process");
          const { fileURLToPath } = await import("node:url");
          const pathMod = await import("node:path");
          const cliPath = pathMod.resolve(
            pathMod.dirname(fileURLToPath(import.meta.url)),
            "..", "index.js"
          );
          const proc = spawn("node", [cliPath, "start"], {
            detached: true,
            stdio: "ignore",
            shell: process.platform === "win32",
            windowsHide: true,
          });
          proc.unref();
          if (process.env.LIGHTMCP_VERBOSE) {
            console.error("[get-tools] Server unreachable — starting LightMCP...");
          }
        }
        const healthUrl = url.replace(/\/mcp$/, "/health");
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          try {
            const h = await fetch(healthUrl, { signal: AbortSignal.timeout(2_000) });
            if (h.ok) break;
          } catch { /* still starting */ }
          await new Promise((r) => setTimeout(r, 500));
        }
        continue;
      }
      break;
    }
  }

  console.log("[INFO] Server not reachable — using local mode (tools not registered)");
  const { getCatalogTools } = await import("../../catalog/loader.js");
  const { buildCatalog } = await import("../../catalog/builder.js");
  const { ensureOllamaReady, stopOllama } = await import("../../ollama/manager.js");
  const { selectTools } = await import("../../ollama/client.js");

  let catalog = await getCatalogTools();
  if (catalog.length === 0) {
    const built = await buildCatalog();
    catalog = built.tools;
  }

  await ensureOllamaReady();

  try {
    const selected = await selectTools(task, catalog, hints);
    const validTools = catalog.filter((t) => selected.includes(t.name));

    for (const t of validTools) {
      console.log(`${t.name} [${t.serverKey}] ${t.shortDesc}`);
    }
  } finally {
    await stopOllama();
  }
}
