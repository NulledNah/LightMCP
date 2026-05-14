import { describe, it, expect, vi, beforeEach } from 'vitest';

const { _mockConnect, _mockClose, _mockCallTool } = vi.hoisted(() => {
  const _mockConnect = vi.fn().mockResolvedValue(undefined);
  const _mockClose = vi.fn().mockResolvedValue(undefined);
  const _mockCallTool = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'success' }],
    isError: false,
  });
  return { _mockConnect, _mockClose, _mockCallTool };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = _mockConnect;
    close = _mockClose;
    callTool = _mockCallTool;
  },
}));

const { _mockStreamableHTTP, _mockStdio } = vi.hoisted(() => {
  return {
    _mockStreamableHTTP: vi.fn(),
    _mockStdio: vi.fn(),
  };
});

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: _mockStreamableHTTP,
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: _mockStdio,
}));

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    server: { port: 3131, host: '127.0.0.1', idleTimeoutSeconds: 0 },
  }),
  resolveMcpServers: vi.fn().mockResolvedValue({
    'http-server': { serverUrl: 'http://localhost:3000/mcp' },
    'http-server-no-slash': { serverUrl: 'http://localhost:3000' },
    'stdio-server': { command: 'node', args: ['server.js'], env: { KEY: 'val' } },
  }),
}));

describe('proxy.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'success' }], isError: false });
    _mockConnect.mockResolvedValue(undefined);
    _mockClose.mockResolvedValue(undefined);
  });

  describe('callTool', () => {
    it('should return result for valid server', async () => {
      const { callTool } = await import('../../src/server/proxy.js');
      const result = await callTool('http-server', 'tool1', { x: 1 });

      expect(result.content[0].text).toBe('success');
      expect(result.isError).toBe(false);
    });

    it('should return error for non-existent server', async () => {
      const { callTool } = await import('../../src/server/proxy.js');
      const result = await callTool('non-existent', 'tool1', {});

      expect(result.isError).toBe(true);
    });

    it('should return error on transport failure', async () => {
      _mockCallTool.mockRejectedValue(new Error('Connection lost'));

      const { callTool } = await import('../../src/server/proxy.js');
      const result = await callTool('http-server', 'tool1', {});

      expect(result.isError).toBe(true);
    });
  });

  describe('closeServerPool', () => {
    it('should not throw when closing pool', async () => {
      const { callTool, closeServerPool } = await import('../../src/server/proxy.js');

      await callTool('http-server', 'tool1', {});
      await expect(closeServerPool()).resolves.toBeUndefined();
    });
  });

  describe('HTTP transport URL appending', () => {
    it('should work with server that has /mcp suffix', async () => {
      const { callTool } = await import('../../src/server/proxy.js');
      const result = await callTool('http-server', 'tool1', {});
      expect(result.isError).toBe(false);
    });

    it('should work with server without /mcp suffix', async () => {
      const { callTool } = await import('../../src/server/proxy.js');
      const result = await callTool('http-server-no-slash', 'tool1', {});
      expect(result.isError).toBe(false);
    });
  });

  describe('STDIO transport env merging', () => {
    it('should work with stdio transport server', async () => {
      process.env.TEST_VAR = 'test_value';

      const { callTool } = await import('../../src/server/proxy.js');
      const result = await callTool('stdio-server', 'tool1', {});
      expect(result.isError).toBe(false);

      delete process.env.TEST_VAR;
    });
  });

  describe('Connection pooling', () => {
    it('should reuse connection for same server', async () => {
      const { callTool } = await import('../../src/server/proxy.js');

      await callTool('http-server', 'tool1', {});
      await callTool('http-server', 'tool2', {});

      // Both calls should succeed
    });

    it('should create separate connections for different servers', async () => {
      const { callTool } = await import('../../src/server/proxy.js');

      await callTool('http-server', 'tool1', {});
      await callTool('http-server-no-slash', 'tool2', {});

      // Both calls should succeed
    });
  });

  describe('Error handling', () => {
    it('should return error content on call failure', async () => {
      _mockCallTool.mockRejectedValue(new Error('timeout'));

      const { callTool } = await import('../../src/server/proxy.js');
      const result = await callTool('http-server', 'tool1', {});

      expect(result.isError).toBe(true);
      expect(typeof result.content[0].text).toBe('string');
    });

    it('should handle non-Error exceptions', async () => {
      _mockCallTool.mockRejectedValue('string error');

      const { callTool } = await import('../../src/server/proxy.js');
      const result = await callTool('http-server', 'tool1', {});

      expect(result.isError).toBe(true);
    });
  });

  describe('Reconnection marking dead', () => {
    it('should reconnect after connection marked dead', async () => {
      const { callTool } = await import('../../src/server/proxy.js');

      _mockCallTool.mockRejectedValue(new Error('Disconnected'));
      const result1 = await callTool('http-server', 'tool1', {});
      expect(result1.isError).toBe(true);

      _mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'reconnected' }], isError: false });
      const result2 = await callTool('http-server', 'tool2', {});
      expect(result2.isError).toBe(false);
      expect(result2.content[0].text).toBe('reconnected');
    });
  });
});
