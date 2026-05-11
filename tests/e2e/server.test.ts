import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server/mcp_server.js';
import * as handlers from '../../src/server/handlers.js';

vi.mock('../../src/server/handlers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/server/handlers.js')>();
  return {
    ...actual,
    handleGetTools: vi.fn(),
  };
});

describe('E2E Server endpoints', () => {
  beforeAll(() => {
    vi.resetAllMocks();
  });

  describe('POST /mcp', () => {
    it('should return 400 if validation fails', async () => {
      const res = await request(app)
        .post('/mcp')
        .send({ method: 'tools/call', params: { name: 'lightmcp_get_tools' } }); // missing task
      
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Validation failed');
    });

    it('should handle get tools correctly', async () => {
      vi.mocked(handlers.handleGetTools).mockResolvedValue({
        content: [{ type: 'text', text: '{"tools": []}' }]
      });

      const res = await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'lightmcp_get_tools',
            arguments: { task: 'test task' }
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.result.content[0].text).toBe('{"tools": []}');
      expect(handlers.handleGetTools).toHaveBeenCalledWith({ task: 'test task' });
    });

    it('should handle tool list request', async () => {
      const res = await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
        });

      expect(res.status).toBe(200);
      expect(res.body.result.tools).toHaveLength(1);
      expect(res.body.result.tools[0].name).toBe('lightmcp_get_tools');
    });
  });

  describe('Stress test', () => {
    it('should handle multiple concurrent requests', async () => {
      // Simulate delay in handler to test concurrency
      vi.mocked(handlers.handleGetTools).mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 50));
        return { content: [{ type: 'text', text: 'ok' }] };
      });

      const reqs = Array.from({ length: 50 }).map((_, i) => 
        request(app)
          .post('/mcp')
          .send({
            jsonrpc: '2.0',
            id: i,
            method: 'tools/call',
            params: {
              name: 'lightmcp_get_tools',
              arguments: { task: `task ${i}` }
            }
          })
      );

      const results = await Promise.all(reqs);
      
      expect(results).toHaveLength(50);
      results.forEach(res => {
        expect(res.status).toBe(200);
        expect(res.body.result.content[0].text).toBe('ok');
      });
      
      expect(handlers.handleGetTools).toHaveBeenCalledTimes(50);
    });
  });
});
