import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startCatalogWatcher, stopCatalogWatcher } from '../../src/catalog/watcher.js';
import * as config from '../../src/config.js';
import * as loader from '../../src/catalog/loader.js';
import * as builder from '../../src/catalog/builder.js';

vi.mock('../../src/config.js');
vi.mock('../../src/catalog/loader.js');
vi.mock('../../src/catalog/builder.js');

// chokidar needs special mocking since it returns an FSWatcher
const mockWatcher = {
  on: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => mockWatcher),
  },
}));

describe('catalog watcher', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(config.loadConfig).mockResolvedValue({
      catalog: {
        watchMcpConfig: true,
        outputPath: 'tool_catalog.json',
        activeOnly: false,
      },
      mcpConfigPath: null,
    } as any);

    vi.mocked(config.resolveMcpConfigPath).mockResolvedValue('/fake/mcp_config.json');
    vi.mocked(builder.buildCatalog).mockResolvedValue({
      version: 1 as const,
      builtAt: new Date().toISOString(),
      activeOnly: false,
      servers: [{ key: 's1', transport: 'stdio' as const, disabled: false, toolCount: 1 }],
      tools: [{ name: 't1', serverKey: 's1', serverTransport: 'stdio' as const, description: '', inputSchema: {}, shortDesc: '' }],
    });
  });

  afterEach(async () => {
    await stopCatalogWatcher();
  });

  it('should start watching the mcp_config.json file', async () => {
    await startCatalogWatcher();

    expect(mockWatcher.on).toHaveBeenCalledWith('change', expect.any(Function));
    expect(mockWatcher.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('should not watch when watchMcpConfig is disabled', async () => {
    vi.mocked(config.loadConfig).mockResolvedValue({
      catalog: {
        watchMcpConfig: false,
        outputPath: 'tool_catalog.json',
        activeOnly: false,
      },
      mcpConfigPath: null,
    } as any);

    await startCatalogWatcher();

    // chokidar.watch should not be called
    const chokidar = await import('chokidar');
    expect(chokidar.default.watch).not.toHaveBeenCalled();
  });

  it('should rebuild catalog on file change', async () => {
    vi.useFakeTimers();

    await startCatalogWatcher();

    // Get the registered change handler
    const changeHandler = mockWatcher.on.mock.calls.find(
      (call: string[]) => call[0] === 'change'
    )?.[1] as Function;

    expect(changeHandler).toBeDefined();

    // Trigger change
    changeHandler();

    // Fast forward past debounce (2000ms)
    await vi.runAllTimersAsync();

    expect(builder.buildCatalog).toHaveBeenCalledTimes(1);
    expect(loader.invalidateCatalog).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('should handle rebuild failure gracefully', async () => {
    vi.useFakeTimers();

    vi.mocked(builder.buildCatalog).mockRejectedValue(new Error('Network down'));

    await startCatalogWatcher();

    const changeHandler = mockWatcher.on.mock.calls.find(
      (call: string[]) => call[0] === 'change'
    )?.[1] as Function;

    changeHandler();
    await vi.runAllTimersAsync();

    // Should not throw; should not invalidate catalog on failure
    expect(loader.invalidateCatalog).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('should debounce multiple rapid changes', async () => {
    vi.useFakeTimers();

    await startCatalogWatcher();

    const changeHandler = mockWatcher.on.mock.calls.find(
      (call: string[]) => call[0] === 'change'
    )?.[1] as Function;

    // Trigger multiple changes rapidly
    changeHandler();
    changeHandler();
    changeHandler();

    await vi.runAllTimersAsync();

    // Should only rebuild once due to debounce
    expect(builder.buildCatalog).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('should stop watching on stopCatalogWatcher', async () => {
    await startCatalogWatcher();
    await stopCatalogWatcher();

    expect(mockWatcher.close).toHaveBeenCalled();
  });

  it('should handle watcher error events', async () => {
    await startCatalogWatcher();

    const errorHandler = mockWatcher.on.mock.calls.find(
      (call: string[]) => call[0] === 'error'
    )?.[1] as Function;

    expect(errorHandler).toBeDefined();

    // Should not throw
    expect(() => errorHandler(new Error('Watcher error'))).not.toThrow();
  });
});
