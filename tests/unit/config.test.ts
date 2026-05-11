import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as fsPromises from 'node:fs/promises';
import { loadConfig, invalidateConfig, resolveMcpConfigPath, loadMcpConfig } from '../../src/config.js';
import type { LightMCPConfig } from '../../src/types.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(),
  };
});

describe('config.ts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidateConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadConfig', () => {
    it('should parse and load config correctly', async () => {
      const mockConfig: LightMCPConfig = {
        server: { port: 3000, host: '127.0.0.1' },
        ollama: { model: 'test-model', idleTimeoutSeconds: 10, startupTimeoutSeconds: 10 },
        catalog: { activeOnly: false, watchMcpConfig: false }
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const config = await loadConfig();
      expect(config).toEqual(mockConfig);
      
      // Should cache it
      const config2 = await loadConfig();
      expect(config2).toBe(config);
      expect(fsPromises.readFile).toHaveBeenCalledTimes(1);
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
});
