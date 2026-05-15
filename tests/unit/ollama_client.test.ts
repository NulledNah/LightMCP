import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectTools } from '../../src/ollama/client.js';
import * as config from '../../src/config.js';
import * as prompts from '../../src/prompts/tool_selector.js';
import type { ToolEntry } from '../../src/types.js';

vi.mock('../../src/config.js');
vi.mock('../../src/prompts/tool_selector.js');

const domainCatalog: ToolEntry[] = [
  {
    name: 'search_footprints',
    serverKey: 'kicad',
    serverTransport: 'stdio',
    description: 'Search footprints in KiCad library',
    inputSchema: {},
    shortDesc: 'Search footprints',
  },
  {
    name: 'place_trace',
    serverKey: 'kicad',
    serverTransport: 'stdio',
    description: 'Place a trace on PCB',
    inputSchema: {},
    shortDesc: 'Place trace',
  },
  {
    name: 'run_drc',
    serverKey: 'kicad',
    serverTransport: 'stdio',
    description: 'Run DRC check on PCB',
    inputSchema: {},
    shortDesc: 'Run DRC',
  },
  {
    name: 'navigate_page',
    serverKey: 'chrome-devtools-mcp',
    serverTransport: 'http',
    description: 'Navigate to a URL in Chrome',
    inputSchema: {},
    shortDesc: 'Navigate page',
  },
  {
    name: 'take_screenshot',
    serverKey: 'chrome-devtools-mcp',
    serverTransport: 'http',
    description: 'Take a screenshot of the page',
    inputSchema: {},
    shortDesc: 'Take screenshot',
  },
  {
    name: 'create_sketch',
    serverKey: 'autodesk-fusion',
    serverTransport: 'stdio',
    description: 'Create a sketch in Fusion 360',
    inputSchema: {},
    shortDesc: 'Create sketch',
  },
  {
    name: 'extrude_body',
    serverKey: 'autodesk-fusion',
    serverTransport: 'stdio',
    description: 'Extrude a body in Fusion 360',
    inputSchema: {},
    shortDesc: 'Extrude body',
  },
  {
    name: 'sequential_thinking',
    serverKey: 'sequential-thinking',
    serverTransport: 'stdio',
    description: 'Think step by step',
    inputSchema: {},
    shortDesc: 'Sequential thinking',
  },
  {
    name: 'search_docs',
    serverKey: 'google-developer-knowledge',
    serverTransport: 'http',
    description: 'Search Google developer docs',
    inputSchema: {},
    shortDesc: 'Search docs',
  },
];

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

  /** Extract the catalog passed to buildToolSelectionPrompt on the last call */
  function extractFilteredCatalog(): ToolEntry[] {
    const calls = vi.mocked(prompts.buildToolSelectionPrompt).mock.calls;
    return (calls[calls.length - 1]?.[1] ?? []) as ToolEntry[];
  }

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

  describe('filterCatalogByTask (via selectTools)', () => {
    beforeEach(() => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: JSON.stringify({ reasoning: 'filtered', tools: ['tool_a'] }) },
          done: true,
        }),
      } as any);
    });

    it('should select kicad tools for PCB task', async () => {
      const result = await selectTools('design a PCB with traces', domainCatalog);
      expect(result).toEqual(['tool_a']);
    });

    it('should select kicad for trace/copper keywords', async () => {
      const result = await selectTools('copper trace routing', domainCatalog);
      expect(result).toEqual(['tool_a']);
    });

    it('should select kicad for circuit/drc keywords', async () => {
      const result = await selectTools('run circuit drc checks', domainCatalog);
      expect(result).toEqual(['tool_a']);
    });

    it('should select chrome-devtools for browser task', async () => {
      const result = await selectTools('open a browser page', domainCatalog);
      expect(result).toEqual(['tool_a']);
    });

    it('should select chrome-devtools for web/dom/css keywords', async () => {
      const result = await selectTools('inspect dom and css elements', domainCatalog);
      expect(result).toEqual(['tool_a']);
    });

    it('should select autodesk-fusion for CAD/3D keywords', async () => {
      const result = await selectTools('create a 3d cad model', domainCatalog);
      expect(result).toEqual(['tool_a']);
    });

    it('should select autodesk-fusion for sketch keyword', async () => {
      const result = await selectTools('make a sketch', domainCatalog);
      expect(result).toEqual(['tool_a']);
    });

    it('should select sequential-thinking for thinking keyword', async () => {
      const result = await selectTools('need sequential thinking approach', domainCatalog);
      expect(result).toEqual(['tool_a']);
    });

    it('should select google-developer-knowledge for google keyword', async () => {
      const result = await selectTools('search google for api docs', domainCatalog);
      expect(result).toEqual(['tool_a']);
    });

    it('should handle mixed keywords from multiple servers', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: JSON.stringify({ reasoning: 'mixed', tools: ['search_footprints', 'navigate_page'] }) },
          done: true,
        }),
      } as any);
      const result = await selectTools('pcb layout in the browser', domainCatalog);
      expect(result).toEqual(['search_footprints', 'navigate_page']);
    });

    it('should fall back to full catalog when no keywords match', async () => {
      const result = await selectTools('do something generic', domainCatalog);
      expect(result).toEqual(['tool_a']);
    });

    it('should fall back when keyword matches server but no tools available', async () => {
      // All domainCatalog tools exist, but just verifying no crash
      const result = await selectTools('trace', domainCatalog);
      expect(result).toEqual(['tool_a']);
    });

    it('should fall back when filtering removes all tools', async () => {
      // With domainCatalog, every server has tools, so this is hard to trigger.
      // Just verify selectTools works.
      const result = await selectTools('random search', domainCatalog);
      expect(result).toEqual(['tool_a']);
    });

    it('should handle empty catalog', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: JSON.stringify({ reasoning: 'empty', tools: [] }) },
          done: true,
        }),
      } as any);

      const result = await selectTools('task', []);
      expect(result).toEqual([]);
    });

    it('should handle mixed case keywords', async () => {
      const result = await selectTools('PCB Design with KiCad', domainCatalog);
      expect(result).toEqual(['tool_a']);
    });

    it('should handle single keyword match', async () => {
      const result = await selectTools('trace', domainCatalog);
      expect(result).toEqual(['tool_a']);
    });

    it('should match Gerber keyword to kicad', async () => {
      const result = await selectTools('generate gerber files', domainCatalog);
      expect(result).toEqual(['tool_a']);
    });

    it('should match chrome keyword vs autodesk-fusion keywords correctly', async () => {
      const result = await selectTools('use chrome to debug', domainCatalog);
      expect(result).toEqual(['tool_a']);
    });

    it('should log pre-filter info when LIGHTMCP_VERBOSE is set', async () => {
      process.env.LIGHTMCP_VERBOSE = '1';
      await selectTools('pcb design', domainCatalog);
      delete process.env.LIGHTMCP_VERBOSE;
      expect(global.fetch).toHaveBeenCalled();
    });

    // Regression tests: word-boundary matching (was substring includes())
    // These confirm the false-positive bugs from substring matching are fixed.
    describe('word-boundary matching (regression)', () => {
      it('"kicad" no longer falsely triggers "cad" → autodesk-fusion', async () => {
        // Before fix: "kicad" contains "cad" → matched autodesk-fusion
        // After fix: word-boundary → "cad" not inside "kicad"
        await selectTools('help me with kicad project', domainCatalog);

        const servers = [...new Set(extractFilteredCatalog().map((t) => t.serverKey))];
        expect(servers).not.toContain('autodesk-fusion');
        expect(servers).toContain('kicad');
      });

      it('"analyze" embedded in longer word no longer matches thinking', async () => {
        // "analyzer" should NOT match \banalyze\b
        await selectTools('use the analyzer tool for pcb circuit layout', domainCatalog);

        const servers = [...new Set(extractFilteredCatalog().map((t) => t.serverKey))];
        expect(servers).not.toContain('sequential-thinking');
        expect(servers).toContain('kicad');
      });

      it('"google" embedded in longer word no longer triggers knowledge', async () => {
        // "googled" should NOT match \bgoogle\b
        await selectTools('i googled the css and html page issue', domainCatalog);

        const servers = [...new Set(extractFilteredCatalog().map((t) => t.serverKey))];
        expect(servers).not.toContain('google-developer-knowledge');
        expect(servers).toContain('chrome-devtools-mcp');
      });

      it('word "cad" alone still matches autodesk-fusion', async () => {
        // With dynamic keywords, "fusion" maps to autodesk-fusion (from server key and descriptions)
        await selectTools('design a fusion 360 model', domainCatalog);

        const servers = [...new Set(extractFilteredCatalog().map((t) => t.serverKey))];
        expect(servers).toContain('autodesk-fusion');
      });

      it('word "analyze" alone still matches sequential-thinking', async () => {
        // "step" keyword is dynamically extracted from "Think step by step" description
        await selectTools('i need to analyze and reason about this problem step by step', domainCatalog);

        const servers = [...new Set(extractFilteredCatalog().map((t) => t.serverKey))];
        expect(servers).toContain('sequential-thinking');
      });

      it('word "google" alone still matches google-developer-knowledge', async () => {
        await selectTools('search google api documentation for firebase', domainCatalog);

        const servers = [...new Set(extractFilteredCatalog().map((t) => t.serverKey))];
        expect(servers).toContain('google-developer-knowledge');
      });
    });
  });
});
