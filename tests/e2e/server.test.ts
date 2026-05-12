import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import { createMcpServer } from '../../src/server/mcp_server.js';
import type express from 'express';
import * as config from '../../src/config.js';

vi.mock('../../src/config.js');
vi.mock('../../src/server/proxy.js', () => ({
  callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false }),
  closeServerPool: vi.fn(),
}));

describe('E2E Server endpoints', () => {
  let app: express.Application;

  beforeAll(async () => {
    vi.resetAllMocks();
    vi.mocked(config.loadConfig).mockResolvedValue({
      server: { port: 3000, host: '127.0.0.1' },
      ollama: { host: 'http://127.0.0.1:11434', model: 'test-model', idleTimeoutSeconds: 10, startupTimeoutSeconds: 30, maxRetries: 1 },
      catalog: { activeOnly: false, watchMcpConfig: false, outputPath: '' },
      mcpConfigPath: null,
    } as any);

    app = await createMcpServer();
  });

  describe('Health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('lightmcp');
      expect(res.body).toHaveProperty('version');
      expect(res.body).toHaveProperty('timestamp');
    });
  });

  describe('POST /mcp', () => {
    it('should accept initialize request', async () => {
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

    it('should reject non-initialize requests without session', async () => {
      const res = await request(app)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        });

      expect(res.status).not.toBe(200);
    });

    it('should handle invalid JSON body', async () => {
      const res = await request(app)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .send('not json');

      // Express json middleware should reject
      expect(res.status).toBe(400);
    });
  });

  describe('GET /mcp', () => {
    it('should not crash on GET /mcp', async () => {
      const res = await request(app).get('/mcp').set('Accept', 'text/event-stream');
      expect(res.status).not.toBe(500);
    }, 10_000);
  });

  describe('DELETE /mcp', () => {
    it('should not crash on DELETE /mcp', async () => {
      const res = await request(app).delete('/mcp');
      expect(res.status).not.toBe(500);
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
