# LightMCP Development Guide

## Project Structure

```
LightMCP/
├── src/
│   ├── cli/            # CLI entry point (Commander-based)
│   ├── catalog/        # Tool catalog builder/loader/watcher
│   ├── ollama/         # Ollama process manager & REST client
│   ├── prompts/        # LLM prompt templates
│   ├── server/         # MCP server, transports, proxy, bridge, handlers
│   ├── setup/          # Agent scanner & configurator
│   ├── config.ts       # Config loader (Zod-validated)
│   ├── types.ts        # Shared TypeScript types
│   └── utils.ts        # Shared process utilities (killProcess, etc.)
├── tests/
│   ├── unit/           # Unit tests (fast, no network/processes)
│   ├── integration/    # Integration tests (mock child_process heavily)
│   └── e2e/            # End-to-end tests
├── scripts/            # Helper scripts (setup, etc.)
└── vitest.config.ts
```

## Test Commands

```bash
npm test              # Run all tests (vitest run)
npx vitest run --reporter verbose  # Run with verbose output
npx vitest tests/unit/clean_tip.test.ts  # Run a single test file
```

## Architecture (v0.4.0)

### Server Design

Single `McpServer` instance, single transport. One mode at a time:

| Mode | Command | Transport | Use case |
|------|---------|-----------|----------|
| HTTP | `lightmcp start` | `StreamableHTTPServerTransport` on `:3131/mcp` | openCode, Cursor, Claude Code (HTTP) |
| STDIO | `lightmcp start --stdio` | `StdioServerTransport` | Claude Desktop, agents spawning processes |

### Operating Modes

| Mode | Flag | Behavior |
|------|------|----------|
| **Filtered** (default) | `--mode filtered` | Agent sees only `get_task_tools` + `alwaysOn`. LLM selects relevant tools dynamically. `sendToolListChanged()` notifies agent. |
| **Full** | `--mode full` | All tools from all servers exposed with namespacing (`server_toolName`). No LLM filtering. Maximum MCP compatibility. |

### Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `src/server/mcp_server.ts` | McpServer factory, permanent + dynamic registration | 163 |
| `src/server/transports.ts` | HTTP/STDIO transport factory, middleware (CORS, rate limit, activity tracking) | 156 |
| `src/server/handlers.ts` | `get_task_tools` handler, LLM selection, dynamic registration with per-tool error isolation | 182 |
| `src/server/proxy.ts` | Downstream connection pool, call forwarding | 138 |
| `src/server/bridge.ts` | Thin STDIO→HTTP forwarder for Antigravity (75 lines, no auto-start) | 77 |
| `src/utils.ts` | Shared process utilities (`killProcess`, `killProcessGraceful`) | 27 |

### Transport Flow (HTTP mode)

```
POST /mcp + body → express.json → rateLimiter → activity tracker
  → StreamableHTTPServerTransport.handleRequest(req, res, body)
  → SDK routes to McpServer handlers
    → get_task_tools → LLM selection → dynamic registerTool → sendToolListChanged()
    → other tools → proxy.callTool(serverKey, toolName, args) → downstream
```

## Mock Conventions

- Use `vi.mock('module-path')` at the top of test files
- For CommonJS/CJS-like modules (e.g., `node:fs`, `node:child_process`), mock with `vi.mock('node:fs', () => ({}))`
- For ESM modules, use dynamic `import()` after mocking
- Use `vi.hoisted()` for mock factories that need to be available before module imports
- Mock `@modelcontextprotocol/sdk/client/index.js` with a constructable function via `vi.hoisted()`
- For server tests using `createMcpServer('http')`, call `getApp()` to obtain the Express app for supertest

## Known Test Gaps

- **STDIO transport**: Tests use mocked `StdioServerTransport`; real stdin/stdout handling tested manually
- **Server idle timeout**: Hard to unit test due to `setInterval` — tested manually or in e2e
- **Windows-specific paths**: Some path-heavy tests may fail on non-Windows CI

## Branch Strategy

- `main`: stable, all tests must pass
- Feature branches: `feature/<description>`
- Bug fix branches: `fix/<description>`

## Coverage Overview

- `src/server/mcp_server.ts`: McpServer creation, tool registration, mode selection
- `src/server/transports.ts`: HTTP/STDIO transport factories, middleware stack
- `src/server/handlers.ts`: Registration lock, LLM tool selection pipeline, namespacing
- `src/server/proxy.ts`: Connection pooling, call forwarding, env filtering
- `src/cli/index.ts`: CLI commands (start, status, test, call, setup, configure)
- `src/setup/scanner.ts`: Agent detection and MCP configuration
- `src/ollama/client.ts`: Ollama REST API, domain pre-filtering, retry logic
- `src/ollama/manager.ts`: Ollama lifecycle, idle timeout
- `src/config.ts`: Config loading, validation, path resolution, auto-population

## CI / Cross-platform

- GitHub Actions: Ubuntu (`ubuntu-latest`) + Windows (`windows-latest`)
- Triggers: push to `main`, `feature/**`, `fix/**`; PR to `main`
- Both run `npm test` (227 unit + integration tests)
- All tests mock I/O and child processes — they pass identically on both platforms

## Roadmap

| Version | Goal |
|---------|------|
| v0.3.0 | 223 tests, CI (Ubuntu + Windows), race condition fixes, word-boundary filter fix, multi-agent watcher, server manager, uninstall |
| v0.3.5 | 237 tests, dynamic domain keywords, multilingual translator, isolate mode inline config, security audit fixes |
| **v0.4.0** | **Released:** |
| | -- SDK-native transport (Streamable HTTP + STDIO), no dual-mode dispatch |
| | -- Tool namespacing (`server_toolName`) |
| | -- `--mode filtered|full` + `alwaysOn` config |
| | -- `mcpConfigPaths` double-encoding fixed at source |
| | -- `opencode.global.dat` no longer falsely detected |
| | -- `killProcess` extracted to `src/utils.ts` |
| | -- Log tag casing standardized (`[WARN]`) |
| | -- Atomic writes in scanner |
| | -- All 5 agents working (Antigravity, Claude Code, Cursor, openCode CLI/Desktop) |
| | **v0.4.1+ (Planned):** |
| | -- Pre-filter v2: match keywords against original + translated query |
| | -- Full Linux unattended setup without winget |
| | -- Security hardening: Express rate limiting improvements, prompt injection guard v2 |
| | -- Response caching for deterministic tool calls |

## Known Limitations

| Issue | Impact | Resolution |
|-------|--------|------------|
| Pre-filter keyword matching is EN-only | Translated queries may not match domain keywords | Translator mitigates this; v2 matching planned |
| Server idle timeout hard to unit test | Uses `setInterval` | Tested manually; e2e tests would cover this |
| `shell: true` on Windows spawn | Potential for command injection from admin-configured commands | Commands come from `lightmcp_config.json` (admin-controlled); mitigated by env filtering |
| Single transport per instance | Cannot run HTTP + STDIO simultaneously | Design choice; run two instances if needed |
