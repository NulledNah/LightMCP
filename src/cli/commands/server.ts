// ============================================================
// LightMCP — server command
// Manage MCP servers: add, remove, list, disable, enable.
// ============================================================
import { addServer, removeServer, listServers, disableServer, enableServer } from "../../server/manager.js";

export async function serverCommand(
  action: "add" | "remove" | "list" | "disable" | "enable",
  name?: string,
  opts?: {
    command?: string;
    args?: string;
    serverUrl?: string;
    env?: string;
    action?: "restore" | "delete";
    all?: boolean;
  }
): Promise<void> {
  switch (action) {
    case "add": {
      if (!name) { console.error("[ERROR] Server name required."); return; }
      if (!opts?.command && !opts?.serverUrl) {
        console.error("[ERROR] Either --command or --server-url is required.");
        return;
      }
      const config: Record<string, unknown> = {};
      if (opts.command) config.command = opts.command;
      if (opts.args) config.args = opts.args.split(" ").filter(Boolean);
      if (opts.serverUrl) config.serverUrl = opts.serverUrl;
      if (opts.env) {
        config.env = Object.fromEntries(
          opts.env.split(",").map(p => {
            const [k, ...v] = p.split("=");
            return [k.trim(), v.join("=").trim()];
          })
        );
      }
      console.log(await addServer(name, config as any));
      break;
    }

    case "remove": {
      if (!name) { console.error("[ERROR] Server name required."); return; }

      if (opts?.action === "delete") {
        console.log(await removeServer(name, { restore: false }));
      } else if (opts?.action === "restore") {
        console.log(await removeServer(name, { restore: true }));
      } else {
        // Interactive prompt
        const { createInterface } = await import("node:readline");
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>(resolve => {
          rl.question(`  Restore "${name}" to original agent? (y/N): `, resolve);
        });
        rl.close();
        if (answer.toLowerCase() === "y") {
          console.log(await removeServer(name, { restore: true }));
        } else {
          console.log(await removeServer(name, { restore: false }));
        }
      }
      break;
    }

    case "list": {
      const servers = await listServers(opts?.all ?? false);
      if (servers.length === 0) {
        console.log("[INFO] No servers configured.");
        return;
      }

      let inline = 0, agent = 0, disabled = 0;
      console.log("\n┌─ LightMCP Servers ───────────────────────────────────────────────────┐");

      for (const s of servers) {
        const tag = s.disabled ? "[disabled]" : s.source === "inline" ? "[inline]  " : "[agent]   ";
        const transport = s.config.serverUrl ? "http" : "stdio";
        const cmdInfo = s.config.serverUrl
          ? s.config.serverUrl
          : `${s.config.command ?? "?"} ${(s.config.args ?? []).join(" ")}`.trim();
        const agentInfo = s.agentName ? `(${s.agentName})` : "";

        console.log(`│  ${tag} ${s.name.padEnd(20)} ${transport.padEnd(8)} ${cmdInfo.padEnd(30)} ${agentInfo}`.slice(0, 78) + " │");

        if (s.source === "inline") inline++;
        else agent++;
        if (s.disabled) disabled++;
      }

      const allCount = await listServers(true);
      const hidden = allCount.length - servers.length;

      console.log("│                                                                       │");
      console.log(`│  ─────────────────────────────────────────────────────────────────    │`);
      console.log(`│  ${servers.length} server(s): ${inline} inline, ${agent} from agents${disabled > 0 ? `, ${disabled} disabled` : ""}`.padEnd(78) + " │");
      if (hidden > 0) {
        console.log(`│  ${hidden} disabled (use --all to show)`.padEnd(78) + " │");
      }
      console.log("│  (lightmcp bridge hidden — managed automatically)                     │");
      console.log("└───────────────────────────────────────────────────────────────────────┘\n");
      break;
    }

    case "disable": {
      if (!name) { console.error("[ERROR] Server name required."); return; }
      console.log(await disableServer(name));
      break;
    }

    case "enable": {
      if (!name) { console.error("[ERROR] Server name required."); return; }
      console.log(await enableServer(name));
      break;
    }
  }
}
