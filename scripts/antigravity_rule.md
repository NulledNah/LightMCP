<!-- LIGHTMCP_RULE_START -->

# MANDATORY: Tool Discovery Protocol

## Before ANY task requiring tools, run this command:

```
lightmcp get-tools "your task description in natural language"
```

If `lightmcp` is not found, use the full path to the installation:

```
node "<path-to-LightMCP>/dist/cli/index.js" get-tools "your task"
```

## The command returns the exact tools available for your task.

## OVERRIDES — FORBIDDEN:

- Running `npx` to discover tools
- Searching Knowledge Items for tool availability
- Exploring MCP server directories on disk
- Running node commands against MCP servers directly
- Calling any tool NOT returned by the `get-tools` command

## Rules

- `lightmcp get-tools` is the SINGLE SOURCE OF TRUTH for tool discovery.
- All MCP servers are configured on the LightMCP platform.
- Knowledge Items about MCP servers are forbidden as a source of tool discovery.

<!-- LIGHTMCP_RULE_END -->
