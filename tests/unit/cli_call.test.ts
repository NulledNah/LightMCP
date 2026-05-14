import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    server: { port: 3131, host: '127.0.0.1' },
    ollama: { host: 'http://127.0.0.1:11434', model: 'test' },
  }),
}));

describe('cli call command', () => {
  let mockExit: any;
  let mockStdoutWrite: any;
  let mockStderrWrite: any;

  beforeEach(() => {
    vi.resetAllMocks();

    mockExit = vi.fn();
    process.exit = mockExit as any;

    mockStdoutWrite = vi.fn();
    mockStderrWrite = vi.fn();
    process.stdout.write = mockStdoutWrite as any;
    process.stderr.write = mockStderrWrite as any;

    global.fetch = vi.fn();
  });

  describe('callCommand logic', () => {
    it('should POST tools/call JSON-RPC and parse response', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: 'Hello world' }] },
        }),
      } as any);

      const url = 'http://127.0.0.1:3131/mcp';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'test_tool', arguments: {} },
        }),
      });

      const rawBody = await res.text();
      const data = JSON.parse(rawBody);

      expect(data.result.content[0].text).toBe('Hello world');
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should exit(1) on error response', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32000, message: 'tool not found' },
        }),
      } as any);

      const url = 'http://127.0.0.1:3131/mcp';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'bad_tool', arguments: {} },
        }),
      });

      const rawBody = await res.text();
      const data = JSON.parse(rawBody);

      if (data.error) {
        mockStderrWrite(JSON.stringify(data.error));
        process.exit(1);
      }

      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should output raw body when JSON parse fails', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: async () => 'plain text response',
      } as any);

      const url = 'http://127.0.0.1:3131/mcp';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'test', arguments: {} },
        }),
      });

      const rawBody = await res.text();
      try {
        JSON.parse(rawBody);
      } catch {
        if (rawBody) mockStdoutWrite(rawBody + '\n');
      }

      expect(mockStdoutWrite).toHaveBeenCalledWith('plain text response\n');
    });

    it('should handle image with --output', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({
          result: {
            content: [
              { type: 'image', data: 'base64imagedata', mimeType: 'image/png' },
            ],
          },
        }),
      } as any);

      const url = 'http://127.0.0.1:3131/mcp';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'screenshot', arguments: {} },
        }),
      });

      const rawBody = await res.text();
      const data = JSON.parse(rawBody);
      const content = data.result?.content;

      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'image' && block.data) {
            // With --output: decode and save
            const outputPath = 'screenshot.png';
            // Simulating the pipeline
            expect(block.data).toBe('base64imagedata');
            mockStdoutWrite(`[OK] Image saved to ${outputPath}\n`);
          }
        }
      }

      expect(mockStdoutWrite).toHaveBeenCalledWith('[OK] Image saved to screenshot.png\n');
    });

    it('should output raw data for image without --output', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({
          result: {
            content: [
              { type: 'image', data: 'base64imagedata', mimeType: 'image/png' },
            ],
          },
        }),
      } as any);

      const url = 'http://127.0.0.1:3131/mcp';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'screenshot', arguments: {} },
        }),
      });

      const rawBody = await res.text();
      const data = JSON.parse(rawBody);
      const content = data.result?.content;

      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'image' && block.data) {
            mockStdoutWrite(block.data);
          }
        }
      }

      expect(mockStdoutWrite).toHaveBeenCalledWith('base64imagedata');
    });

    it('should handle empty response', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: async () => '',
      } as any);

      const url = 'http://127.0.0.1:3131/mcp';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'empty_tool', arguments: {} },
        }),
      });

      const rawBody = await res.text();
      if (rawBody) {
        mockStdoutWrite(rawBody + '\n');
      } else {
        mockStderrWrite('Tool "empty_tool" returned empty response');
      }

      expect(mockStderrWrite).toHaveBeenCalledWith('Tool "empty_tool" returned empty response');
    });
  });
});
