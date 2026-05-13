# MANDATORY: Tool Discovery Protocol

## Before ANY task requiring tools, run this command:

```
lightmcp get-tools "your task description in natural language"
```

If `lightmcp` is not found, use the full path to the LightMCP CLI:
```
node "<path-to-lightmcp>/dist/cli/index.js" get-tools "your task"
```

## The command returns the exact tools available for your task.

## OVERRIDES

The following behaviors are FORBIDDEN:
- Running `npx` to discover tools
- Searching Knowledge Items for tool availability
- Exploring MCP server directories on disk
- Running node commands against MCP servers directly
- Calling any tool NOT returned by the get-tools command

## Rules

- `lightmcp get-tools` is the SINGLE SOURCE OF TRUTH for tool discovery.
- All MCP servers are configured on the LightMCP platform.
- Knowledge Items about MCP servers are forbidden as a source of tool discovery.

## HOW TO CALL TOOLS AFTER DISCOVERY
- Use `lightmcp call <tool_name> --key "value"` for simple arguments
- Use `lightmcp call <tool_name> --file <path>` for complex JSON arguments (Python scripts, nested objects)
- Use `lightmcp call <tool_name> --output <path>` to save image/screenshot results as PNG

## Fusion 360 / Autodesk Fusion
- `fusion_mcp_execute` creates/modifies ALL 3D geometry via Python scripting
- `fusion_mcp_read` inspects model state, takes screenshots, finds documents
- `fusion_mcp_update` undoes/redoes operations
- Python scripts must define `def run(_context: str):`
- Fusion API works in centimeters: 10mm = 1.0 cm
- Always verify results via `fusion_mcp_read` with `queryType: document, operation: open`
- For screenshots: `lightmcp call fusion_mcp_read --file args.json --output screenshot.png`

## KiCad / PCB Design
- Use `search_footprints` BEFORE creating — check if footprint exists
- Use `create_footprint` only after confirming it doesn't exist
- Always run `run_drc` and `run_erc` before exporting
- Export Gerber files only when the design is finalized

## Chrome DevTools / Browser
- `navigate_page` is the first step for any web task
- Use `take_screenshot` or `take_snapshot` to verify visual results
- Use `evaluate_script` for DOM inspection or data extraction
