import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectTools } from '../../src/ollama/client.js';
import * as config from '../../src/config.js';
import * as prompts from '../../src/prompts/tool_selector.js';
import type { ToolEntry } from '../../src/types.js';

vi.mock('../../src/config.js');
vi.mock('../../src/prompts/tool_selector.js');

describe('ollama client', () => {
  const mockCatalog: ToolEntry[] = [
    {
      name: 'tool_a',
      serverKey: 's1',
      serverTransport: 'stdio',
      description: 'Tool A description',
      inputSchema: {},
      shortDesc: 'Tool A',
    },
    {
      name: 'tool_b',
      serverKey: 's2',
      serverTransport: 'http',
      description: 'Tool B description',
      inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      shortDesc: 'Tool B',
    },
  ];

  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(config.loadConfig).mockResolvedValue({
      ollama: {
        host: 'http://127.0.0.1:11434',
        model: 'test-model',
        maxRetries: 1,
      },
    } as any);

    vi.mocked(prompts.buildToolSelectionPrompt).mockReturnValue({
      systemPrompt: 'system prompt',
      userPrompt: 'user prompt',
    });

    global.fetch = vi.fn();
  });

  it('should call Ollama API and return tool names', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: JSON.stringify({ reasoning: 'test', tools: ['tool_a'] }) },
        done: true,
      }),
    } as any);

    const result = await selectTools('test task', mockCatalog);

    expect(result).toEqual(['tool_a']);
    expect(prompts.buildToolSelectionPrompt).toHaveBeenCalledWith('test task', mockCatalog, []);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/chat',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('should pass hints to prompt builder', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: JSON.stringify({ reasoning: 'test', tools: ['tool_b'] }) },
        done: true,
      }),
    } as any);

    const hints = ['electronics', 'pinout'];
    await selectTools('find components', mockCatalog, hints);

    expect(prompts.buildToolSelectionPrompt).toHaveBeenCalledWith('find components', mockCatalog, hints);
  });

  it('should retry on failure and succeed on second attempt', async () => {
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: JSON.stringify({ reasoning: 'retry', tools: ['tool_a'] }) },
          done: true,
        }),
      } as any);

    const result = await selectTools('retry task', mockCatalog);

    expect(result).toEqual(['tool_a']);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should throw after all retries exhausted', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('network down'));

    await expect(selectTools('fail task', mockCatalog)).rejects.toThrow();
    // maxRetries = 1, so total attempts = 2 (maxRetries + 1)
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should throw on non-ok HTTP response', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as any);

    await expect(selectTools('error task', mockCatalog)).rejects.toThrow('Ollama HTTP 500');
  });

  it('should throw on invalid JSON from model', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: 'not valid json {{{' },
        done: true,
      }),
    } as any);

    await expect(selectTools('bad json', mockCatalog)).rejects.toThrow('invalid JSON');
  });

  it('should throw on unexpected JSON schema from model', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: JSON.stringify({ wrong_key: [] }) },
        done: true,
      }),
    } as any);

    await expect(selectTools('bad schema', mockCatalog)).rejects.toThrow('unexpected schema');
  });

  it('should handle empty tool selection', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: JSON.stringify({ reasoning: 'no tools needed', tools: [] }) },
        done: true,
      }),
    } as any);

    const result = await selectTools('no tools', mockCatalog);
    expect(result).toEqual([]);
  });
});
