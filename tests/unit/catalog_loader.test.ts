import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { loadCatalog, invalidateCatalog, getCatalogTools, findTool, getCatalogMeta } from '../../src/catalog/loader.js';
import * as config from '../../src/config.js';
import type { ToolCatalog } from '../../src/types.js';

vi.mock('../../src/config.js');
vi.mock('node:fs');
vi.mock('node:fs/promises');

describe('catalog loader', () => {
  const validCatalog: ToolCatalog = {
    version: 1 as const,
    builtAt: '2025-01-01T00:00:00.000Z',
    activeOnly: false,
    servers: [
      { key: 's1', transport: 'stdio' as const, disabled: false, toolCount: 2 },
      { key: 's2', transport: 'http' as const, disabled: true, toolCount: 1 },
    ],
    tools: [
      {
        name: 'tool_one',
        serverKey: 's1',
        serverTransport: 'stdio' as const,
        description: 'First tool',
        inputSchema: { type: 'object', properties: { a: { type: 'string' } } },
        shortDesc: 'Tool one',
      },
      {
        name: 'tool_two',
        serverKey: 's1',
        serverTransport: 'stdio' as const,
        description: 'Second tool',
        inputSchema: {},
        shortDesc: 'Tool two',
      },
      {
        name: 'tool_three',
        serverKey: 's2',
        serverTransport: 'http' as const,
        description: 'Third tool from disabled server',
        inputSchema: { type: 'object' },
        shortDesc: 'Tool three',
      },
    ],
  };

  beforeEach(() => {
    vi.resetAllMocks();
    invalidateCatalog();

    vi.mocked(config.loadConfig).mockResolvedValue({
      catalog: { outputPath: 'tool_catalog.json' },
    } as any);
  });

  it('should load and parse catalog correctly', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(validCatalog));

    const catalog = await loadCatalog();
    expect(catalog).not.toBeNull();
    expect(catalog!.tools).toHaveLength(3);
    expect(catalog!.servers).toHaveLength(2);
    expect(catalog!.tools[0].name).toBe('tool_one');
  });

  it('should cache catalog after first load', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(validCatalog));

    await loadCatalog();
    await loadCatalog();

    expect(fsPromises.readFile).toHaveBeenCalledTimes(1);
  });

  it('should invalidate cache and re-read', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(validCatalog));

    await loadCatalog();
    invalidateCatalog();
    await loadCatalog();

    expect(fsPromises.readFile).toHaveBeenCalledTimes(2);
  });

  it('should return null when catalog file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const catalog = await loadCatalog();
    expect(catalog).toBeNull();
  });

  it('should return null on invalid JSON', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(fsPromises.readFile).mockResolvedValue('not json');

    const catalog = await loadCatalog();
    expect(catalog).toBeNull();
  });

  it('should return null on invalid schema', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify({ wrong: 'schema' }));

    const catalog = await loadCatalog();
    expect(catalog).toBeNull();
  });

  it('should get all catalog tools', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(validCatalog));

    const tools = await getCatalogTools();
    expect(tools).toHaveLength(3);
    expect(tools[1].name).toBe('tool_two');
  });

  it('should return empty array when no catalog exists', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const tools = await getCatalogTools();
    expect(tools).toEqual([]);
  });

  it('should find a tool by name', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(validCatalog));

    const tool = await findTool('tool_two');
    expect(tool).toBeDefined();
    expect(tool!.name).toBe('tool_two');
    expect(tool!.serverKey).toBe('s1');
  });

  it('should return undefined for nonexistent tool', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(validCatalog));

    const tool = await findTool('nonexistent');
    expect(tool).toBeUndefined();
  });

  it('should return catalog metadata', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(validCatalog));

    const meta = await getCatalogMeta();
    expect(meta).not.toBeNull();
    expect(meta!.toolCount).toBe(3);
    expect(meta!.serverCount).toBe(2);
    expect(meta!.activeOnly).toBe(false);
    expect(meta!.builtAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('should return null metadata when no catalog', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const meta = await getCatalogMeta();
    expect(meta).toBeNull();
  });
});
