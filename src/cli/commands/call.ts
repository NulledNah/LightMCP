// ============================================================
// LightMCP — call command
// ============================================================
import { safePath } from "../utils.js";

export async function callAction(
  firstArg: string,
  rawArgs: string[],
  opts: { file?: string; output?: string }
): Promise<void> {
  const { loadConfig } = await import("../../config.js");
  const cfg = await loadConfig();
  const url = `http://${cfg.server.host}:${cfg.server.port}/mcp`;

  let tool = firstArg;
  let argsStart = 0;
  const { resolveMcpServers } = await import("../../config.js");
  const mcpServers = await resolveMcpServers();
  const knownServers = Object.keys(mcpServers);
  if (rawArgs.length > 0 && knownServers.includes(firstArg)) {
    tool = rawArgs[0];
    argsStart = 1;
  }

  let toolArgs: Record<string, unknown> = {};

  if (opts.file) {
    const { readFile } = await import("node:fs/promises");
    const filePath = safePath(opts.file);
    const raw = await readFile(filePath, "utf-8");
    toolArgs = JSON.parse(raw);
  } else {
    const effectiveArgs = rawArgs.slice(argsStart);

    if (effectiveArgs.length === 1) {
      try {
        toolArgs = JSON.parse(effectiveArgs[0]);
      } catch {
        toolArgs = { input: effectiveArgs[0] };
      }
    } else if (effectiveArgs.length > 1) {
      for (let i = 0; i < effectiveArgs.length; i++) {
        let key = effectiveArgs[i].replace(/^--?/, "");
        const eqIdx = key.indexOf("=");
        if (eqIdx >= 0) {
          const val = key.slice(eqIdx + 1).replace(/^['"]|['"]$/g, "");
          key = key.slice(0, eqIdx);
          toolArgs[key] = val;
        } else {
          const next = effectiveArgs[i + 1];
          if (next && !next.startsWith("-")) {
            toolArgs[key] = next.replace(/^['"]|['"]$/g, "");
            i++;
          }
        }
      }
    }
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: toolArgs },
    }),
  });

  const rawBody = await res.text();
  try {
    const data = JSON.parse(rawBody) as {
      error?: { code: number; message: string };
      result?: { content?: { type: string; text?: string; data?: string; mimeType?: string }[] };
    };
    if (data.error) {
      console.error(JSON.stringify(data.error));
      process.exit(1);
    }
    const content = data.result?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && block.text) {
          process.stdout.write(block.text);
        } else if (block.type === "image" && block.data) {
          if (opts.output) {
            const { writeFile } = await import("node:fs/promises");
            const buf = Buffer.from(block.data, "base64");
            const outputPath = safePath(opts.output);
            await writeFile(outputPath, buf);
            process.stdout.write(`[OK] Image saved to ${opts.output}\n`);
          } else {
            process.stdout.write(block.data);
          }
        }
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
