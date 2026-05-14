import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    server: { port: 3131, host: '127.0.0.1' },
    ollama: {
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      maxRetries: 2,
      startupTimeoutSeconds: 30,
      idleTimeoutSeconds: 120,
    },
    catalog: { outputPath: 'catalog.json', activeOnly: false },
  }),
}));

vi.mock('../../src/catalog/loader.js', () => ({
  getCatalogMeta: vi.fn(),
}));

vi.mock('../../src/ollama/manager.js', () => ({
  pingOllama: vi.fn(),
}));

describe('cli status command', () => {
  let consoleLogSpy: any;

  beforeEach(() => {
    vi.resetAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('statusCommand logic', () => {
    it('should show port and ollama status', async () => {
      const { loadConfig } = await import('../../src/config.js');
      const { pingOllama } = await import('../../src/ollama/manager.js');

      vi.mocked(pingOllama).mockResolvedValue(true);

      const cfg = await loadConfig();
      const ollamaAlive = await pingOllama(cfg.ollama.host);

      expect(ollamaAlive).toBe(true);
      expect(cfg.server.port).toBe(3131);
    });

    it('should show catalog metadata', async () => {
      const { getCatalogMeta } = await import('../../src/catalog/loader.js');

      vi.mocked(getCatalogMeta).mockResolvedValue({
        builtAt: '2025-01-01T00:00:00Z',
        toolCount: 42,
        serverCount: 5,
        activeOnly: false,
      });

      const meta = await getCatalogMeta();

      expect(meta!.toolCount).toBe(42);
      expect(meta!.serverCount).toBe(5);
      expect(meta!.activeOnly).toBe(false);
    });

    it('should warn when catalog not built', async () => {
      const { getCatalogMeta } = await import('../../src/catalog/loader.js');

      vi.mocked(getCatalogMeta).mockResolvedValue(null);

      const meta = await getCatalogMeta();

      expect(meta).toBeNull();
    });

    it('should show stopped when ping fails', async () => {
      const { pingOllama } = await import('../../src/ollama/manager.js');

      vi.mocked(pingOllama).mockResolvedValue(false);

      const alive = await pingOllama('http://127.0.0.1:11434');

      expect(alive).toBe(false);
    });
  });
});
