import { describe, it, expect } from 'vitest';

function parseCallArgs(rawArgs: string[]): Record<string, unknown> {
  let toolArgs: Record<string, unknown> = {};

  if (rawArgs.length === 1) {
    try {
      toolArgs = JSON.parse(rawArgs[0]);
    } catch {
      toolArgs = { input: rawArgs[0] };
    }
  } else if (rawArgs.length > 1) {
    for (let i = 0; i < rawArgs.length; i++) {
      let key = rawArgs[i].replace(/^--?/, "");
      const eqIdx = key.indexOf("=");
      if (eqIdx >= 0) {
        const val = key.slice(eqIdx + 1).replace(/^['"]|['"]$/g, "");
        key = key.slice(0, eqIdx);
        toolArgs[key] = val;
      } else {
        const next = rawArgs[i + 1];
        if (next && !next.startsWith("-")) {
          toolArgs[key] = next.replace(/^['"]|['"]$/g, "");
          i++;
        }
      }
    }
  }

  return toolArgs;
}

const knownServers = ["kicad", "chrome-devtools-mcp", "sequential-thinking", "autodesk-fusion"];

function resolveToolAndArgs(firstArg: string, rawArgs: string[]): { tool: string; args: string[] } {
  let tool = firstArg;
  let argsStart = 0;
  if (rawArgs.length > 0 && knownServers.includes(firstArg)) {
    tool = rawArgs[0];
    argsStart = 1;
  }
  return { tool, args: rawArgs.slice(argsStart) };
}

describe('parseCallArgs', () => {
  it('should parse JSON string', () => {
    expect(parseCallArgs(['{"query":"resistor"}']))
      .toEqual({ query: "resistor" });
  });

  it('should fallback to { input: text } for non-JSON', () => {
    expect(parseCallArgs(['find resistor']))
      .toEqual({ input: 'find resistor' });
  });

  it('should parse key=value pairs', () => {
    expect(parseCallArgs(['query=resistor', 'limit=10']))
      .toEqual({ query: 'resistor', limit: '10' });
  });

  it('should parse --key value pairs', () => {
    expect(parseCallArgs(['--query', 'resistor', '--limit', '10']))
      .toEqual({ query: 'resistor', limit: '10' });
  });

  it('should skip known server prefix', () => {
    const { tool, args } = resolveToolAndArgs('kicad', ['search_footprints', '--query', 'resistor']);
    expect(tool).toBe('search_footprints');
    expect(args).toEqual(['--query', 'resistor']);
  });

  it('should not skip unknown prefix', () => {
    const { tool, args } = resolveToolAndArgs('unknown_server', ['some_tool', '--arg', 'val']);
    expect(tool).toBe('unknown_server');
    expect(args).toEqual(['some_tool', '--arg', 'val']);
  });

  it('should strip quotes from values', () => {
    expect(parseCallArgs(['--query', '"resistor value"']))
      .toEqual({ query: 'resistor value' });
  });

  it('should handle empty args', () => {
    expect(parseCallArgs([])).toEqual({});
  });

  it('should handle --file option (present in array)', () => {
    expect(parseCallArgs(['--output', 'result.png', '--query', 'test']))
      .toEqual({ output: 'result.png', query: 'test' });
  });

  it('should handle output path', () => {
    expect(parseCallArgs(['--path', 'c:\\temp\\out.txt']))
      .toEqual({ path: 'c:\\temp\\out.txt' });
  });

  it('should have correct knownServers', () => {
    expect(knownServers).toContain('kicad');
    expect(knownServers).toContain('chrome-devtools-mcp');
    expect(knownServers).toContain('sequential-thinking');
    expect(knownServers).toContain('autodesk-fusion');
  });
});
