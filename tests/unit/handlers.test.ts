import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetTools } from '../../src/server/handlers.js';
import * as loader from '../../src/catalog/loader.js';
import * as builder from '../../src/catalog/builder.js';
import * as manager from '../../src/ollama/manager.js';
import * as client from '../../src/ollama/client.js';
import * as mcpServerMod from '../../src/server/mcp_server.js';
import * as proxyMod from '../../src/server/proxy.js';

vi.mock('../../src/catalog/loader.js');
vi.mock('../../src/catalog/builder.js');
vi.mock('../../src/ollama/manager.js');
vi.mock('../../src/ollama/client.js');
vi.mock('../../src/server/mcp_server.js');
vi.mock('../../src/server/proxy.js');

describe('handlers.ts', () => {
  const mockRegisteredTool = { remove: vi.fn() };
  const mockRegisterTool = vi.fn(() => mockRegisteredTool);

  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(mcpServerMod.getMcpServer).mockReturnValue({
      registerTool: mockRegisterTool,
    } as any);

    vi.mocked(proxyMod.callTool).mockResolvedValue({
      content: [],
      isError: false,
    });
  });

  it('should handle get tools correctly', async () => {
    const mockCatalog = [
      { name: 'tool1', description: 'desc1', serverKey: 's1', serverTransport: 'stdio', inputSchema: {}, shortDesc: 'Tool 1' }
    ] as any;
    
    vi.mocked(loader.getCatalogTools).mockResolvedValue(mockCatalog);
    vi.mocked(manager.ensureOllamaReady).mockResolvedValue();
    vi.mocked(client.selectTools).mockResolvedValue(['tool1']);

    const res = await handleGetTools({ task: 'do stuff' });

    expect(loader.getCatalogTools).toHaveBeenCalled();
    expect(manager.ensureOllamaReady).toHaveBeenCalled();
    expect(client.selectTools).toHaveBeenCalledWith('do stuff', mockCatalog, []);
    
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.tools).toHaveLength(1);
    expect(parsed.tools[0].name).toBe('tool1');
    expect(parsed.tools[0].serverKey).toBe('s1');
    expect(parsed.tools[0].transport).toBe('stdio');
  });

  it('should ignore hallucinated tools', async () => {
    const mockCatalog = [
      { name: 'real_tool', description: 'desc1', serverKey: 's1', serverTransport: 'stdio', inputSchema: {}, shortDesc: 'Real' }
    ] as any;
    
    vi.mocked(loader.getCatalogTools).mockResolvedValue(mockCatalog);
    vi.mocked(manager.ensureOllamaReady).mockResolvedValue();
    vi.mocked(client.selectTools).mockResolvedValue(['real_tool', 'fake_tool']);

    const res = await handleGetTools({ task: 'do stuff' });
    const parsed = JSON.parse(res.content[0].text);
    
    expect(parsed.tools).toHaveLength(1);
    expect(parsed.tools[0].name).toBe('real_tool');
  });

  it('should handle selectTools error gracefully', async () => {
    vi.mocked(loader.getCatalogTools).mockResolvedValue([{ name: 't1' } as any]);
    vi.mocked(manager.ensureOllamaReady).mockResolvedValue();
    vi.mocked(client.selectTools).mockRejectedValue(new Error("Ollama crashed"));

    const res = await handleGetTools({ task: 'do stuff' });
    const parsed = JSON.parse(res.content[0].text);
    
    expect(parsed.error).toContain("Ollama crashed");
    expect(parsed.tools).toHaveLength(0);
  });

  it('should auto-build catalog when empty', async () => {
    const builtTools = [
      { name: 'built_tool', description: 'built', serverKey: 's1', serverTransport: 'stdio', inputSchema: {}, shortDesc: 'Built' }
    ] as any;

    vi.mocked(loader.getCatalogTools)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(builtTools);

    vi.mocked(builder.buildCatalog).mockResolvedValue({
      version: 1 as const,
      builtAt: new Date().toISOString(),
      activeOnly: false,
      servers: [{ key: 's1', transport: 'stdio' as const, disabled: false, toolCount: 1 }],
      tools: builtTools,
    });

    vi.mocked(manager.ensureOllamaReady).mockResolvedValue();
    vi.mocked(client.selectTools).mockResolvedValue(['built_tool']);

    const res = await handleGetTools({ task: 'build test' });
    const parsed = JSON.parse(res.content[0].text);

    expect(builder.buildCatalog).toHaveBeenCalledTimes(1);
    expect(parsed.tools).toHaveLength(1);
    expect(parsed.tools[0].name).toBe('built_tool');
  });

  it('should handle ensureOllamaReady failure', async () => {
    vi.mocked(loader.getCatalogTools).mockResolvedValue([{ name: 't1' } as any]);
    vi.mocked(manager.ensureOllamaReady).mockRejectedValue(new Error("Ollama failed to start"));

    await expect(handleGetTools({ task: 'test' })).rejects.toThrow("Ollama failed to start");
  });

  it('should pass hints to selectTools', async () => {
    const mockCatalog = [{ name: 'tool1', serverKey: 's1', serverTransport: 'stdio', shortDesc: 'T1' } as any];
    vi.mocked(loader.getCatalogTools).mockResolvedValue(mockCatalog);
    vi.mocked(manager.ensureOllamaReady).mockResolvedValue();
    vi.mocked(client.selectTools).mockResolvedValue(['tool1']);

    const hints = ['electronics', 'pcb'];
    await handleGetTools({ task: 'design', hints });

    expect(client.selectTools).toHaveBeenCalledWith('design', mockCatalog, hints);
  });

  it('should return empty tools when all selected are hallucinated', async () => {
    vi.mocked(loader.getCatalogTools).mockResolvedValue([{ name: 'real_only', serverKey: 's1', serverTransport: 'stdio', shortDesc: 'Real' } as any]);
    vi.mocked(manager.ensureOllamaReady).mockResolvedValue();
    vi.mocked(client.selectTools).mockResolvedValue(['fake1', 'fake2', 'fake3']);

    const res = await handleGetTools({ task: 'test' });
    const parsed = JSON.parse(res.content[0].text);

    expect(parsed.tools).toHaveLength(0);
    expect(parsed.selected).toBe(0);
  });

  it('should include tip in response when tool has tip', async () => {
    const mockCatalog = [
      { name: 'tool_a', description: 'desc', serverKey: 's1', serverTransport: 'stdio', inputSchema: {}, shortDesc: 'Tool A', tip: 'Use for X before Y' }
    ] as any;

    vi.mocked(loader.getCatalogTools).mockResolvedValue(mockCatalog);
    vi.mocked(manager.ensureOllamaReady).mockResolvedValue();
    vi.mocked(client.selectTools).mockResolvedValue(['tool_a']);

    const res = await handleGetTools({ task: 'do X' });
    const parsed = JSON.parse(res.content[0].text);

    expect(parsed.tools).toHaveLength(1);
    expect(parsed.tools[0].tip).toBe('Use for X before Y');
  });
});
