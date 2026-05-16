import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type express from 'express';

const mockRegisterToolFn = vi.fn().mockReturnValue({ remove: vi.fn() });
const mockConnectFn = vi.fn().mockResolvedValue(undefined);

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: function McpServer(this: any) {
    this.registerTool = mockRegisterToolFn;
    this.connect = mockConnectFn;
  } as any,
}));

const mockTransportHandleRequest = vi.fn().mockImplementation((_req: any, res: any) => {
  if (!res.headersSent) {
    res.setHeader("Mcp-Session-Id", "mock-session-id");
    res.status(200).json({});
  }
});
const mockTransportClose = vi.fn();

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: function StreamableHTTPServerTransport(this: any) {
    this.handleRequest = mockTransportHandleRequest;
    this.close = mockTransportClose;
    this.sessionIdGenerator = undefined;
  } as any,
}));

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    server: { port: 3131, host: '127.0.0.1', idleTimeoutSeconds: 0 },
    ollama: { host: 'http://127.0.0.1:11434', model: 'test', maxRetries: 1 },
    catalog: { outputPath: 'catalog.json', activeOnly: false },
  }),
}));

vi.mock('../../src/catalog/loader.js', () => ({
  getCatalogTools: vi.fn().mockResolvedValue([
    { name: 'tool1', serverKey: 's1', serverTransport: 'stdio', description: 'desc1', inputSchema: {}, shortDesc: 'T1' },
  ]),
}));

vi.mock('../../src/catalog/builder.js', () => ({
  buildCatalog: vi.fn().mockResolvedValue({
    version: 1,
    builtAt: '2025-01-01',
    activeOnly: false,
    servers: [{ key: 's1', transport: 'stdio', disabled: false, toolCount: 1 }],
    tools: [{ name: 'tool1', serverKey: 's1', serverTransport: 'stdio', description: 'desc1', inputSchema: {}, shortDesc: 'T1' }],
  }),
}));

vi.mock('../../src/ollama/manager.js', () => ({
  ensureOllamaReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/ollama/client.js', () => ({
  selectTools: vi.fn().mockResolvedValue(['tool1']),
}));

vi.mock('../../src/server/proxy.js', () => ({
  callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }], isError: false }),
}));

vi.mock('../../src/server/handlers.js', async () => {
  const actual = await vi.importActual('../../src/server/handlers.js') as any;
  return {
    ...actual,
    handleGetTools: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ selected: 1, tools: [{ name: 'tool1' }] }) }],
    }),
  };
});

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(JSON.stringify({ version: '0.1.0' })),
}));

describe('mcp_server.ts', () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.resetAllMocks();
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
    const mod = await import('../../src/server/mcp_server.js');
    app = await mod.createMcpServer();
  });

  describe('createMcpServer', () => {
    it('should create an express app', () => {
      expect(app).toBeDefined();
    });
  });

  describe('trackTool / untrackTool', () => {
    it('should track and untrack a tool', async () => {
      const { trackTool, untrackTool } = await import('../../src/server/mcp_server.js');

      trackTool('test_tool', 'desc', 's1', { type: 'object', properties: {} });
      trackTool('test_tool', 'desc', 's1');
      // tracking same tool again should update
      trackTool('test_tool', 'updated desc', 's2');
      untrackTool('test_tool');
      // Should not throw
    });
  });

  describe('getMcpServer', () => {
    it('should return the McpServer instance', async () => {
      const { getMcpServer } = await import('../../src/server/mcp_server.js');
      const server = getMcpServer();
      expect(server).toBeDefined();
    });
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('lightmcp');
    });
  });

  describe('POST /mcp — initialize', () => {
    it('should return clean JSON with session ID', async () => {
      const res = await request(app)
        .post('/mcp')
        .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

      expect(res.status).toBe(200);
      expect(res.headers['mcp-session-id']).toBeDefined();
      expect(res.body.result.protocolVersion).toBe('2025-03-26');
      expect(res.body.result.capabilities).toEqual({ tools: {} });
    });
  });

  describe('POST /mcp — Accept header injection', () => {
    it('should inject Accept header for non-compliant clients', async () => {
      const res = await request(app)
        .post('/mcp')
        .set('Accept', '')
        .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

      expect(res.status).toBe(200);
      // The header injection is applied by middleware before the handler
    });
  });

  describe('POST /mcp — tools/list without session', () => {
    it('should return tool list without session header', async () => {
      const { trackTool } = await import('../../src/server/mcp_server.js');
      trackTool('get_task_tools', 'desc', 'lightmcp', { type: 'object' });

      const res = await request(app)
        .post('/mcp')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

      expect(res.status).toBe(200);
      expect(res.body.result.tools).toBeDefined();
      expect(Array.isArray(res.body.result.tools)).toBe(true);
    });
  });

  describe('POST /mcp — tools/call without session', () => {
    it('should handle get_task_tools directly', async () => {
      const res = await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'get_task_tools', arguments: { task: 'test' } },
        });

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
    });

    it('should return error for unknown tool without session', async () => {
      const res = await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'unknown_tool', arguments: {} },
        });

      expect(res.status).toBe(200);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(-32601);
    });

    it('should forward via proxy when tool is tracked', async () => {
      const { trackTool } = await import('../../src/server/mcp_server.js');
      trackTool('custom_tool', 'desc', 's1', { type: 'object' });

      const res = await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'custom_tool', arguments: { x: 1 } },
        });

      expect(res.status).toBe(200);
    });
  });

  describe('GET /mcp', () => {
    it('should delegate to SDK transport', async () => {
      const res = await request(app).get('/mcp');
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /mcp', () => {
    it('should delegate to SDK transport', async () => {
      const res = await request(app).delete('/mcp');
      expect(res.status).toBe(200);
    });
  });

  describe('Error handling', () => {
    it('should handle JSON parse error gracefully', async () => {
      const res = await request(app)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .send('not json');

      expect(res.status).toBe(400);
    });
  });

  describe('Concurrent operations', () => {
    it('should handle multiple simultaneous requests', async () => {
      const promises = Array.from({ length: 5 }, () =>
        request(app).get('/health')
      );
      const results = await Promise.all(promises);
      for (const res of results) {
        expect(res.status).toBe(200);
      }
    });
  });
});
