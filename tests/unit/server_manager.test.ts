import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listServers, addServer, removeServer, disableServer, enableServer, uninstallAll } from '../../src/server/manager.js';

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn(),
  invalidateConfig: vi.fn(),
  resolveMcpServers: vi.fn().mockResolvedValue({}),
  resolveWatchPaths: vi.fn().mockResolvedValue([]),
  loadMcpConfig: vi.fn().mockResolvedValue({ mcpServers: {} }),
  autoPopulateConfig: vi.fn(),
}));

vi.mock('../../src/catalog/builder.js', () => ({
  buildCatalog: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/ollama/manager.js', () => ({
  stopOllama: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/setup/scanner.js', () => ({
  detectAgents: vi.fn().mockReturnValue([]),
}));

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
}));

vi.mock('node:fs', () => mockFs);

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

import { loadConfig } from '../../src/config.js';
import { detectAgents } from '../../src/setup/scanner.js';
import { writeFile } from 'node:fs/promises';

const mockConfig = () => ({
  server: { port: 3131, host: '127.0.0.1' },
  ollama: { host: 'http://127.0.0.1:11434', model: 'test', idleTimeoutSeconds: 120, startupTimeoutSeconds: 30, maxRetries: 2 },
  catalog: { activeOnly: false, watchMcpConfig: false, outputPath: 'catalog.json' },
  mcpConfigPath: null,
  mcpServers: {},
});

describe('server manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockResolvedValue(mockConfig() as any);
    vi.mocked(detectAgents).mockReturnValue([]);
  });

  // ---- listServers ----

  describe('listServers', () => {
    it('should return empty array when no servers configured', async () => {
      const result = await listServers();
      expect(result).toEqual([]);
    });

    it('should list inline servers', async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        ...mockConfig(),
        mcpServers: {
          kicad: { command: 'python', args: ['-m', 'kicad_mcp'] },
          chrome: { serverUrl: 'http://localhost:9222' },
        },
      } as any);

      const result = await listServers();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('kicad');
      expect(result[0].source).toBe('inline');
      expect(result[1].source).toBe('inline');
    });

    it('should never include lightmcp bridge', async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        ...mockConfig(),
        mcpServers: {
          lightmcp: { command: 'node' },
          kicad: { command: 'python' },
        },
      } as any);

      const result = await listServers();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('kicad');
    });

    it('should filter disabled servers by default', async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        ...mockConfig(),
        mcpServers: {
          kicad: { command: 'python', disabled: true },
          chrome: { serverUrl: 'http://localhost:9222' },
        },
      } as any);

      const result = await listServers();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('chrome');
    });

    it('should show disabled servers when showDisabled=true', async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        ...mockConfig(),
        mcpServers: {
          kicad: { command: 'python', disabled: true },
        },
      } as any);

      const result = await listServers(true);
      expect(result).toHaveLength(1);
    });
  });

  // ---- addServer ----

  describe('addServer', () => {
    it('should add a server to inline mcpServers', async () => {
      const result = await addServer('new_tool', { command: 'node', args: ['server.js'] });
      expect(result).toContain('[OK]');
      expect(writeFile).toHaveBeenCalled();
    });

    it('should warn if server already exists', async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        ...mockConfig(),
        mcpServers: { existing: { command: 'node' } },
      } as any);

      const result = await addServer('existing', { command: 'python' });
      expect(result).toContain('[WARN]');
    });
  });

  // ---- removeServer ----

  describe('removeServer', () => {
    it('should error if server not found', async () => {
      const result = await removeServer('nonexistent');
      expect(result).toContain('[ERROR]');
    });

    it('should remove server from inline mcpServers', async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        ...mockConfig(),
        mcpServers: { to_remove: { command: 'node' } },
      } as any);

      const result = await removeServer('to_remove', { restore: false });
      expect(result).toContain('[OK]');
    });
  });

  // ---- disableServer / enableServer ----

  describe('disableServer', () => {
    it('should set disabled: true', async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        ...mockConfig(),
        mcpServers: { srv: { command: 'node' } },
      } as any);

      const result = await disableServer('srv');
      expect(result).toContain('[OK]');
      expect(result).toContain('disabled');
    });

    it('should error if server not found', async () => {
      const result = await disableServer('ghost');
      expect(result).toContain('[ERROR]');
    });
  });

  describe('enableServer', () => {
    it('should set disabled: false', async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        ...mockConfig(),
        mcpServers: { srv: { command: 'node', disabled: true } },
      } as any);

      const result = await enableServer('srv');
      expect(result).toContain('[OK]');
      expect(result).toContain('enabled');
    });
  });

  // ---- uninstallAll ----

  describe('uninstallAll', () => {
    it('should restore agent from backup and skip _removed servers', async () => {
      const backupContent = {
        mcpServers: {
          kicad: { command: 'python' },
          chrome: { serverUrl: 'http://localhost:9222', _removed: true },
        },
      };

      const mockAgent = {
        name: 'Antigravity',
        configPath: '/fake/antigravity/mcp_config.json',
        configExists: true,
        hasLightMCP: true,
      };

      vi.mocked(detectAgents).mockReturnValue([mockAgent as any]);
      vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
        if (typeof p === 'string' && p.includes('lightmcp_servers.json')) return true;
        if (typeof p === 'string' && (p.includes('tool_catalog.json') || p.includes('tool_tips.json'))) return false;
        return false;
      });
      vi.mocked(mockFs.readFileSync).mockImplementation((p: any) => {
        if (typeof p === 'string' && p.includes('lightmcp_servers.json')) {
          return JSON.stringify(backupContent);
        }
        return '{}';
      });

      const results = await uninstallAll();

      expect(results).toContain('[OK] Restored Antigravity to original config');
      expect(mockFs.writeFileSync).toHaveBeenCalled();

      // Verify _removed server was filtered out
      const writeCalls = vi.mocked(mockFs.writeFileSync).mock.calls;
      const agentWrite = writeCalls.find((c: any[]) =>
        typeof c[0] === 'string' && c[0].includes('mcp_config.json')
      );
      const writtenContent = JSON.parse(agentWrite?.[1] as string ?? '{}');
      expect(writtenContent.mcpServers).toBeDefined();
      expect(Object.keys(writtenContent.mcpServers)).toContain('kicad');
      expect(Object.keys(writtenContent.mcpServers)).not.toContain('chrome');
    });

    it('should remove lightmcp from agents without backup', async () => {
      const mockAgent = {
        name: 'Claude Code',
        configPath: '/fake/.claude.json',
        configExists: true,
        hasLightMCP: true,
      };

      vi.mocked(detectAgents).mockReturnValue([mockAgent as any]);
      vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
        if (typeof p === 'string' && (p.includes('tool_catalog.json') || p.includes('tool_tips.json'))) return false;
        return false;
      });
      vi.mocked(mockFs.readFileSync).mockReturnValue(JSON.stringify({
        mcpServers: { lightmcp: { type: 'http', url: 'http://127.0.0.1:3131/mcp' } },
      }));

      const results = await uninstallAll();

      expect(results).toContain('[OK] Removed LightMCP from Claude Code');
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });
});
