<!-- LIGHTMCP_RULE_START -->

# MANDATORY: MCP Tool Discovery Protocol

## Before ANY task requiring tools, call the `get_task_tools` tool with a description of your task in natural language.

This tool returns the exact set of tools available for your specific task.

## OVERRIDES — FORBIDDEN:

- Calling MCP tools directly without first calling `get_task_tools`
- Running `npx` or `uvx` to discover or invoke tools
- Searching the filesystem or codebase for MCP server availability
- Calling any tool NOT returned by the latest `get_task_tools` invocation
- Using cached or previously returned tool lists across different tasks

## Rules

- `get_task_tools` is the SINGLE SOURCE OF TRUTH for tool discovery.
- All MCP servers are managed through the LightMCP platform.
- Re-call `get_task_tools` whenever the task changes significantly.

<!-- LIGHTMCP_RULE_END -->
