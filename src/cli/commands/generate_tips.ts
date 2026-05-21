// ============================================================
// LightMCP — generate-tips command
// ============================================================
import { cleanTip } from "../utils.js";

export async function generateTipsAction(opts: { server?: string; overwrite?: boolean }): Promise<void> {
  const { readFile, writeFile } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const pathMod = await import("node:path");
  const { getCatalogTools } = await import("../../catalog/loader.js");
  const { buildCatalog } = await import("../../catalog/builder.js");
  const { loadConfig } = await import("../../config.js");
  const { ensureOllamaReady, stopOllama, keepOllamaAlive } = await import("../../ollama/manager.js");

  let catalog = await getCatalogTools();
  if (catalog.length === 0) {
    console.log("[INFO] No catalog found - building first...");
    const built = await buildCatalog();
    catalog = built.tools;
  }

  let tools = catalog;
  if (opts.server) {
    tools = catalog.filter((t) => t.serverKey === opts.server);
    if (tools.length === 0) {
      console.log(`[INFO] No tools found for server "${opts.server}"`);
      process.exit(0);
    }
    console.log(`[INFO] Generating tips for server "${opts.server}" (${tools.length} tools)`);
  } else {
    console.log(`[INFO] Generating tips for ${tools.length} tools across all servers`);
  }

  const tipsPath = pathMod.resolve(process.cwd(), "tool_tips.json");
  const existingTips: Record<string, string> = {};
  if (existsSync(tipsPath)) {
    try {
      const raw = await readFile(tipsPath, "utf-8");
      const parsed = JSON.parse(raw);
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") existingTips[k] = v;
      }
    } catch { /* start fresh */ }
  }

  if (!opts.overwrite) {
    const skipped = tools.filter((t) => existingTips[t.name]);
    tools = tools.filter((t) => !existingTips[t.name]);
    if (skipped.length > 0) {
      console.log(`[INFO] Skipping ${skipped.length} tool(s) with existing tips (use --overwrite to regenerate)`);
    }
  }

  if (tools.length === 0) {
    console.log("[INFO] All tools already have tips — nothing to do.");
    process.exit(0);
  }

  await ensureOllamaReady();
  const cfg = await loadConfig();
  const { host, model } = cfg.ollama;

  const { generateServerDomains } = await import("../../ollama/keywords.js");
  const serverDomains = generateServerDomains(tools);

  const tipPrompt = (t: typeof tools[number]) =>
    `Write a concise usage tip (max 120 chars) explaining WHEN to select this tool — its role in a workflow.
CRITICAL: Never mention the tool name anywhere in the tip. Describe only the situation or need.
  Good: "When you need to quickly find a specific component by name in your library"
  Bad:  "When you need to find a component, use 'my_tool' to locate it"

Tool name: "${t.name}"
Server: ${t.serverKey}${serverDomains[t.serverKey] ? ` [${serverDomains[t.serverKey]}]` : ""}
Description: ${t.description?.slice(0, 400) ?? "No description"}

Tip (max 120 chars):`;

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < tools.length; i++) {
    const t = tools[i];
    const tag = `[${String(i + 1).padStart(String(tools.length).length)}/${tools.length}]`;

    try {
      const res = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{ role: "user", content: tipPrompt(t) }],
          options: { temperature: 0.1, num_predict: 200, top_k: 20, top_p: 0.9 },
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        console.log(`  ${tag} "${t.name}" FAIL (HTTP ${res.status})`);
        failed++;
        continue;
      }

      const data = (await res.json()) as { message?: { content?: string } };
      const raw = (data.message?.content ?? "").trim()
        .replace(/^["']|["']$/g, "")
        .replace(/^Tip:\s*/i, "");

      const cleaned = cleanTip(raw, t.name);

      const tip = cleaned.length > 120
        ? (() => { const s = cleaned.slice(0, 120); const sp = s.lastIndexOf(" "); return sp > 0 ? s.slice(0, sp) : s; })()
        : cleaned;
      if (!tip) {
        console.log(`  ${tag} "${t.name}" SKIP (empty response)`);
        failed++;
        continue;
      }

      existingTips[t.name] = tip;
      console.log(`  ${tag} "${t.name}" → "${tip}"`);
      generated++;
      await keepOllamaAlive();
    } catch (err) {
      console.log(`  ${tag} "${t.name}" FAIL (${err instanceof Error ? err.message : String(err)})`);
      failed++;
    }
  }

  const sorted: Record<string, string> = {};
  for (const key of Object.keys(existingTips).sort()) {
    sorted[key] = existingTips[key];
  }
  await writeFile(tipsPath, JSON.stringify(sorted, null, 2), "utf-8");

  console.log(`\n[OK] ${generated} tip(s) generated, ${failed} failed`);
  console.log(`[OK] Saved to ${tipsPath}`);

  // Auto-rebuild catalog so tips are immediately available without server restart
  console.log("[INFO] Rebuilding catalog with new tips...");
  try {
    await buildCatalog();
    const { invalidateCatalog } = await import("../../catalog/loader.js");
    invalidateCatalog();
    console.log("[OK] Catalog rebuilt — tips are live\n");
  } catch (err) {
    console.warn(`[WARN] Failed to rebuild catalog: ${err instanceof Error ? err.message : String(err)}`);
    console.log("[INFO] Run 'lightmcp build-catalog' to rebuild the catalog with tips.\n");
  }

  await stopOllama();
}
