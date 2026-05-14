// ============================================================
// LightMCP — Server Proxy Pool
// Manages persistent MCP client connections to downstream
// servers. Forwards tools/call requests transparently.
// ============================================================
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadConfig } from "../config.js";
import type { MCPServerConfig } from "../types.js";

interface ServerConnection {
  client: Client;
  transport: StreamableHTTPClientTransport | StdioClientTransport;
  connected: boolean;
}

const _pool = new Map<string, ServerConnection>();
const _connectPromises = new Map<string, Promise<ServerConnection>>();

async function getMcpConfig(): Promise<Record<string, MCPServerConfig>> {
  const { resolveMcpServers } = await import("../config.js");
  return resolveMcpServers();
}

async function doConnectServer(serverKey: string): Promise<ServerConnection> {
  const servers = await getMcpConfig();
  const serverCfg = servers[serverKey];

  if (!serverCfg) {
    throw new Error(`Server "${serverKey}" not found in mcp_config.json`);
  }

  const client = new Client(
    { name: "lightmcp-proxy", version: "0.1.0" },
    { capabilities: {} }
  );

  let transport: StreamableHTTPClientTransport | StdioClientTransport;

  if (serverCfg.serverUrl) {
    // HTTP transport
    const url = serverCfg.serverUrl.endsWith("/mcp")
      ? serverCfg.serverUrl
      : `${serverCfg.serverUrl}/mcp`;
    transport = new StreamableHTTPClientTransport(new URL(url));
  } else if (serverCfg.command) {
    // STDIO transport
    transport = new StdioClientTransport({
      command: serverCfg.command,
      args: serverCfg.args,
      env: { ...process.env, ...(serverCfg.env ?? {}) } as Record<string, string>,
    });
  } else {
    throw new Error(`Server "${serverKey}" has no command or serverUrl`);
  }

  await client.connect(transport);
  console.log(`  [PROXY] Connected to ${serverKey} [${serverCfg.serverUrl ? "http" : "stdio"}]`);

  const conn: ServerConnection = { client, transport, connected: true };
  _pool.set(serverKey, conn);
  return conn;
}

async function connectServer(serverKey: string): Promise<ServerConnection> {
  const ongoing = _connectPromises.get(serverKey);
  if (ongoing) return ongoing;
  const promise = doConnectServer(serverKey);
  _connectPromises.set(serverKey, promise);
  try { return await promise; }
  finally { _connectPromises.delete(serverKey); }
}

async function getConnection(serverKey: string): Promise<ServerConnection> {
  const existing = _pool.get(serverKey);
  if (existing && existing.connected) return existing;

  // Reconnect if disconnected
  return connectServer(serverKey);
}

/** Forward a tools/call to the downstream server and return the result. */
export async function callTool(
  serverKey: string,
  toolName: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    const conn = await getConnection(serverKey);
    const result = await conn.client.callTool(
      { name: toolName, arguments: args }
    );

    return {
      content: result.content as { type: "text"; text: string }[],
      isError: result.isError as boolean | undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Mark connection as dead on transport errors
    const conn = _pool.get(serverKey);
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

/** Close all pooled connections (called on shutdown). */
export async function closeServerPool(): Promise<void> {
  for (const [key, conn] of _pool.entries()) {
    try {
      await conn.client.close();
      console.log(`  [PROXY] Closed connection to ${key}`);
    } catch {
      // ignore
    }
  }
  _pool.clear();
}
