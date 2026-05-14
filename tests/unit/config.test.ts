import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as fsPromises from 'node:fs/promises';
import { loadConfig, invalidateConfig, resolveMcpConfigPath, loadMcpConfig } from '../../src/config.js';
import type { LightMCPConfig } from '../../src/types.js';

vi.mock('node:fs');
vi.mock('node:fs/promises');

describe('config.ts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidateConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadConfig', () => {
    const validConfig: LightMCPConfig = {
      server: { port: 3000, host: '127.0.0.1', idleTimeoutSeconds: 0 },
      ollama: {
        host: 'http://127.0.0.1:11434',
        model: 'test-model',
        idleTimeoutSeconds: 120,
        startupTimeoutSeconds: 30,
        maxRetries: 2,
      },
      catalog: { activeOnly: false, watchMcpConfig: false, outputPath: 'catalog.json' },
      mcpConfigPath: null,
      mcpServers: {},
    };

    it('should parse and load config correctly', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(validConfig));

      const config = await loadConfig();
      expect(config).toEqual(validConfig);
      
      const config2 = await loadConfig();
      expect(config2).toBe(config);
      expect(fsPromises.readFile).toHaveBeenCalledTimes(1);
    });

    it('should apply defaults for missing fields', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify({
        server: {},
        ollama: {},
        catalog: {},
      }));

      const config = await loadConfig();
      expect(config.server.port).toBe(3131);
      expect(config.server.host).toBe("127.0.0.1");
      expect(config.ollama.host).toBe("http://127.0.0.1:11434");
      expect(config.ollama.model).toBe("qwen2.5-coder:7b-instruct");
      expect(config.ollama.maxRetries).toBe(2);
      expect(config.catalog.activeOnly).toBe(false);
      expect(config.catalog.watchMcpConfig).toBe(true);
      expect(config.catalog.outputPath).toBe("tool_catalog.json");
      expect(config.mcpConfigPath).toBeNull();
    });

    it('should throw on invalid JSON', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fsPromises.readFile).mockResolvedValue("not json");

      await expect(loadConfig()).rejects.toThrow("invalid JSON");
    });

    it('should throw on invalid schema', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify({
        server: { port: -1 },
        ollama: {},
        catalog: {},
      }));

      await expect(loadConfig()).rejects.toThrow("Invalid");
    });

    it('should throw when file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fsPromises.readFile).mockRejectedValue(new Error("ENOENT"));

      await expect(loadConfig()).rejects.toThrow();
    });
  });

  describe('resolveMcpConfigPath', () => {
    it('should return mcpConfigPath from config if provided', async () => {
      const cfg = { mcpConfigPath: '/custom/path/mcp_config.json' } as LightMCPConfig;
      const result = await resolveMcpConfigPath(cfg);
      expect(result).toBe('/custom/path/mcp_config.json');
    });

    it('should fallback to default antigravity location if exists', async () => {
      const defaultPath = path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      
      const result = await resolveMcpConfigPath({} as LightMCPConfig);
      expect(result).toBe(defaultPath);
      expect(fs.existsSync).toHaveBeenCalledWith(defaultPath);
    });

    it('should throw if it cannot find it', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      
      await expect(resolveMcpConfigPath({} as LightMCPConfig)).rejects.toThrow(
        /Cannot find mcp_config.json/
      );
    });
  });

  describe('loadMcpConfig', () => {
    it('should parse and return valid mcp config', async () => {
      const mockMcpConfig = {
        mcpServers: {
          kicad: { command: 'kicad-mcp', args: ['serve'] },
          web: { serverUrl: 'http://localhost:3001/mcp', disabled: true },
        },
      };

      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(mockMcpConfig));

      const result = await loadMcpConfig('/path/to/mcp_config.json');
      expect(result.mcpServers.kicad.command).toBe('kicad-mcp');
      expect(result.mcpServers.web.disabled).toBe(true);
    });

    it('should throw on invalid JSON', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue("not json");

      await expect(loadMcpConfig('/path/to/mcp_config.json')).rejects.toThrow("invalid JSON");
    });

    it('should throw on invalid schema', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify({ notServers: true }));

      await expect(loadMcpConfig('/path/to/mcp_config.json')).rejects.toThrow("Invalid mcp_config.json");
    });

    it('should accept disabledTools in server config', async () => {
      const mockMcpConfig = {
        mcpServers: {
          kicad: { command: 'kicad-mcp', disabledTools: ['bad_tool'] },
        },
      };

      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(mockMcpConfig));

      const result = await loadMcpConfig('/path/to/mcp_config.json');
      expect(result.mcpServers.kicad.disabledTools).toEqual(['bad_tool']);
    });
  });
});
