import { spawn } from "node:child_process";
import { loadConfig, loadMcpConfig, resolveMcpConfigPath } from "./dist/config.js";

async function main() {
  const cfg = await loadConfig();
  const mcpConfigPath = await resolveMcpConfigPath(cfg);
  const mcpConfig = await loadMcpConfig(mcpConfigPath);
  const kicadCfg = mcpConfig.mcpServers["kicad"];

  if (!kicadCfg) {
    console.log("No kicad config found.");
    return;
  }

  const env = { ...process.env, ...(kicadCfg.env ?? {}) };

  console.log("Starting kicad MCP server...");
  const proc = spawn(kicadCfg.command, kicadCfg.args ?? [], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });

  const send = (msg) => {
    console.log("->", JSON.stringify(msg));
    proc.stdin.write(JSON.stringify(msg) + "\n");
  };

  proc.stdout.on("data", (chunk) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      console.log("<-", line.substring(0, 200) + (line.length > 200 ? "..." : ""));
      try {
        const msg = JSON.parse(line);
        if (msg.id === 2 && msg.result) {
           console.log("Tools received:", msg.result.tools?.length);
           console.log("Next cursor:", msg.result.nextCursor);
           if (msg.result.nextCursor) {
              send({
                jsonrpc: "2.0",
                id: 3,
                method: "tools/list",
                params: { cursor: msg.result.nextCursor },
              });
           } else {
             proc.kill();
           }
        }
        if (msg.id === 3 && msg.result) {
           console.log("Page 2 Tools received:", msg.result.tools?.length);
           console.log("Page 2 Next cursor:", msg.result.nextCursor);
           proc.kill();
        }
      } catch {}
    }
  });

  proc.stderr.on("data", (chunk) => console.log("STDERR:", chunk.toString().trim()));

  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "0.1.0" },
    },
  });

  setTimeout(() => {
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
  }, 1000);

}

main().catch(console.error);
