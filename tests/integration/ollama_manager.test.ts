import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { startOllama, stopOllama, ensureOllamaReady, getOllamaState } from '../../src/ollama/manager.js';
import * as config from '../../src/config.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
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
    };
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    const promise = startOllama();
    expect(getOllamaState()).toBe('starting');
    
    await promise;
    expect(spawn).toHaveBeenCalledWith('ollama', ['serve'], expect.any(Object));
    expect(getOllamaState()).toBe('ready');
  });

  it('should kill process on stopOllama', async () => {
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ ok: true } as Response);

    const mockProcess = {
      on: vi.fn((event, cb) => {
        if (event === 'exit') setTimeout(cb, 10);
      }),
      kill: vi.fn(),
    };
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    await startOllama();
    expect(getOllamaState()).toBe('ready');

    await stopOllama();
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(getOllamaState()).toBe('stopped');
  });
});
