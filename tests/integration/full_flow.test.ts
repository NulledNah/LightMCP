import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import { createMcpServer, getApp } from '../../src/server/mcp_server.js';
import type express from 'express';
import * as config from '../../src/config.js';
import * as ollamaClient from '../../src/ollama/client.js';
import * as ollamaManager from '../../src/ollama/manager.js';
import * as catalogLoader from '../../src/catalog/loader.js';
import * as proxy from '../../src/server/proxy.js';

vi.mock('../../src/config.js');
vi.mock('../../src/ollama/client.js');
vi.mock('../../src/ollama/manager.js');
vi.mock('../../src/catalog/loader.js');
vi.mock('../../src/server/proxy.js');
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(JSON.stringify({ version: '0.1.0' })),
}));

describe('Full MCP flow (E2E via HTTP)', () => {
  let app: express.Application;
  let sessionId: string;

  const mockCatalogTools = [
    {
      name: 'search_footprints',
      serverKey: 'kicad',
      serverTransport: 'stdio' as const,
      description: 'Search for footprints matching a pattern across all libraries',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern' },
          library_path: { type: 'string', description: 'Library path' },
        },
      },
      shortDesc: 'Search for footprints',
    },
    {
      name: 'create_footprint',
      serverKey: 'kicad',
      serverTransport: 'stdio' as const,
      description: 'Create a new KiCAD footprint',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Footprint name' },
          library_path: { type: 'string', description: 'Library path' },
        },
      },
      shortDesc: 'Create a footprint',
    },
    {
      name: 'navigate_page',
      serverKey: 'chrome-devtools-mcp',
      serverTransport: 'stdio' as const,
      description: 'Go to a URL',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL to navigate to' } },
      },
      shortDesc: 'Go to a URL',
    },
  ];

  beforeAll(async () => {
    vi.resetAllMocks();
    vi.mocked(config.loadConfig).mockResolvedValue({
      server: { port: 3001, host: '127.0.0.1', idleTimeoutSeconds: 0, mode: 'filtered' },
      ollama: { host: 'http://127.0.0.1:11434', model: 'test-model', idleTimeoutSeconds: 10, startupTimeoutSeconds: 30, maxRetries: 1 },
      catalog: { activeOnly: false, watchMcpConfig: false, outputPath: 'tool_catalog.json' },
      mcpConfigPath: null,
      mcpConfigPaths: [],
      mcpServers: {},
      alwaysOn: [],
    } as any);

    vi.mocked(catalogLoader.getCatalogTools).mockResolvedValue(mockCatalogTools);
    vi.mocked(ollamaManager.ensureOllamaReady).mockResolvedValue();
    vi.mocked(proxy.callTool).mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ result: 'forwarded ok' }) }],
      isError: false,
    } as any);
    vi.mocked(proxy.closeServerPool).mockResolvedValue();

    await createMcpServer('http');
    app = getApp()!;
  });

  it('Step 1: initialize returns session ID', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0', id: 0, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
      });

    expect(res.status).toBe(200);
    expect(res.headers['mcp-session-id']).toBeDefined();
    sessionId = Array.isArray(res.headers['mcp-session-id'])
      ? res.headers['mcp-session-id'][0]
      : res.headers['mcp-session-id'] as string;

    // MCP protocol requires notifications/initialized after initialize
    await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('Mcp-Session-Id', sessionId)
      .send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  });

  it('Step 2: tools/list returns get_task_tools', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('Mcp-Session-Id', sessionId)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(res.status).toBe(200);
    expect(res.body.result).toBeDefined();
    expect(res.body.result.tools).toBeDefined();
    expect(res.body.result.tools.some((t: any) => t.name === 'get_task_tools')).toBe(true);
  });

  it('Step 3: get_task_tools selects and registers tools', async () => {
    vi.mocked(ollamaClient.selectTools).mockResolvedValue(['search_footprints', 'create_footprint']);

    const res = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('Mcp-Session-Id', sessionId)
      .send({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'get_task_tools', arguments: { task: 'create KiCad footprint' } },
      });

    expect(res.status).toBe(200);
    const text = (res.body.result as any)?.content?.[0]?.text;
    expect(text).toBeDefined();

    const parsed = JSON.parse(text);
    expect(parsed.tools).toBeDefined();
    expect(parsed.tools.length).toBe(2);
    expect(parsed.tools[0].name).toBe('kicad_search_footprints');
    expect(parsed.tools[1].name).toBe('kicad_create_footprint');
  });

  it('Step 4: tools/list now shows registered tools', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('Mcp-Session-Id', sessionId)
      .send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });

    expect(res.status).toBe(200);
    const names = res.body.result.tools.map((t: any) => t.name);
    expect(names).toContain('get_task_tools');
    expect(names).toContain('kicad_search_footprints');
    expect(names).toContain('kicad_create_footprint');
  });

  it('Step 5: calling a registered tool forwards to proxy', async () => {
    vi.mocked(proxy.callTool).mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ found: 5, footprints: ['JST_SH_4Pin'] }) }],
      isError: false,
    } as any);

    const res = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('Mcp-Session-Id', sessionId)
      .send({
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'kicad_search_footprints', arguments: { pattern: 'JST SH 4' } },
      });

    expect(res.status).toBe(200);
    expect(res.body.result).toBeDefined();
    expect(res.body.error).toBeUndefined();
  });

  it('Step 6: subsequent get_task_tools replaces old tools', async () => {
    vi.mocked(ollamaClient.selectTools).mockResolvedValue(['navigate_page']);

    await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('Mcp-Session-Id', sessionId)
      .send({
        jsonrpc: '2.0', id: 5, method: 'tools/call',
        params: { name: 'get_task_tools', arguments: { task: 'open browser' } },
      });

    const listRes = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('Mcp-Session-Id', sessionId)
      .send({ jsonrpc: '2.0', id: 6, method: 'tools/list' });

    const names = listRes.body.result.tools.map((t: any) => t.name);
    expect(names).toContain('get_task_tools');
    expect(names).toContain('chrome-devtools-mcp_navigate_page');
    expect(names).not.toContain('kicad_search_footprints');
    expect(names).not.toContain('kicad_create_footprint');
  });
});
