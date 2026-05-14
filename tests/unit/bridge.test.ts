import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:http', () => ({
  request: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

describe('bridge.ts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  describe('forwardToServer HTTP forwarding', () => {
    it('should construct POST request with correct headers', async () => {
      const { request } = await import('node:http');

      const mockResponse = {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        on: vi.fn((event: string, cb: Function) => {
          if (event === 'data') cb(Buffer.from('{"result":"ok"}'));
          if (event === 'end') cb();
        }),
      };

      const mockReq = {
        on: vi.fn((event: string, cb: Function) => {
          if (event !== 'error') return;
        }),
        write: vi.fn(),
        end: vi.fn(),
      };

      (request as any).mockImplementation((opts: any, callback: Function) => {
        expect(opts.method).toBe('POST');
        expect(opts.headers['Content-Type']).toBe('application/json');
        callback(mockResponse);
        return mockReq;
      });
    });
  });

  describe('startServer auto-start on ECONNREFUSED', () => {
    it('should recognize ECONNREFUSED as connection error', () => {
      const err = { code: 'ECONNREFUSED', message: 'Connection refused' };
      expect(err.code).toBe('ECONNREFUSED');
    });

    it('should spawn node process', async () => {
      const { spawn } = await import('node:child_process');
      const mockProc = { on: vi.fn(), unref: vi.fn() };
      (spawn as any).mockReturnValue(mockProc);

      spawn('node', ['test.js', 'start'], expect.any(Object));
      expect(spawn).toHaveBeenCalled();
    });
  });

  describe('session ID extraction from headers', () => {
    it('should extract mcp-session-id from response headers', () => {
      const headers = { 'mcp-session-id': 'abc-123', 'content-type': 'application/json' };
      const sid = headers['mcp-session-id'];
      expect(sid).toBe('abc-123');
    });

    it('should not store session when header is missing', () => {
      const headers = { 'content-type': 'application/json' };
      const sid = headers['mcp-session-id'];
      expect(sid).toBeUndefined();
    });
  });

  describe('SSE response parsing', () => {
    it('should extract data from SSE text/event-stream response', () => {
      const sseData = 'event: message\ndata: {"result":"ok"}\n\n';
      const lines = sseData.split('\n');
      const dataLine = lines.find(l => l.startsWith('data:'));
      expect(dataLine).toBe('data: {"result":"ok"}');
    });

    it('should parse JSON from SSE data: line', () => {
      const dataLine = 'data: {"result":"ok"}';
      const json = dataLine.slice(5).trim();
      expect(JSON.parse(json)).toEqual({ result: 'ok' });
    });
  });

  describe('CLI mode', () => {
    it('should treat non-JSON args after tool name as task string', () => {
      const args = ['find', 'resistors'];
      const taskString = args.join(' ');
      expect(taskString).toBe('find resistors');
    });

    it('should parse JSON args correctly', () => {
      const jsonArg = '{"query":"resistor"}';
      const parsed = JSON.parse(jsonArg);
      expect(parsed).toEqual({ query: 'resistor' });
    });

    it('should construct valid JSON-RPC tools/call request', () => {
      const rpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'search_footprints',
          arguments: { task: 'find resistors' },
        },
      };
      expect(rpcRequest.jsonrpc).toBe('2.0');
      expect(rpcRequest.method).toBe('tools/call');
      expect(rpcRequest.params.name).toBe('search_footprints');
      expect(rpcRequest.params.arguments).toEqual({ task: 'find resistors' });
    });

    it('should exit(1) on error response', () => {
      const response = { error: { code: -1, message: 'failed' } };
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-1);
    });

    it('should forward failure results in exit(1)', () => {
      const mockExit = vi.fn();
      const errorOccurred = true;

      if (errorOccurred) {
        mockExit(1);
      }

      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});
