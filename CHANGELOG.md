# Changelog

## [v0.4.1] - 2026-05-20

### Added
- **Per-session McpServer isolation**: every HTTP client session gets its own `McpServer` instance, eliminating cross-client tool registration collisions. `SessionRegistry` with automatic GC frees idle sessions.
- **Linux systemd auto-start** (`scripts/setup.sh`): `lightmcp setup` now registers a systemd user service on Linux, running LightMCP in the background at login with `Restart=on-failure`.
- **Hidden Windows auto-start**: startup task now uses a VBS launcher with `wscript.exe` for truly invisible background startup (no PowerShell flash).
- **Dependency checks**: Node.js ≥ 20 warning at CLI startup; `curl` availability check on Linux before Ollama install.
- **No-truncation `lightmcp server list`**: dynamic column widths, adaptive box borders, content never cut off.
- **Agent rules for all IDEs**: `setup` and `configure` now install mandatory tool discovery rules for openCode (`~/.config/opencode/AGENTS.md`), Claude Code (`~/.claude/CLAUDE.md`), Cursor (`.cursor/rules/lightmcp.mdc` with `alwaysApply: true`), and Antigravity (`~/.gemini/GEMINI.md`). All rules use `<!-- LIGHTMCP_RULE -->` markers so `uninstall` removes only the LightMCP block, preserving other user rules.
- **Server deduplication**: `server list` and `build-catalog` skip servers sharing the same endpoint (URL or command+args).

### Fixed
- **`lightmcp build-catalog` hang**: added `process.exit(0)` and stream cleanup (`stdin.end()`, `stdout.destroy()`) to prevent child process handles from keeping the event loop alive.
- **`lightmcp server enable/disable/add/remove` hang**: `process.exit(0)` at end of all `server` subcommands.
- **Box-drawing alignment** in `server list`, `status`, and manual setup instructions — switched from hardcoded widths to dynamic width computation.
- **Progress display garbling** in `generate-tips` — each line now self-contained instead of relying on `process.stdout.write` leftovers.

### Changed
- **`handleGetTools` refactored** into `resolveToolSelection` + `registerSelectedTools`; new `handleGetToolsForSession()` accepts explicit `McpServer` + `RegisteredTool[]` parameters.
- **`MultiplexedHttpTransport` removed** — replaced by `SessionRegistry` with per-session `McpServer` + `StreamableHTTPServerTransport`.
- **Internal `buildCatalog()` calls** (from enable/disable/add/remove) now do proper stream cleanup on every exit path.

## [v0.4.0] - 2026-05-19

### Added
- **Native STDIO transport** (`lightmcp start --stdio`): uses `StdioServerTransport` from SDK, no external bridge needed
- **Server mode selector** (`--mode filtered|full`): `filtered` (default, LLM selects tools) or `full` (all tools exposed with namespacing)
- **Tool namespacing**: all tools exposed as `server_toolName` (e.g., `kicad_search_footprints`) to prevent collisions across servers
- **`alwaysOn` config**: tools always registered and visible, bypassing LLM filtering
- **`enableJsonResponse` mode**: clean JSON responses from Streamable HTTP transport, no ambiguous SSE
- **`src/server/transports.ts`**: unified HTTP/STDIO transport factory with shared middleware
- **`src/utils.ts`**: shared process utilities (`killProcess`, `killProcessGraceful`) extracted from duplicated code
- **Path validation**: `isValidConfigPath()` rejects non-JSON config paths (.dat, .db, .sqlite) and path traversal (`..`)
- **`qualifyToolName()`** helper in shared types

### Fixed
- **CRITICAL: server idle timeout always active** — `bumpActivity()` now called on every POST /mcp (was dead code)
- **CRITICAL: PATH stripped from spawned STDIO processes** — PATH/Path no longer filtered, only truly dangerous env vars blocked
- **CRITICAL: mcpConfigPaths double-encoding** — `isValidConfigPath()` filters garbage entries; corrupt entries cleaned on load
- **`opencode.global.dat`** no longer falsely detected as MCP config (was a SQLite database)
- **Duplicate server detection** (`autodesk-fusion`/`fusion360`) — config cleaned
- **Promise rejection in signal handlers** — `.catch(() => {})` added to prevent unhandled rejections
- **Per-tool error isolation** in dynamic registration — single tool failure no longer blocks subsequent registrations
- **`ensureModelPulled` error assumption** — now distinguishes ECONNREFUSED from other API errors
- **Atomic writes in scanner** — all agent config writes use `.tmp` + rename pattern

### Removed
- **Dual-mode dispatch** (stateless Antigravity path in `POST /mcp`) — all requests now go through SDK transport
- **`trackTool` / `untrackTool`** functions and `_toolList`/`_toolMeta` globals — SDK manages tool registry
- **Accept header injection hack** — no longer needed with proper SDK usage
- **`bridge.ts` auto-start** — reduced from 232 to 75 lines, pure STDIO→HTTP forwarder
- **`mcp_server.ts`** reduced from 343 to 163 lines

### Changed
- **Default model**: `qwen2.5-coder:7b-instruct` → `gemma3:4b` (matches README recommendation)
- **Log tag casing**: `[warn]` → `[WARN]` everywhere for consistency
- **`.gitignore`**: added `lightmcp_config.json` and `coverage/`
- **CI**: push triggers extended to `feature/**` and `fix/**` branches
- **Bridge.ts**: simplified to ~75 lines, no more CLI mode, no auto-start
- **openCode Desktop detectPaths**: uses `LOCALAPPDATA\Programs` instead of `APPDATA` data directory
- All 227 tests pass (21 files)

---

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
- 237 tests across 21 files (all passing)

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
