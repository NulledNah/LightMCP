import { describe, it, expect } from 'vitest';
import { cleanTip } from '../../src/cli/utils.js';

describe('cleanTip', () => {
  it("should replace 'Use tool when' at start", () => {
    expect(cleanTip("Use 'search_footprints' when you need a component", "search_footprints"))
      .toBe("When you need a component");
  });

  it("should replace 'Use tool to' at start", () => {
    expect(cleanTip("Use 'search_footprints' to find parts", "search_footprints"))
      .toBe("To find parts");
  });

  it("should replace 'Use tool for' at start", () => {
    expect(cleanTip("Use 'search_footprints' for locating footprints", "search_footprints"))
      .toBe("For locating footprints");
  });

  it("should replace 'Use tool in' at start", () => {
    expect(cleanTip("Use 'search_footprints' in your workflow", "search_footprints"))
      .toBe("In your workflow");
  });

  it("should replace 'Use tool as' at start", () => {
    expect(cleanTip("Use 'search_footprints' as a helper", "search_footprints"))
      .toBe("As a helper");
  });

  it("should replace 'Use tool with' at start", () => {
    expect(cleanTip("Use 'search_footprints' with care", "search_footprints"))
      .toBe("With care");
  });

  it("should replace 'Use tool' alone at start", () => {
    expect(cleanTip("Use 'search_footprints', and then proceed", "search_footprints"))
      .toBe("And then proceed");
  });

  it("should replace mid-sentence patterns with comma", () => {
    expect(cleanTip("Start here, use 'search_footprints' to find parts", "search_footprints"))
      .toBe("Start here, to find parts");
  });

  it("should replace mid-sentence patterns with semicolon", () => {
    expect(cleanTip("Check first; use 'search_footprints' for verification", "search_footprints"))
      .toBe("Check first; for verification");
  });

  it("should replace mid-sentence with comma-and-space cleanup", () => {
    expect(cleanTip("Do this, use 'search_footprints', next step", "search_footprints"))
      .toBe("Do this, next step");
  });

  it("should replace period-separated patterns", () => {
    expect(cleanTip("Start here. Use 'search_footprints' to find parts", "search_footprints"))
      .toBe("Start here. To find parts");
  });

  it("should replace period-separated with no follow-up word", () => {
    expect(cleanTip("Start here. Use 'search_footprints'.", "search_footprints"))
      .toBe("Start here.");
  });

  it("should replace generic 'Use this tool to'", () => {
    expect(cleanTip("Start here, use this tool to find parts", "search_footprints"))
      .toBe("Start here, to find parts");
  });

  it("should replace generic 'Use this tool for' after period", () => {
    expect(cleanTip("Start here. Use this tool for verification", "search_footprints"))
      .toBe("Start here. For verification");
  });

  it("should handle empty string", () => {
    expect(cleanTip("", "search_footprints")).toBe("");
  });

  it("should escape regex special chars in tool name", () => {
    expect(cleanTip("Use 'tool.name' when needed", "tool.name"))
      .toBe("When needed");
  });

  it("should handle double-quoted tool name", () => {
    expect(cleanTip('Use "search_footprints" when needed', "search_footprints"))
      .toBe("When needed");
  });

  it("should handle backtick-quoted tool name", () => {
    expect(cleanTip("Use `search_footprints` when needed", "search_footprints"))
      .toBe("When needed");
  });

  it("should handle case insensitivity", () => {
    expect(cleanTip("use 'SEARCH_FOOTPRINTS' when needed", "search_footprints"))
      .toBe("When needed");
  });

  it("should capitalize first letter", () => {
    expect(cleanTip("for locating components in the library", "search_footprints"))
      .toBe("For locating components in the library");
  });

  it("should collapse whitespace", () => {
    expect(cleanTip("For locating    components  in  the library", "search_footprints"))
      .toBe("For locating components in the library");
  });

  it("should handle 'Use this tool when' with comma", () => {
    expect(cleanTip("Start here, Use this tool when things break", "search_footprints"))
      .toBe("Start here, when things break");
  });

  it("should handle 'Use this tool as' with comma", () => {
    expect(cleanTip("Start here, Use this tool as a reference", "search_footprints"))
      .toBe("Start here, as a reference");
  });

  it("should handle generic period-separated 'Use this tool as'", () => {
    expect(cleanTip("Start here. Use this tool as a starting point", "search_footprints"))
      .toBe("Start here. As a starting point");
  });

  it("should handle generic period-separated 'Use this tool when'", () => {
    expect(cleanTip("Start here. Use this tool when you need help", "search_footprints"))
      .toBe("Start here. When you need help");
  });

  it("should not modify text without tool references", () => {
    expect(cleanTip("Find components in the library", "search_footprints"))
      .toBe("Find components in the library");
  });

  it("should handle tool name with parentheses", () => {
    expect(cleanTip("Use 'tool(v2)' to get results", "tool(v2)"))
      .toBe("To get results");
  });
});
