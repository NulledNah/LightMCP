# Changelog

## [v0.3.0] - 2026-05-14

### Added
- 223 unit + integration tests across 20 files (up from 102)
- CI pipeline: Ubuntu + Windows runners, TypeScript check, lint, test
- `resolveMcpServers()`: cascading server resolution (env var → inline config → agent detection)
- `mcpServers` inline field in `lightmcp_config.json` for standalone mode
- `$LIGHTMCP_MCP_CONFIG` environment variable override
- Linux/WSL2 compatibility documentation in README
- Word-boundary matching in `filterCatalogByTask` (was substring includes)
- Agent auto-detection as fallback for MCP server discovery
- Development guide in `AGENTS.md` (test architecture, mock conventions, known gaps)

### Fixed
- Race condition in `handleGetTools` (added registration lock)
- Race condition in `proxy.ts` connection pool (added `_connectPromises` dedup map)
- False-positive domain matching: "kicad"→"cad", "analyze"→thinking, "google"→knowledge
- `startCatalogWatcher` no longer crashes on Linux when no agent config found
- `buildCatalog` no longer crashes with ENOENT on machines without Antigravity

### Changed
- `mcpConfigPath` is now optional — server discovery uses cascading resolution
- CLI commands `start`, `status`, `test`, and `call` shared between named commands and default action
- Watcher skips gracefully with a log message when no config file to watch

---

## [v0.2.0] - 2025-03-23

### Added
- Semantic tool selection via local Ollama LLM (`qwen2.5-coder:7b-instruct`)
- Domain keyword pre-filtering to reduce prompt size
- `get_task_tools` handler with dynamic tool registration
- MCP router server (Express + `@modelcontextprotocol/sdk`)
- STDIO bridge for Antigravity agent
- Agent scanner: Antigravity, Claude Code, openCode CLI/Desktop, Cursor
- `lightmcp setup` command (Ollama install, model pull, agent config, Windows startup)
- CLI commands: `start`, `build-catalog`, `status`, `test`, `call`, `get-tools`, `configure`, `generate-tips`
- File watcher with debounce for `mcp_config.json` changes
- Tool tips auto-generation via local LLM
- Full-flow integration test via supertest
