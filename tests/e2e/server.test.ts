import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import { createMcpServer, getApp } from '../../src/server/mcp_server.js';
import type express from 'express';
import * as config from '../../src/config.js';

vi.mock('../../src/config.js');
vi.mock('../../src/catalog/loader.js', () => ({
  getCatalogTools: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/server/proxy.js', () => ({
  callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false }),
  closeServerPool: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(JSON.stringify({ version: '0.1.0' })),
}));

describe('E2E Server endpoints', () => {
  let app: express.Application;

  beforeAll(async () => {
    vi.resetAllMocks();
    vi.mocked(config.loadConfig).mockResolvedValue({
      server: { port: 3000, host: '127.0.0.1', idleTimeoutSeconds: 0, mode: 'filtered' },
      ollama: { host: 'http://127.0.0.1:11434', model: 'test-model', idleTimeoutSeconds: 10, startupTimeoutSeconds: 30, maxRetries: 1 },
      catalog: { activeOnly: false, watchMcpConfig: false, outputPath: '' },
      mcpConfigPath: null,
      mcpConfigPaths: [],
      mcpServers: {},
      alwaysOn: [],
    } as any);

    await createMcpServer('http');
    app = getApp()!;
  });

  describe('Health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('lightmcp');
      expect(res.body).toHaveProperty('timestamp');
    });
  });

  describe('POST /mcp', () => {
    it('should accept MCP initialize request', async () => {
      const res = await request(app)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 0,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        });

      expect(res.status).toBe(200);
    });

    it('should reject invalid JSON body', async () => {
      const res = await request(app)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .send('not json');

      expect(res.status).toBe(400);
    });
  });

  describe('Stress test', () => {
    it('should handle rapid sequential health checks', async () => {
      const results = [];
      for (let i = 0; i < 10; i++) {
        const res = await request(app).get('/health');
        results.push(res);
      }

      expect(results).toHaveLength(10);
      results.forEach(res => {
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
      });
    });
  });
});
