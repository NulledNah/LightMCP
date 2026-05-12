import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import { createMcpServer } from '../../src/server/mcp_server.js';
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

describe('Full Antigravity flow (E2E via HTTP)', () => {
  let app: express.Application;

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
      server: { port: 3000, host: '127.0.0.1' },
      ollama: { host: 'http://127.0.0.1:11434', model: 'test-model', idleTimeoutSeconds: 10, startupTimeoutSeconds: 30, maxRetries: 1 },
      catalog: { activeOnly: false, watchMcpConfig: false, outputPath: 'tool_catalog.json' },
      mcpConfigPath: null,
    } as any);

    vi.mocked(catalogLoader.getCatalogTools).mockResolvedValue(mockCatalogTools);
    vi.mocked(ollamaManager.ensureOllamaReady).mockResolvedValue();
    vi.mocked(proxy.callTool).mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ result: 'forwarded ok' }) }],
      isError: false,
    } as any);
    vi.mocked(proxy.closeServerPool).mockResolvedValue();

    app = await createMcpServer();
  });

  it('Step 1: tools/list returns get_task_tools', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(res.status).toBe(200);
    expect(res.body.result.tools).toBeDefined();
    expect(res.body.result.tools.some((t: any) => t.name === 'get_task_tools')).toBe(true);
    expect(res.body.result.tools.some((t: any) => t.name === 'lightmcp_get_tools')).toBe(false);
  });

  it('Step 2: get_task_tools selects and registers tools', async () => {
    vi.mocked(ollamaClient.selectTools).mockResolvedValue(['search_footprints', 'create_footprint']);

    const res = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'get_task_tools', arguments: { task: 'create KiCad footprint' } },
      });

    expect(res.status).toBe(200);
    const text = res.body.result?.content?.[0]?.text;
    expect(text).toBeDefined();

    const parsed = JSON.parse(text);
    expect(parsed.tools).toBeDefined();
    expect(parsed.tools.length).toBe(2);
    expect(parsed.tools[0].name).toBe('search_footprints');
    expect(parsed.tools[1].name).toBe('create_footprint');
    // Verify usage syntax is included
    expect(typeof parsed.tools[0].usage).toBe('string');
  });

  it('Step 3: tools/list now shows registered tools', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });

    expect(res.status).toBe(200);
    const names = res.body.result.tools.map((t: any) => t.name);
    expect(names).toContain('get_task_tools');
    expect(names).toContain('search_footprints');
    expect(names).toContain('create_footprint');
  });

  it('Step 4: calling a registered tool forwards to proxy', async () => {
    vi.mocked(proxy.callTool).mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ found: 5, footprints: ['JST_SH_4Pin'] }) }],
      isError: false,
    } as any);

    const res = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'search_footprints', arguments: { query: 'JST SH 4' } },
      });

    expect(res.status).toBe(200);
    expect(res.body.result).toBeDefined();
    expect(res.body.error).toBeUndefined();

    // Verify proxy was called with correct arguments
    expect(proxy.callTool).toHaveBeenCalledWith(
      'kicad', // empty mock catalog has serverKey='kicad'? No, mock catalog returns empty in tests
      expect.any(String),
      expect.any(Object)
    );
  });

  it('Step 5: calling unknown tool returns clean JSON error', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0', id: 5, method: 'tools/call',
        params: { name: 'nonexistent_tool', arguments: {} },
      });

    expect(res.status).toBe(200);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(-32601);
    expect(res.body.error.message).toContain('not found');
  });

  it('Step 6: subsequent get_task_tools replaces old tools', async () => {
    vi.mocked(ollamaClient.selectTools).mockResolvedValue(['navigate_page']);

    const res = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0', id: 6, method: 'tools/call',
        params: { name: 'get_task_tools', arguments: { task: 'open browser' } },
      });

    expect(res.status).toBe(200);

    // Now tools/list should show navigate_page but NOT search_footprints
    const listRes = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: 7, method: 'tools/list' });

    const names = listRes.body.result.tools.map((t: any) => t.name);
    expect(names).toContain('get_task_tools');
    expect(names).toContain('navigate_page');
    expect(names).not.toContain('search_footprints');
    expect(names).not.toContain('create_footprint');
  });
});
