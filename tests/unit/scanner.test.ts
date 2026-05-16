import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

const mockHomedir = vi.fn().mockReturnValue('C:\\Users\\test');

vi.mock('node:os', () => ({
  default: {
    homedir: mockHomedir,
    platform: vi.fn().mockReturnValue('win32'),
  },
}));

describe('scanner.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHomedir.mockReturnValue('C:\\Users\\test');
  });

  describe('detectAgents', () => {
    it('should return empty array when no agents detected', async () => {
      mockExistsSync.mockReturnValue(false);

      const { detectAgents } = await import('../../src/setup/scanner.js');
      const agents = detectAgents();

      expect(agents).toEqual([]);
    });

    it('should detect Antigravity when .gemini/antigravity exists', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        return p.includes('.gemini') && p.includes('antigravity');
      });

      const { detectAgents } = await import('../../src/setup/scanner.js');
      const agents = detectAgents();

      const antigravity = agents.find(a => a.name === 'Antigravity');
      expect(antigravity).toBeDefined();
      expect(antigravity!.configExists).toBe(false);
    });

    it('should detect Claude Code when .claude.json exists', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        return p.endsWith('.claude.json') || p.endsWith('.claude');
      });

      mockReadFileSync.mockReturnValue(JSON.stringify({ mcpServers: { existing: {} } }));

      const { detectAgents } = await import('../../src/setup/scanner.js');
      const agents = detectAgents();

      const claude = agents.find(a => a.name === 'Claude Code');
      expect(claude).toBeDefined();
      expect(claude!.currentServerCount).toBe(1);
    });

    it('should detect openCode CLI when .config/opencode exists', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        return p.includes('.config') && p.includes('opencode');
      });

      mockReadFileSync.mockReturnValue(JSON.stringify({ mcp: { s1: {}, s2: {} } }));

      const { detectAgents } = await import('../../src/setup/scanner.js');
      const agents = detectAgents();

      const openCode = agents.find(a => a.name === 'openCode CLI');
      expect(openCode).toBeDefined();
      expect(openCode!.currentServerCount).toBe(2);
    });

    it('should detect Cursor when .cursor exists', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        return p.includes('.cursor');
      });

      mockReadFileSync.mockReturnValue(JSON.stringify({ mcpServers: {} }));

      const { detectAgents } = await import('../../src/setup/scanner.js');
      const agents = detectAgents();

      const cursor = agents.find(a => a.name === 'Cursor');
      expect(cursor).toBeDefined();
    });

    it('should mark hasLightMCP when lightmcp is in config', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        return p.endsWith('.claude.json') || p.endsWith('.claude');
      });

      mockReadFileSync.mockReturnValue(JSON.stringify({
        mcpServers: { lightmcp: { command: 'node', args: [] }, other: {} },
      }));

      const { detectAgents } = await import('../../src/setup/scanner.js');
      const agents = detectAgents();

      const claude = agents.find(a => a.name === 'Claude Code');
      expect(claude!.hasLightMCP).toBe(true);
    });

    it('should handle config missing', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        // Claude detectPaths include .claude.json and .claude (directory)
        // But configPath is .claude.json, so detect works, config missing
        return p.endsWith('.claude') && !p.endsWith('.claude.json');
      });

      const { detectAgents } = await import('../../src/setup/scanner.js');
      const agents = detectAgents();

      const claude = agents.find(a => a.name === 'Claude Code');
      expect(claude).toBeDefined();
      expect(claude!.configExists).toBe(false);
    });

    it('should handle unparseable config', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        return p.endsWith('.claude.json') || p.endsWith('.claude');
      });

      mockReadFileSync.mockReturnValue('not valid json {{{');

      const { detectAgents } = await import('../../src/setup/scanner.js');
      const agents = detectAgents();

      const claude = agents.find(a => a.name === 'Claude Code');
      expect(claude!.configExists).toBe(true);
      expect(claude!.hasLightMCP).toBe(false);
    });

    it('should detect multiple agents', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ mcpServers: {} }));

      const { detectAgents } = await import('../../src/setup/scanner.js');
      const agents = detectAgents();

      expect(agents.length).toBeGreaterThan(0);
    });
  });

  describe('configureAllAgents', () => {
    it('should handle manual mode', async () => {
      const { configureAllAgents } = await import('../../src/setup/scanner.js');

      const agents = [
        {
          name: 'Claude Code',
          description: 'Claude',
          configPath: 'C:\\Users\\test\\.claude.json',
          configExists: true,
          currentServerCount: 2,
          hasLightMCP: false,
          canAutoConfigure: true,
        },
      ];

      const results = configureAllAgents('manual', agents);
      expect(results).toHaveLength(1);
      expect(results[0]).toContain('Manual setup');
    });

    it('should skip canAutoConfigure=false', async () => {
      const { configureAllAgents } = await import('../../src/setup/scanner.js');

      const agents = [
        {
          name: 'openCode Desktop',
          description: 'Desktop',
          configPath: 'C:\\path\\file.dat',
          configExists: true,
          currentServerCount: 0,
          hasLightMCP: false,
          canAutoConfigure: false,
          note: 'Config is a binary file',
        },
      ];

      const results = configureAllAgents('add', agents);
      expect(results).toHaveLength(1);
      expect(results[0]).toContain('SKIPPED');
    });

    it('should handle isolate mode', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ mcpServers: { old_server: { command: 'test' } } }));

      const { configureAllAgents } = await import('../../src/setup/scanner.js');

      const agents = [
        {
          name: 'Claude Code',
          description: 'Claude',
          configPath: 'C:\\Users\\test\\.claude.json',
          configExists: true,
          currentServerCount: 1,
          hasLightMCP: false,
          canAutoConfigure: true,
        },
      ];

      const results = configureAllAgents('isolate', agents);
      expect(results).toHaveLength(1);
      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it('should handle add mode', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ mcpServers: { existing: { command: 'test' } } }));

      const { configureAllAgents } = await import('../../src/setup/scanner.js');

      const agents = [
        {
          name: 'Claude Code',
          description: 'Claude',
          configPath: 'C:\\Users\\test\\.claude.json',
          configExists: true,
          currentServerCount: 1,
          hasLightMCP: false,
          canAutoConfigure: true,
        },
      ];

      const results = configureAllAgents('add', agents);
      expect(results).toHaveLength(1);
      expect(results[0]).toContain('added LightMCP');
    });

    it('should handle config not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const { configureAllAgents } = await import('../../src/setup/scanner.js');

      const agents = [
        {
          name: 'Claude Code',
          description: 'Claude',
          configPath: 'C:\\Users\\test\\.claude.json',
          configExists: false,
          currentServerCount: 0,
          hasLightMCP: false,
          canAutoConfigure: true,
        },
      ];

      const results = configureAllAgents('add', agents);
      expect(results).toHaveLength(1);
    });
  });

  describe('generateManualInstructions', () => {
    it('should return empty-ish for empty agents array', async () => {
      const { generateManualInstructions } = await import('../../src/setup/scanner.js');
      const result = generateManualInstructions([]);

      expect(result).toContain('Manual Setup Instructions');
    });

    it('should include agent names in instructions', async () => {
      const { generateManualInstructions } = await import('../../src/setup/scanner.js');

      const agents = [
        {
          name: 'Claude Code',
          description: 'Anthropic Claude',
          configPath: 'C:\\Users\\test\\.claude.json',
          configExists: true,
          currentServerCount: 1,
          hasLightMCP: false,
          canAutoConfigure: true,
        },
      ];

      const result = generateManualInstructions(agents);

      expect(result).toContain('Claude Code');
      expect(result).toContain('.claude.json');
    });

    it('should skip unknown agents', async () => {
      const { generateManualInstructions } = await import('../../src/setup/scanner.js');

      const agents = [
        {
          name: 'UnknownAgent',
          description: 'Unknown',
          configPath: '/unknown/path.json',
          configExists: false,
          currentServerCount: 0,
          hasLightMCP: false,
          canAutoConfigure: true,
        },
      ];

      const result = generateManualInstructions(agents);

      expect(result).not.toContain('UnknownAgent');
    });

    it('should handle multiple agents', async () => {
      const { generateManualInstructions } = await import('../../src/setup/scanner.js');

      const agents = [
        {
          name: 'Claude Code',
          description: 'Anthropic Claude',
          configPath: 'C:\\Users\\test\\.claude.json',
          configExists: true,
          currentServerCount: 1,
          hasLightMCP: false,
          canAutoConfigure: true,
        },
        {
          name: 'Cursor',
          description: 'Cursor AI',
          configPath: 'C:\\Users\\test\\.cursor\\mcp.json',
          configExists: true,
          currentServerCount: 3,
          hasLightMCP: false,
          canAutoConfigure: true,
        },
      ];

      const result = generateManualInstructions(agents);
      expect(result).toContain('Claude Code');
      expect(result).toContain('Cursor');
    });
  });
});
