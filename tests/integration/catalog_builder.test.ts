import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fsPromises from 'node:fs/promises';
import { buildCatalog } from '../../src/catalog/builder.js';
import * as config from '../../src/config.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn(),
  };
});

describe('catalog builder', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    
    vi.mocked(config.loadConfig).mockResolvedValue({
      catalog: {
        outputPath: 'dummy.json',
        activeOnly: false
      }
    } as any);

    vi.mocked(config.resolveMcpConfigPath).mockResolvedValue('mcp_config.json');
    global.fetch = vi.fn();
  });

  it('should build catalog skipping lightmcp and disabled tools', async () => {
    vi.mocked(config.loadMcpConfig).mockResolvedValue({
      mcpServers: {
        lightmcp: { serverUrl: 'http://loc' },
        disabled_server: { command: 'node', disabled: true },
        http_server: { serverUrl: 'http://remote/mcp' }
      }
    } as any);

    // Mock HTTP fetch for http_server
    vi.mocked(global.fetch).mockResolvedValue({
      headers: new Headers(),
      json: async () => ({
        result: {
          tools: [{ name: 'remote_tool', description: 'a tool' }]
        }
      })
    } as any);

    const catalog = await buildCatalog({ activeOnly: true });

    expect(catalog.tools).toHaveLength(1);
    expect(catalog.tools[0].name).toBe('remote_tool');
    expect(catalog.servers).toHaveLength(2); // disabled_server and http_server
    expect(catalog.servers.find(s => s.key === 'disabled_server')?.disabled).toBe(true);

    // Should have written to file
    expect(fsPromises.writeFile).toHaveBeenCalled();
  });

  it('should handle fetch errors gracefully', async () => {
    vi.mocked(config.loadMcpConfig).mockResolvedValue({
      mcpServers: {
        http_server: { serverUrl: 'http://bad/mcp' }
      }
    } as any);

    vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

    const catalog = await buildCatalog();
    expect(catalog.tools).toHaveLength(0);
    expect(catalog.servers[0].toolCount).toBe(0);
  });
});
