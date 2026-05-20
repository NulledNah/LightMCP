// ============================================================
// LightMCP — default command handler
// ============================================================

import { mcpHandshake } from "../utils.js";

export async function defaultAction(...args: (string | unknown)[]): Promise<void> {
  const strs = args.filter((a): a is string => typeof a === "string");
  if (strs.length === 0) return;

  const { resolveMcpServers } = await import("../../config.js");
  const mcpServers = await resolveMcpServers();
  const knownServers = Object.keys(mcpServers);
  let toolIdx = 0;
  if (strs.length > 1 && knownServers.includes(strs[0])) {
    toolIdx = 1;
  }
  if (strs.length <= toolIdx) return;

  const tool = strs[toolIdx];
  const rawArgs = strs.slice(toolIdx + 1);

  const { loadConfig } = await import("../../config.js");
  const cfg = await loadConfig();
  const url = `http://${cfg.server.host}:${cfg.server.port}/mcp`;

  let toolArgs: Record<string, unknown> = {};
  if (rawArgs.length === 1) {
    try { toolArgs = JSON.parse(rawArgs[0]); } catch { toolArgs = { input: rawArgs[0] }; }
  } else if (rawArgs.length > 1) {
    for (let i = 0; i < rawArgs.length; i++) {
      let key = rawArgs[i].replace(/^--?/, "");
      const eqIdx = key.indexOf("=");
      if (eqIdx >= 0) {
        toolArgs[key.slice(0, eqIdx)] = key.slice(eqIdx + 1).replace(/^['"]|['"]$/g, "");
      } else {
        const next = rawArgs[i + 1];
        if (next && !next.startsWith("-")) { toolArgs[key] = next.replace(/^['"]|['"]$/g, ""); i++; }
      }
    }
  }

  const sessionId = await mcpHandshake(url);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: toolArgs } }),
  });

  const rawBody = await res.text();
  try {
    const data = JSON.parse(rawBody) as any;
    if (data.error) { console.error(JSON.stringify(data.error)); process.exit(1); }
    const content = data.result?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && block.text) process.stdout.write(block.text);
        else if (block.type === "image" && block.data) process.stdout.write(block.data);
      }
      process.stdout.write("\n");
    } else {
      process.stdout.write(JSON.stringify(data.result, null, 2) + "\n");
    }
  } catch {
    if (rawBody) process.stdout.write(rawBody + "\n");
    else console.error(`Tool "${tool}" returned empty response`);
  }
}
