import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fsPromises from 'node:fs/promises';
import { buildCatalog } from '../../src/catalog/builder.js';
import * as config from '../../src/config.js';

vi.mock('../../src/config.js');
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
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
        activeOnly: false,
        watchMcpConfig: false,
      }
    } as any);

    vi.mocked(config.resolveMcpConfigPath).mockResolvedValue('mcp_config.json');
    global.fetch = vi.fn();
  });

  const mockHttpResponse = (tools: Array<{ name: string; description?: string }>) => ({
    headers: new Headers(),
    json: async () => ({
      result: { tools }
    })
  }) as any;

  it('should build catalog skipping lightmcp and disabled tools', async () => {
    vi.mocked(config.loadMcpConfig).mockResolvedValue({
      mcpServers: {
        lightmcp: { serverUrl: 'http://loc' },
        disabled_server: { command: 'node', disabled: true },
        http_server: { serverUrl: 'http://remote/mcp' }
      }
    } as any);

    vi.mocked(global.fetch)
      // http_server: init + list
      .mockResolvedValueOnce(mockHttpResponse([]))
      .mockResolvedValueOnce(mockHttpResponse([
        { name: 'remote_tool', description: 'a tool' }
      ]));

    const catalog = await buildCatalog({ activeOnly: true });

    expect(catalog.tools).toHaveLength(1);
    expect(catalog.tools[0].name).toBe('remote_tool');
    expect(catalog.servers).toHaveLength(1); // disabled_server skipped entirely

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

  it('should filter out disabledTools per server', async () => {
    vi.mocked(config.loadMcpConfig).mockResolvedValue({
      mcpServers: {
        http_server: { serverUrl: 'http://remote/mcp', disabledTools: ['unwanted_tool'] }
      }
    } as any);

    vi.mocked(global.fetch)
      // http_server: init + list
      .mockResolvedValueOnce(mockHttpResponse([]))
      .mockResolvedValueOnce(mockHttpResponse([
        { name: 'good_tool', description: 'useful' },
        { name: 'unwanted_tool', description: 'should not appear' },
        { name: 'another_good', description: 'also useful' },
      ]));

    const catalog = await buildCatalog();

    expect(catalog.tools).toHaveLength(2);
    expect(catalog.tools.map(t => t.name)).toEqual(['good_tool', 'another_good']);
  });

  it('should include all servers when activeOnly is false', async () => {
    vi.mocked(config.loadMcpConfig).mockResolvedValue({
      mcpServers: {
        s1: { serverUrl: 'http://s1/mcp' },
        s2: { serverUrl: 'http://s2/mcp', disabled: true },
      }
    } as any);

    vi.mocked(global.fetch)
      // s1: init + list
      .mockResolvedValueOnce(mockHttpResponse([]))
      .mockResolvedValueOnce(mockHttpResponse([{ name: 't1' }]))
      // s2: init + list
      .mockResolvedValueOnce(mockHttpResponse([]))
      .mockResolvedValueOnce(mockHttpResponse([{ name: 't2', description: 'tool 2' }]));

    const catalog = await buildCatalog({ activeOnly: false });

    expect(catalog.servers).toHaveLength(2);
    expect(catalog.tools).toHaveLength(2);
  });

  it('should truncate long descriptions to 100 chars', async () => {
    vi.mocked(config.loadMcpConfig).mockResolvedValue({
      mcpServers: {
        http_server: { serverUrl: 'http://remote/mcp' }
      }
    } as any);

    vi.mocked(global.fetch)
      // http_server: init + list
      .mockResolvedValueOnce(mockHttpResponse([]))
      .mockResolvedValueOnce(mockHttpResponse([
        { name: 'tool1', description: 'A'.repeat(200) },
      ]));

    const catalog = await buildCatalog();

    expect(catalog.tools[0].shortDesc.length).toBeLessThanOrEqual(100);
    expect(catalog.tools[0].shortDesc).toContain('…');
    expect(catalog.tools[0].description).toBe('A'.repeat(200));
  });

  it('should handle server with no command and no serverUrl', async () => {
    vi.mocked(config.loadMcpConfig).mockResolvedValue({
      mcpServers: {
        broken: {}
      }
    } as any);

    const catalog = await buildCatalog();
    expect(catalog.tools).toHaveLength(0);
    expect(catalog.servers[0].toolCount).toBe(0);
  });
});
