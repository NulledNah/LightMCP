import { describe, it, expect } from 'vitest';
import { buildToolSelectionPrompt } from '../../src/prompts/tool_selector.js';
import type { ToolEntry } from '../../src/types.js';

describe('tool_selector.ts', () => {
  it('should build correct system and user prompts', () => {
    const task = "Create a new PCB footprint";
    const catalog: ToolEntry[] = [
      {
        serverKey: "kicad",
        name: "create_footprint",
        shortDesc: "Creates a footprint",
        schema: { name: "create_footprint", description: "Creates a footprint", inputSchema: { type: "object", properties: {} } }
      },
      {
        serverKey: "fusion",
        name: "get_sketch",
        shortDesc: "Gets a sketch",
        schema: { name: "get_sketch", description: "Gets a sketch", inputSchema: { type: "object", properties: {} } }
      }
    ];

    const { systemPrompt, userPrompt } = buildToolSelectionPrompt(task, catalog);

    expect(systemPrompt).toContain('You are a strict JSON-only API');
    expect(systemPrompt).toContain('Respond with ONLY a valid JSON object');
    
    expect(userPrompt).toContain('TASK: Create a new PCB footprint');
    expect(userPrompt).toContain('- "create_footprint" (kicad): Creates a footprint');
    expect(userPrompt).toContain('- "get_sketch" (fusion): Gets a sketch');
  });

  it('should include hints if provided', () => {
    const task = "Fix error";
    const { userPrompt } = buildToolSelectionPrompt(task, [], ["Remember to check DRC", "Use mm"]);
    
    expect(userPrompt).toContain('Additional context: Remember to check DRC, Use mm');
  });
});
