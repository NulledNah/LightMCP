import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetTools } from '../../src/server/handlers.js';
import * as loader from '../../src/catalog/loader.js';
import * as builder from '../../src/catalog/builder.js';
import * as manager from '../../src/ollama/manager.js';
import * as client from '../../src/ollama/client.js';

vi.mock('../../src/catalog/loader.js');
vi.mock('../../src/catalog/builder.js');
vi.mock('../../src/ollama/manager.js');
vi.mock('../../src/ollama/client.js');

describe('handlers.ts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should handle get tools correctly', async () => {
    const mockCatalog = [
      { name: 'tool1', description: 'desc1', serverKey: 's1', serverTransport: 'stdio', inputSchema: {} }
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
    expect(parsed.tools[0]._lightmcp.serverKey).toBe('s1');
  });

  it('should ignore hallucinated tools', async () => {
    const mockCatalog = [
      { name: 'real_tool', description: 'desc1', serverKey: 's1', serverTransport: 'stdio', inputSchema: {} }
    ] as any;
    
    vi.mocked(loader.getCatalogTools).mockResolvedValue(mockCatalog);
    vi.mocked(manager.ensureOllamaReady).mockResolvedValue();
    // selectTools returns one real tool and one hallucinated tool
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
});
