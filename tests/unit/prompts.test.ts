import { describe, it, expect } from 'vitest';
import { buildToolSelectionPrompt } from '../../src/prompts/tool_selector.js';
import type { ToolEntry } from '../../src/types.js';

describe('tool_selector.ts', () => {
  const mockCatalog: ToolEntry[] = [
    {
      name: "create_footprint",
      serverKey: "kicad",
      serverTransport: "stdio",
      description: "Creates a new PCB footprint in a specified library",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Footprint name" },
          library: { type: "string", description: "Target library" },
        },
      },
      shortDesc: "Creates a new PCB footprint in a specified library",
    },
    {
      name: "get_sketch",
      serverKey: "autodesk-fusion",
      serverTransport: "http",
      description: "Gets a Fusion 360 sketch by name",
      inputSchema: { type: "object", properties: {} },
      shortDesc: "Gets a Fusion 360 sketch by name",
    },
  ];

  it('should build correct system and user prompts with server grouping', () => {
    const task = "Create a new PCB footprint";

    const { systemPrompt, userPrompt } = buildToolSelectionPrompt(task, mockCatalog);

    expect(systemPrompt).toContain('precise semantic tool router');
    expect(systemPrompt).toContain('REASONING FRAMEWORK');
    expect(systemPrompt).toContain('SELECTION GUIDELINES');

    expect(userPrompt).toContain('AVAILABLE TOOLS');
    expect(userPrompt).toContain('USER TASK TO ACCOMPLISH:');
    expect(userPrompt).toContain('"Create a new PCB footprint"');

    // Server grouping with domain labels
    expect(userPrompt).toContain('=== kicad');
    expect(userPrompt).toContain('=== autodesk-fusion');
    expect(userPrompt).toContain('[PCB / EDA design]');
    expect(userPrompt).toContain('[3D CAD / Fusion 360]');

    // Tool entries in new format with parameter hints
    expect(userPrompt).toContain('"create_footprint"');
    expect(userPrompt).toContain('Creates a new PCB footprint in a specified library');
    expect(userPrompt).toContain('[params: name, library]');
    expect(userPrompt).toContain('"get_sketch"');
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

    expect(systemPrompt).toContain('precise semantic tool router');
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

  it('should not include params hint when no parameters', () => {
    const task = "Get a sketch";

    const { userPrompt } = buildToolSelectionPrompt(task, mockCatalog);

    // get_sketch has empty properties — should NOT show [params:]
    const sketchLine_index = userPrompt.indexOf('"get_sketch"');
    const sketchLine = userPrompt.slice(sketchLine_index, sketchLine_index + 120);
    expect(sketchLine).not.toContain('[params:');
  });

  it('should include tip when ToolEntry has tip', () => {
    const catalogWithTip: ToolEntry[] = [
      {
        name: "create_footprint",
        serverKey: "kicad",
        serverTransport: "stdio",
        description: "Creates a PCB footprint",
        inputSchema: { type: "object", properties: { name: { type: "string" } } },
        shortDesc: "Creates a footprint",
        tip: "Use this tool to create a new component footprint for PCB layout",
      },
    ];

    const { userPrompt } = buildToolSelectionPrompt("Make a footprint", catalogWithTip);

    expect(userPrompt).toContain('[tip: Use this tool to create a new component footprint for PCB layout]');
  });

  it('should not include [tip:] when tip is empty', () => {
    const { userPrompt } = buildToolSelectionPrompt("Make a footprint", mockCatalog);

    // No tool has tip set — [tip: should NOT appear]
    expect(userPrompt).not.toContain('[tip:');
  });
});
