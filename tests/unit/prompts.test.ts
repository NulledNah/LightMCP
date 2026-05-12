import { describe, it, expect } from 'vitest';
import { buildToolSelectionPrompt } from '../../src/prompts/tool_selector.js';
import type { ToolEntry } from '../../src/types.js';

describe('tool_selector.ts', () => {
  const mockCatalog: ToolEntry[] = [
    {
      name: "create_footprint",
      serverKey: "kicad",
      serverTransport: "stdio",
      description: "Creates a PCB footprint",
      inputSchema: { type: "object", properties: {} },
      shortDesc: "Creates a footprint",
    },
    {
      name: "get_sketch",
      serverKey: "fusion",
      serverTransport: "http",
      description: "Gets a Fusion 360 sketch",
      inputSchema: { type: "object", properties: {} },
      shortDesc: "Gets a sketch",
    },
  ];

  it('should build correct system and user prompts', () => {
    const task = "Create a new PCB footprint";

    const { systemPrompt, userPrompt } = buildToolSelectionPrompt(task, mockCatalog);

    expect(systemPrompt).toContain('You are an elite, highly aggressive semantic tool router API');
    expect(systemPrompt).toContain('CRITICAL RULES');
    expect(systemPrompt).toContain('AVAILABLE TOOLS');

    expect(userPrompt).toContain('AVAILABLE TOOLS');
    expect(userPrompt).toContain('USER TASK TO ACCOMPLISH:');
    expect(userPrompt).toContain('"Create a new PCB footprint"');
    expect(userPrompt).toContain('"create_footprint" (Server: kicad): Creates a footprint');
    expect(userPrompt).toContain('"get_sketch" (Server: fusion): Gets a sketch');
  });

  it('should include hints if provided', () => {
    const task = "Fix error";
    const hints = ["Remember to check DRC", "Use mm"];

    const { userPrompt } = buildToolSelectionPrompt(task, [], hints);

    expect(userPrompt).toContain('Additional Context / Hints: Remember to check DRC, Use mm');
    expect(userPrompt).toContain('USER TASK TO ACCOMPLISH:');
    expect(userPrompt).toContain('"Fix error"');
  });

  it('should handle empty catalog', () => {
    const task = "Some task";
    const { systemPrompt, userPrompt } = buildToolSelectionPrompt(task, []);

    expect(systemPrompt).toContain('You are an elite, highly aggressive semantic tool router API');
    expect(userPrompt).toContain('AVAILABLE TOOLS');
    expect(userPrompt).toContain('"Some task"');
  });

  it('should handle multiple hints correctly', () => {
    const task = "Do something";
    const hints = ["hint1", "hint2", "hint3"];

    const { userPrompt } = buildToolSelectionPrompt(task, [], hints);

    expect(userPrompt).toContain('Additional Context / Hints: hint1, hint2, hint3');
  });

  it('should not include hints section when hints empty', () => {
    const task = "Simple task";
    const { userPrompt } = buildToolSelectionPrompt(task, []);

    expect(userPrompt).not.toContain('Additional Context / Hints');
  });
});
