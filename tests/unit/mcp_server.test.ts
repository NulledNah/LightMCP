import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

const mockRegisterToolFn = vi.fn().mockReturnValue({ remove: vi.fn() });
const mockConnectFn = vi.fn().mockResolvedValue(undefined);
const mockSendToolListChanged = vi.fn();
const mockTransportHandleRequest = vi.fn();
const mockTransportClose = vi.fn();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: function McpServer(this: any) {
    this.registerTool = mockRegisterToolFn;
    this.connect = mockConnectFn;
    this.server = { onnotification: vi.fn() };
  } as any,
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: function StreamableHTTPServerTransport(this: any) {
    this.handleRequest = mockTransportHandleRequest;
    this.close = mockTransportClose;
  } as any,
}));

vi.mock('../../src/config.js');

vi.mock('../../src/catalog/loader.js', () => ({
  getCatalogTools: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/catalog/builder.js', () => ({
  buildCatalog: vi.fn().mockResolvedValue({ tools: [] }),
}));

vi.mock('../../src/ollama/manager.js', () => ({
  ensureOllamaReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/ollama/client.js', () => ({
  selectTools: vi.fn().mockResolvedValue(['tool1']),
}));

vi.mock('../../src/server/proxy.js', () => ({
  callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }], isError: false }),
  closeServerPool: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(JSON.stringify({ version: '0.1.0' })),
}));

import * as config from '../../src/config.js';

describe('mcp_server.ts', () => {
  const mockConfig = {
    server: { port: 3131, host: '127.0.0.1', idleTimeoutSeconds: 0, mode: 'filtered' as const },
    ollama: { host: 'http://127.0.0.1:11434', model: 'test', idleTimeoutSeconds: 120, startupTimeoutSeconds: 30, maxRetries: 1 },
    catalog: { outputPath: 'catalog.json', activeOnly: false, watchMcpConfig: false },
    mcpConfigPath: null,
    mcpConfigPaths: [],
    mcpServers: {},
    alwaysOn: [],
  };

  beforeAll(() => {
    vi.mocked(config.loadConfig).mockResolvedValue(mockConfig as any);
    mockRegisterToolFn.mockReturnValue({ remove: vi.fn() });
    mockTransportHandleRequest.mockImplementation((_req: any, res: any) => {
      if (!res.headersSent && typeof res.status === 'function') {
        res.setHeader("Mcp-Session-Id", "mock-session-id");
        res.status(200).json({
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "lightmcp", version: "0.1.0" },
          },
        });
      }
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('getMcpServer (before creation)', () => {
    it('should throw if called before creation', async () => {
      const { getMcpServer } = await import('../../src/server/mcp_server.js');

      expect(() => getMcpServer()).toThrow('McpServer not initialized');
    });
  });

  describe('createMcpServer (HTTP mode)', () => {
    let serverModule: any;

    beforeAll(async () => {
      vi.clearAllMocks();
      vi.mocked(config.loadConfig).mockResolvedValue(mockConfig as any);
      mockRegisterToolFn.mockReturnValue({ remove: vi.fn() });
      serverModule = await import('../../src/server/mcp_server.js');
      await serverModule.createMcpServer('http');
    });

    afterAll(async () => {
      if (serverModule) {
        try { await serverModule.stopServer(); } catch { /* ignore */ }
      }
    });

    it('should create and connect an McpServer', () => {
      expect(mockRegisterToolFn).toHaveBeenCalled();
      expect(mockConnectFn).toHaveBeenCalled();
    });

    it('should register get_task_tools on startup', () => {
      const toolCalls = mockRegisterToolFn.mock.calls;
      const getToolsCall = toolCalls.find((c: any[]) => c[0] === 'get_task_tools');
      expect(getToolsCall).toBeDefined();
      expect(getToolsCall[1].description).toContain('discover which tools are available');
    });

    it('should return the McpServer instance after creation', () => {
      const server = serverModule.getMcpServer();
      expect(server).toBeDefined();
    });
  });
});
