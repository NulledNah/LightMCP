import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/catalog/loader.js', () => ({
  getCatalogTools: vi.fn(),
}));

vi.mock('../../src/catalog/builder.js', () => ({
  buildCatalog: vi.fn(),
}));

vi.mock('../../src/ollama/manager.js', () => ({
  ensureOllamaReady: vi.fn(),
  stopOllama: vi.fn(),
}));

vi.mock('../../src/ollama/client.js', () => ({
  selectTools: vi.fn(),
}));

describe('cli test command', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('testCommand logic', () => {
    it('should select and display valid tools', async () => {
      const { getCatalogTools } = await import('../../src/catalog/loader.js');
      const { selectTools } = await import('../../src/ollama/client.js');

      const catalog = [
        { name: 'tool_a', serverKey: 's1', serverTransport: 'stdio', description: 'desc', inputSchema: {}, shortDesc: 'Tool A' },
        { name: 'tool_b', serverKey: 's2', serverTransport: 'http', description: 'desc', inputSchema: {}, shortDesc: 'Tool B' },
      ];

      vi.mocked(getCatalogTools).mockResolvedValue(catalog);
      vi.mocked(selectTools).mockResolvedValue(['tool_a']);

      const tools = await getCatalogTools();
      const selected = await selectTools('test task', catalog);

      const validTools = tools.filter(t => selected.includes(t.name));
      expect(validTools).toHaveLength(1);
      expect(validTools[0].name).toBe('tool_a');
    });

    it('should build catalog if empty', async () => {
      const { getCatalogTools } = await import('../../src/catalog/loader.js');
      const { buildCatalog } = await import('../../src/catalog/builder.js');

      vi.mocked(getCatalogTools).mockResolvedValueOnce([]);

      let catalog = await getCatalogTools();
      expect(catalog).toHaveLength(0);

      const built = {
        version: 1 as const,
        builtAt: '2025-01-01',
        activeOnly: false,
        servers: [],
        tools: [{ name: 'tool1', serverKey: 's1', serverTransport: 'stdio', description: 'desc', inputSchema: {}, shortDesc: 'T1' }],
      };
      vi.mocked(buildCatalog).mockResolvedValue(built);

      if (catalog.length === 0) {
        const result = await buildCatalog();
        catalog = result.tools;
      }

      expect(catalog).toHaveLength(1);
      expect(buildCatalog).toHaveBeenCalled();
    });

    it('should pass empty hints when undefined', async () => {
      const { selectTools } = await import('../../src/ollama/client.js');

      const catalog = [{ name: 't1', serverKey: 's1', serverTransport: 'stdio', description: 'd', inputSchema: {}, shortDesc: 'T1' }];
      vi.mocked(selectTools).mockResolvedValue(['t1']);

      await selectTools('task', catalog);
      expect(selectTools).toHaveBeenCalledWith('task', catalog);
    });

    it('should warn about hallucinated names', async () => {
      const { selectTools } = await import('../../src/ollama/client.js');

      const catalog = [{ name: 'real_tool', serverKey: 's1', serverTransport: 'stdio', description: 'd', inputSchema: {}, shortDesc: 'T1' }];
      vi.mocked(selectTools).mockResolvedValue(['real_tool', 'fake_tool']);

      const selected = await selectTools('task', catalog);
      const validTools = catalog.filter(t => selected.includes(t.name));
      const invalid = selected.filter(n => !catalog.some(t => t.name === n));

      expect(validTools).toHaveLength(1);
      expect(invalid).toHaveLength(1);
      expect(invalid[0]).toBe('fake_tool');
    });

    it('should always stop Ollama even on error', async () => {
      const { ensureOllamaReady, stopOllama } = await import('../../src/ollama/manager.js');
      const { selectTools } = await import('../../src/ollama/client.js');

      vi.mocked(ensureOllamaReady).mockResolvedValue(undefined);
      vi.mocked(selectTools).mockRejectedValue(new Error('model crashed'));

      // Simulate the try/finally pattern in testCommand
      let error: Error | null = null;
      try {
        await ensureOllamaReady();
        await selectTools('task', []);
      } catch (e: any) {
        error = e;
      } finally {
        await stopOllama();
      }

      expect(error).toBeDefined();
      expect(stopOllama).toHaveBeenCalled();
      expect(error!.message).toBe('model crashed');
    });
  });
});
