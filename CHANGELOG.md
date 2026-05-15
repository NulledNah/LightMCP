# Changelog

## [v0.3.5] - 2026-05-15

### Added
- **Dynamic domain keywords** (`src/ollama/keywords.ts`): keywords auto-generated from server keys, tool names, descriptions, and tips — zero hardcoded server names
- **Cross-server keyword deduplication**: words appearing in multiple servers are removed to improve pre-filter specificity
- **Multilingual translation** (`src/ollama/translator.ts`): non-English queries auto-translated via Ollama before keyword matching, with heuristic language detection (IT/ES/FR/DE/PT)
- **Shared version module** (`src/version.ts`): single source of truth for package version (was duplicated across 4 files)
- `lightmcp_servers.json` backup now excluded from catalog building — used only for uninstall restoration
- Server `_removed` flag in backup: explicitly deleted servers are skipped during uninstall

### Fixed
- `resolveMcpServers()` cascade restructured: inline servers no longer block auto-detection
- `mcpConfigPath` JSON array parsing: supports multi-path agent configs
- Word-boundary regex: `_` and `-` now treated as boundaries (fixes `fusion_mcp_execute` matching)
- Isolate mode: servers now added to `lightmcp_config.json` inline `mcpServers` so catalog builder can discover them
- `server remove` no longer leaks servers back into catalog via backup re-reading
- `antigravity_rule.md` template: hardcoded user path replaced with dynamic resolution during `setup`

### Removed
- Hardcoded `DOMAIN_KEYWORDS` map (5 servers) in `src/ollama/client.ts`
- Hardcoded `SERVER_DOMAINS` map (7 servers) in `src/prompts/tool_selector.ts`
- Hardcoded `knownServers` array (duplicated) in `src/cli/index.ts`
- Hardcoded version fallbacks (`"0.1.0"`) across 4 files
- Hardcoded bridge port fallback (now derived from config)
- Kicad-specific tool name examples in tip generation prompts
- `.env` API key and user paths verified never committed (`.gitignore` working correctly)

### Changed
- Tool selection prompt now instructs model to mentally translate non-English queries
- Server remove now marks as `_removed` in backup instead of deleting
- Server add clears `_removed` flag from backup
- 235 tests across 21 files (all passing)

---

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
