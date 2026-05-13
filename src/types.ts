// ============================================================
// LightMCP — Shared Types
// ============================================================

/** A single tool entry as stored in the catalog */
export interface ToolEntry {
  name: string;
  serverKey: string;       // key in mcp_config.json (e.g. "kicad")
  serverTransport: "stdio" | "http";
  description: string;
  inputSchema: Record<string, unknown>;
  /** Short description used in the Ollama prompt (truncated to 250 chars) */
  shortDesc: string;
  /** Procedural hint: when/why to use this tool (from tool_tips.json or auto-generated) */
  tip?: string;
}

/** Full catalog persisted to disk */
export interface ToolCatalog {
  version: 1;
  builtAt: string;          // ISO timestamp
  activeOnly: boolean;
  servers: CatalogServer[];
  tools: ToolEntry[];
}

export interface CatalogServer {
  key: string;
  transport: "stdio" | "http";
  disabled: boolean;
  toolCount: number;
}

/** Subset returned by the Ollama selector */
export type SelectedTools = ToolEntry[];

/** lightmcp_config.json schema */
export interface LightMCPConfig {
  server: {
    port: number;
    host: string;
    idleTimeoutSeconds: number;
  };
  ollama: {
    host: string;
    model: string;
    idleTimeoutSeconds: number;
    startupTimeoutSeconds: number;
    maxRetries: number;
  };
  catalog: {
    activeOnly: boolean;
    outputPath: string;
    watchMcpConfig: boolean;
  };
  mcpConfigPath: string | null;
}

/** mcp_config.json server entry */
export interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  serverUrl?: string;
  disabled?: boolean;
  disabledTools?: string[];
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}
