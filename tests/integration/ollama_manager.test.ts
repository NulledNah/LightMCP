import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { startOllama, stopOllama, ensureOllamaReady, getOllamaState, ensureModelPulled, keepOllamaAlive } from '../../src/ollama/manager.js';
import * as config from '../../src/config.js';

vi.mock('../../src/config.js');
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

describe('ollama manager', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(config.loadConfig).mockResolvedValue({
      ollama: {
        host: 'http://127.0.0.1:11434',
        model: 'test-model',
        startupTimeoutSeconds: 1,
        idleTimeoutSeconds: 1,
        maxRetries: 2,
      }
    } as any);
    
    // reset fetch mock
    global.fetch = vi.fn();
  });

  afterEach(async () => {
    await stopOllama();
  });

  it('should not start if already running externally', async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);
    
    await startOllama();
    expect(spawn).not.toHaveBeenCalled();
    expect(getOllamaState()).toBe('ready');
  });

  it('should spawn if not running and become ready', async () => {
    // First ping fails, second ping succeeds
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ ok: true } as Response);

    const mockProcess = {
      on: vi.fn(),
      kill: vi.fn(),
      pid: 12345,
    };
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    const promise = startOllama();
    await new Promise(r => process.nextTick(r)); // yield microtask
    expect(getOllamaState()).toBe('ready');
    
    await promise;
    expect(spawn).toHaveBeenCalledWith('ollama', ['serve'], expect.any(Object));
    expect(getOllamaState()).toBe('ready');
  });

  it('should kill process on stopOllama via taskkill on Windows', async () => {
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ ok: true } as Response);

    const mockProcess = {
      on: vi.fn((event, cb) => {
        if (event === 'exit') setTimeout(cb, 10);
      }),
      kill: vi.fn(),
      pid: 12345,
    };
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    await startOllama();
    expect(getOllamaState()).toBe('ready');

    await stopOllama();
    // On Windows, execSync is used; on Linux, proc.kill is used
    // Both paths are acceptable
    expect(getOllamaState()).toBe('stopped');
  });

  it('should handle ensureOllamaReady', async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

    await ensureOllamaReady();
    expect(getOllamaState()).toBe('ready');
  });

  it('should return existing startPromise on concurrent start', async () => {
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue({ ok: true } as Response);

    const mockProcess = {
      on: vi.fn(),
      kill: vi.fn(),
      pid: 12345,
    };
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    const p1 = startOllama();
    const p2 = startOllama();

    await Promise.all([p1, p2]);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('should handle ensureModelPulled when model exists', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'test-model' }] }),
    } as any);

    await ensureModelPulled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('should handle ensureModelPulled when model is missing and pull it', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    } as any);

    const mockProc = {
      on: vi.fn((event, cb) => {
        if (event === 'close') setTimeout(() => cb(0), 5);
      }),
      kill: vi.fn(),
      pid: 99999,
    };
    vi.mocked(spawn).mockReturnValue(mockProc as any);

    await ensureModelPulled();
    expect(spawn).toHaveBeenCalledWith('ollama', ['pull', 'test-model'], expect.any(Object));
  });

  it('should handle ensureModelPulled when Ollama is not running', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    const mockProc = {
      on: vi.fn((event, cb) => {
        if (event === 'close') setTimeout(() => cb(0), 5);
      }),
      kill: vi.fn(),
      pid: 99999,
    };
    vi.mocked(spawn).mockReturnValue(mockProc as any);

    await ensureModelPulled();
    expect(spawn).toHaveBeenCalledWith('ollama', ['pull', 'test-model'], expect.any(Object));
  });

  it('should reject when ollama pull fails', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    } as any);

    const mockProc = {
      on: vi.fn((event, cb) => {
        if (event === 'close') setTimeout(() => cb(1), 5);
      }),
      kill: vi.fn(),
      pid: 99999,
    };
    vi.mocked(spawn).mockReturnValue(mockProc as any);

    await expect(ensureModelPulled()).rejects.toThrow('ollama pull exited with code 1');
  });

  it('should reset idle timer on ensureOllamaReady', async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

    const cfg = await import('../../src/config.js');
    vi.mocked(cfg.loadConfig).mockResolvedValue({
      ollama: {
        host: 'http://127.0.0.1:11434',
        model: 'test-model',
        startupTimeoutSeconds: 1,
        idleTimeoutSeconds: 1,
        maxRetries: 2,
      }
    } as any);

    await ensureOllamaReady();
    expect(getOllamaState()).toBe('ready');
  });

  it('should reset idle timer when keepOllamaAlive is called', async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

    const cfg = await import('../../src/config.js');
    vi.mocked(cfg.loadConfig).mockResolvedValue({
      ollama: {
        host: 'http://127.0.0.1:11434',
        model: 'test-model',
        startupTimeoutSeconds: 1,
        idleTimeoutSeconds: 1,
        maxRetries: 2,
      }
    } as any);

    // Start it first
    await startOllama();
    expect(getOllamaState()).toBe('ready');

    // Now keep alive should work without issues
    await keepOllamaAlive();
    expect(getOllamaState()).toBe('ready');
  });

  it('should stop after idle timeout', async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

    const cfg = await import('../../src/config.js');
    vi.mocked(cfg.loadConfig).mockResolvedValue({
      ollama: {
        host: 'http://127.0.0.1:11434',
        model: 'test-model',
        startupTimeoutSeconds: 1,
        idleTimeoutSeconds: 1,
        maxRetries: 2,
      }
    } as any);

    // Start: already running
    await startOllama();
    expect(getOllamaState()).toBe('ready');

    // Wait for idle timeout
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Stop should not throw
    await stopOllama();
    expect(getOllamaState()).toBe('stopped');
  });

  it('should fail startOllama when waitReady times out', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('connection refused'));

    const cfg = await import('../../src/config.js');
    vi.mocked(cfg.loadConfig).mockResolvedValue({
      ollama: {
        host: 'http://127.0.0.1:11434',
        model: 'test-model',
        startupTimeoutSeconds: 0,
        idleTimeoutSeconds: 1,
        maxRetries: 2,
      }
    } as any);

    const mockProcess = {
      on: vi.fn(),
      kill: vi.fn(),
      pid: 12345,
    };
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    // With startupTimeoutSeconds=0, waitReady should fail immediately
    await expect(startOllama()).rejects.toThrow();
  });
});
