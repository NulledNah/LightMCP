# LightMCP Development Guide

## Project Structure

```
LightMCP/
├── src/
│   ├── cli/            # CLI entry point (Commander-based)
│   ├── catalog/        # Tool catalog builder/loader/watcher
│   ├── ollama/         # Ollama process manager & REST client
│   ├── prompts/        # LLM prompt templates
│   ├── server/         # MCP router server, proxy, bridge
│   ├── setup/          # Agent scanner & configurator
│   ├── config.ts       # Config loader (Zod-validated)
│   └── types.ts        # Shared TypeScript types
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

## Mock Conventions

- Use `vi.mock('module-path')` at the top of test files
- For CommonJS/CJS-like modules (e.g., `node:fs`, `node:child_process`), mock with `vi.mock('node:fs', () => ({}))`
- For ESM modules, use dynamic `import()` after mocking
- Use `vi.hoisted()` for mock factories that need to be available before module imports
- Mock `@modelcontextprotocol/sdk/client/index.js` with a constructable function via `vi.hoisted()`

## Known Test Gaps

- **e2e tests**: Cover full server startup, real Ollama communication, MCP protocol handshake
- **Server idle timeout**: Hard to unit test due to `setInterval` — best tested manually or in e2e
- **Windows-specific paths**: Some path-heavy tests may fail on non-Windows CI
- **STDIO bridge**: Complex to test in unit; relies on `node:readline`

## Branch Strategy

- `main`: stable, all tests must pass
- Feature branches: `feature/<description>`
- Bug fix branches: `fix/<description>`

## Coverage Overview

- `src/server/handlers.ts`: Registration lock, tool selection pipeline
- `src/server/proxy.ts`: Connection pooling, call forwarding
- `src/cli/index.ts`: CLI commands (start, status, test, call, setup, configure)
- `src/setup/scanner.ts`: Agent detection and MCP configuration
- `src/ollama/client.ts`: Ollama REST API, domain pre-filtering
- `src/ollama/manager.ts`: Ollama lifecycle, idle timeout

## CI / Cross-platform

- GitHub Actions: Ubuntu (`ubuntu-latest`) + Windows (`windows-latest`)
- Both run `npm test` (237 unit + integration tests) at every push/PR to main
- All tests mock I/O and child processes — they pass identically on both platforms

## Roadmap

| Version | Goal |
|---------|------|
| v0.3.0 | 223 tests, CI (Ubuntu + Windows), race condition fixes, word-boundary filter fix, multi-agent watcher, server manager (add/remove/list/disable/enable), uninstall, standalone Linux/WSL2 |
| v0.3.5 | 237 tests, dynamic domain keywords (zero hardcoded servers), multilingual translator (IT/ES/FR/DE/PT), cross-server keyword dedup, isolate mode inline config, `_removed` backup flag, security audit fixes (registration lock, path traversal, env injection, TOCTOU), openCode scanner paths per official docs |
| **v0.4.0** | **Planned:** |
| | -- **openCode/standard client compatibility** — Refactor `initialize` handler to support SDK-native Streamable HTTP sessions alongside stateless Antigravity handlers |
| | -- **Full Linux compatibility** — unattended `setup` without `winget` (Ollama detection + install via package manager) |
| | -- **Claude Code + Cursor testing** — Verify and document MCP config integration for remaining agents |
| | -- **`mcpConfigPath` root fix** — Fix double-encoding in `autoPopulateConfig` at source (currently workaround in `resolveMcpServers`) |
| | -- **Pre-filter v2** — Improve multilingual keyword matching (currently EN keywords matched against translated query; could match original + translated) |
| | -- **Security hardening** — Express rate limiting, CORS policy, prompt injection guard |

## Known Limitations

| Issue | Impact | Resolution |
|-------|--------|------------|
| openCode Desktop/CLI connection failure | Cannot use LightMCP with openCode | Planned v0.4.0 refactor of `initialize` handler |
| `autoPopulateConfig` double-encodes `mcpConfigPath` | Config file contains escaped JSON path strings | Workaround in `resolveMcpServers()` parses JSON; root fix planned v0.4.0 |
| Pre-filter keyword matching is EN-only | Translated queries may not match domain keywords | Translator mitigates this; v2 matching planned |
| Server idle timeout hard to unit test | Uses `setInterval` | Tested manually; e2e tests would cover this |
