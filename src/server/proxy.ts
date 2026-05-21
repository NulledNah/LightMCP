// ============================================================
// LightMCP — Server Proxy Pool
// Manages persistent MCP client connections to downstream
// servers. Forwards tools/call requests transparently.
// ============================================================
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getVersion } from "../version.js";
import type { MCPServerConfig } from "../types.js";

interface ServerConnection {
  client: Client;
  transport: StreamableHTTPClientTransport | StdioClientTransport;
  connected: boolean;
}

export class ProxyPool {
  private _pool = new Map<string, ServerConnection>();
  private _connectPromises = new Map<string, Promise<ServerConnection>>();

  private async getMcpConfig(): Promise<Record<string, MCPServerConfig>> {
    const { resolveMcpServers } = await import("../config.js");
    return resolveMcpServers();
  }

  private async doConnectServer(serverKey: string): Promise<ServerConnection> {
    const servers = await this.getMcpConfig();
    const serverCfg = servers[serverKey];

    if (!serverCfg) {
      throw new Error(`Server "${serverKey}" not found in mcp_config.json`);
    }

    const version = await getVersion();
    const client = new Client(
      { name: "lightmcp-proxy", version },
      { capabilities: {} }
    );

    let transport: StreamableHTTPClientTransport | StdioClientTransport;

    if (serverCfg.serverUrl) {
      const url = serverCfg.serverUrl.endsWith("/mcp")
        ? serverCfg.serverUrl
        : `${serverCfg.serverUrl}/mcp`;
      transport = new StreamableHTTPClientTransport(new URL(url));
    } else if (serverCfg.command) {
      const DANGEROUS_KEYS = new Set([
        "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
        "NODE_OPTIONS", "NODE_PATH",
      ]);
      const env: Record<string, string> = {};
      for (const [key, val] of Object.entries(process.env)) {
        if (val != null && !DANGEROUS_KEYS.has(key)) {
          env[key] = val;
        }
      }
      Object.assign(env, serverCfg.env ?? {});
      transport = new StdioClientTransport({
        command: serverCfg.command,
        args: serverCfg.args,
        env,
      });
    } else {
      throw new Error(`Server "${serverKey}" has no command or serverUrl`);
    }

    await client.connect(transport);
    console.log(`  [PROXY] Connected to ${serverKey} [${serverCfg.serverUrl ? "http" : "stdio"}]`);

    const conn: ServerConnection = { client, transport, connected: true };
    this._pool.set(serverKey, conn);
    return conn;
  }

  private async connectServer(serverKey: string): Promise<ServerConnection> {
    const ongoing = this._connectPromises.get(serverKey);
    if (ongoing) return ongoing;
    const promise = this.doConnectServer(serverKey);
    this._connectPromises.set(serverKey, promise);
    try { return await promise; }
    finally { this._connectPromises.delete(serverKey); }
  }

  private async getConnection(serverKey: string): Promise<ServerConnection> {
    const existing = this._pool.get(serverKey);
    if (existing && existing.connected) return existing;
    return this.connectServer(serverKey);
  }

  async callTool(
    serverKey: string,
    toolName: string,
    args: Record<string, unknown> | undefined
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    try {
      const conn = await this.getConnection(serverKey);
      const result = await conn.client.callTool(
        { name: toolName, arguments: args }
      );

      return {
        content: result.content as { type: "text"; text: string }[],
        isError: result.isError as boolean | undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const conn = this._pool.get(serverKey);
      if (conn) conn.connected = false;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Tool call to [${serverKey}] ${toolName} failed: ${msg}`,
            }),
          },
        ],
        isError: true,
      };
    }
  }

  async close(): Promise<void> {
    for (const [key, conn] of this._pool.entries()) {
      try {
        await conn.client.close();
        console.log(`  [PROXY] Closed connection to ${key}`);
      } catch (err) {
        if (process.env.DEBUG === 'true') console.error(`[DEBUG] Failed to close connection to ${key}:`, err);
      }
    }
    this._pool.clear();
  }

  reset(): void {
    this._pool.clear();
    this._connectPromises.clear();
  }
}

export const proxyPool = new ProxyPool();

export const callTool = (serverKey: string, toolName: string, args?: Record<string, unknown>) =>
  proxyPool.callTool(serverKey, toolName, args);

export const closeServerPool = () => proxyPool.close();
