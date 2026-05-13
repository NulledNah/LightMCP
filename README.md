# LightMCP

> **A local LLM-powered semantic tool router for MCP** — bypass the Antigravity's 100-tool limit and reduce context window usage in any MCP-compatible AI agent.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![Ollama](https://img.shields.io/badge/Ollama-required-blue)](https://ollama.com)

---

## The Problem

MCP-compatible agents (like Antigravity) have a hard limit of **100 tools** across all connected servers. With tools like KiCad MCP (137 tools), Chrome DevTools, and Fusion360 active simultaneously, you instantly blow past the limit — and even within it, injecting every tool definition into every conversation wastes thousands of tokens.

## The Solution

LightMCP sits between your AI agent and your MCP servers. It exposes a **single tool** (`get_task_tools`) that the agent calls with a natural language task description. A local LLM (running via Ollama) reads the full catalog and returns **only the relevant tools** for that task. The selected tools are then **dynamically registered** on LightMCP so the agent can call them — LightMCP transparently forwards each call to the real downstream MCP server.

```
Agent → lightmcp_get_tools("create a KiCad footprint") → [create_footprint, ...]
Agent → tools/list → [create_footprint, get_footprint_info, ...]  (dynamically registered)
Agent → tools/call("create_footprint", {...}) → LightMCP → KiCad MCP → result
```

- **Fully local** — no data sent to external APIs
- **On-demand** — Ollama starts only when needed, shuts down after 2 minutes idle
- **Auto-updating catalog** — watches `mcp_config.json` and rebuilds on change
- **Transparent proxy** — agent calls tools through LightMCP as if they were its own
- **Windows auto-start** — registers via Task Scheduler

---

## Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| GPU VRAM  | 6 GB    | 8 GB (RTX 3070 Ti) |
| RAM       | 12 GB   | 16 GB |
| CPU       | Any modern | Intel i5-11600K or better |
| Disk      | 6 GB free | 10 GB free |

The default model (`qwen2.5-coder:7b-instruct` Q4_K_M) uses ~4.5 GB VRAM.

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/NulledNah/LightMCP.git
cd LightMCP
npm install

# 2. Build
npm run build

# 3. Run setup (installs Ollama, pulls model, builds catalog, generates tips, configures agents, registers startup)
node dist/cli/index.js setup
# or if globally installed:
lightmcp setup

# 4. Start
lightmcp start
```

`lightmcp setup` now handles everything automatically:
1. Installs Ollama (if missing)
2. Pulls the configured model
3. Builds the tool catalog from all downstream MCP servers
4. Generates procedural usage tips for every tool via the local LLM
5. Scans for AI agents and lets you choose which to configure
6. Installs the Antigravity global rule (`~/.gemini/GEMINI.md`)
7. Registers Windows startup via Task Scheduler

### Manual steps (if needed)

If you skipped agent configuration during setup, add LightMCP to your agent's `mcp_config.json` (e.g. Antigravity's `%USERPROFILE%\.gemini\antigravity\mcp_config.json`):

```json
{
  "mcpServers": {
    "lightmcp": {
      "serverUrl": "http://127.0.0.1:3131/mcp"
    }
  }
}
```

**Important:** Only LightMCP goes in the agent's config. All other MCP servers (KiCad, Chrome DevTools, etc.) are configured in the file pointed to by `mcpConfigPath` in `lightmcp_config.json` (default: auto-detected from the standard Antigravity path). LightMCP reads that file to build its internal tool catalog.

### Generate tips (optional, already done by setup)

```bash
# Generate procedural usage tips for all tools
lightmcp generate-tips

# Or for a specific server
lightmcp generate-tips --server autodesk-fusion

# Rebuild catalog to inject tips
lightmcp build-catalog
```

---

## Architecture

```mermaid
sequenceDiagram
    participant A as AI Agent
    participant L as LightMCP
    participant O as Ollama
    participant D as Downstream MCP

    A->>L: tools/list
    L-->>A: [lightmcp_get_tools]

    A->>L: tools/call("lightmcp_get_tools", task)
    L->>O: Select relevant tools
    O-->>L: [create_footprint, list_libraries]
    L-->>A: Selected tools summary

    Note over L: Dynamically registers<br/>selected tools

    L-->>A: notifications/tools/list_changed
    A->>L: tools/list
    L-->>A: [create_footprint, list_libraries]

    A->>L: tools/call("create_footprint", args)
    L->>D: Forward call
    D-->>L: Result
    L-->>A: Result
```

```mermaid
flowchart TB
    subgraph Agent["AI Agent"]
        direction TB
        A1["Only LightMCP in config"]
        A2["Calls tools through LightMCP"]
    end

    subgraph LightMCP["LightMCP (localhost:3131)"]
        direction TB
        L1["lightmcp_get_tools<br/>Ollama semantic selection"]
        L2["Dynamic tool registration<br/>on McpServer singleton"]
        L3["Proxy pool<br/>forward tools/call"]
        L4["Tool catalog<br/>auto-built from all servers"]
    end

    subgraph Ollama["Ollama (localhost:11434)"]
        O1["qwen2.5-coder:7b-instruct"]
        O2["Starts on demand<br/>Idle timeout: 120s"]
    end

    subgraph Downstream["Downstream MCP Servers"]
        D1["KiCad MCP (stdio)"]
        D2["Chrome DevTools (HTTP)"]
        D3["Fusion360 (HTTP)"]
        D4["..."]
    end

    Agent <-->|"MCP Streamable HTTP"| LightMCP
    LightMCP -->|"REST API"| Ollama
    LightMCP <-->|"MCP client"| Downstream
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `lightmcp start` | Start the MCP router server |
| `lightmcp build-catalog` | Rebuild tool catalog from all MCP servers |
| `lightmcp build-catalog --active-only` | Only include tools from enabled servers |
| `lightmcp status` | Show status of server, Ollama, and catalog |
| `lightmcp test "<task>"` | Test tool routing locally |
| `lightmcp get-tools "<task>"` | Discover relevant tools for a task via semantic LLM selection |
| `lightmcp call <tool> [args...]` | Call a tool through LightMCP (forwards to downstream MCP server) |
| `lightmcp call <tool> --file <path>` | Call a tool with arguments from a JSON file (bypasses shell quoting) |
| `lightmcp call <tool> --output <path>` | Auto-decode base64 image results to a file |
| `lightmcp generate-tips` | Generate procedural usage tips for each tool via local LLM |
| `lightmcp generate-tips --server <key>` | Generate tips for a specific server only |
| `lightmcp setup` | Full setup: Ollama + model + catalog + agent config + Windows startup |
| `lightmcp configure` | Re-run AI agent MCP configuration (scan, isolate/add/manual) |

---

## Configuration

Edit `lightmcp_config.json` in the project root:

```json
{
  "server": {
    "port": 3131,
    "host": "127.0.0.1"
  },
  "ollama": {
    "host": "http://127.0.0.1:11434",
    "model": "qwen2.5-coder:7b-instruct",
    "idleTimeoutSeconds": 120,
    "startupTimeoutSeconds": 30,
    "maxRetries": 2
  },
  "catalog": {
    "activeOnly": false,
    "outputPath": "tool_catalog.json",
    "watchMcpConfig": true
  },
  "mcpConfigPath": null
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `server.port` | `3131` | Port for the MCP HTTP server |
| `server.host` | `127.0.0.1` | Host to bind the server |
| `ollama.host` | `http://127.0.0.1:11434` | Ollama API URL |
| `ollama.model` | `qwen2.5-coder:7b-instruct` | Ollama model for tool selection |
| `ollama.idleTimeoutSeconds` | `120` | Seconds before Ollama is shut down |
| `ollama.startupTimeoutSeconds` | `30` | Max seconds to wait for Ollama to start |
| `ollama.maxRetries` | `2` | Retries on Ollama inference failure |
| `catalog.activeOnly` | `false` | Only include tools from enabled servers |
| `catalog.outputPath` | `tool_catalog.json` | Where to persist the tool catalog |
| `catalog.watchMcpConfig` | `true` | Auto-rebuild catalog on config changes |
| `mcpConfigPath` | auto | Override path to the MCP config listing all servers |

---

## Agent Configuration

During `lightmcp setup`, LightMCP scans your system for compatible AI agents (Antigravity, Claude Code, openCode, Cursor) and offers 3 configuration modes:

| Mode | Behavior |
|------|----------|
| **Isolate** (Recommended) | Saves the full server list to `lightmcp_servers.json`, then rewrites the agent's config with only LightMCP. LightMCP reads the full list via `mcpConfigPath`. Best for minimizing context usage. |
| **Add** | Leaves existing MCP servers untouched, adds LightMCP alongside them. |
| **Manual** | No changes — prints the exact JSON snippet and config path for each detected agent. |

You can re-run configuration anytime with `lightmcp configure`.

Detected agents and their MCP config paths:

| Agent | Config Path |
|-------|------------|
| Antigravity | `~/.gemini/antigravity/mcp_config.json` |
| Claude Code | `~/.claude.json` |
| openCode CLI | `~/.opencode.json` |
| Cursor | `~/.cursor/mcp.json` |

---

## How to Use

Once running, your agent connects only to LightMCP. Here's a real tested flow from v0.2.0:

```
1. Agent calls get_task_tools("generate a 10mm cube in Autodesk Fusion")
2. Domain-aware pre-filter: 173 tools → 3 Fusion tools
3. Ollama selects: fusion_mcp_execute, fusion_mcp_read
4. LightMCP dynamically registers these 2 tools on its MCP server
5. Agent writes Python script → creates args.json with --file flag
6. Agent calls fusion_mcp_execute --file args.json → cube created
7. Agent calls fusion_mcp_read --file read_args.json --output screenshot.png → visual verify
```

More examples:
```
lightmcp get-tools "create a KiCad footprint for a JST-SH connector"
lightmcp call search_footprints --search_term "JST-SH"
lightmcp call create_footprint --name "JST-SH" --library "Connectors"

lightmcp get-tools "debug performance of my landing page"
lightmcp call navigate_page --url "https://mysite.com"
lightmcp call performance_start_trace --reload true
lightmcp take_screenshot --output landing.png
```

The agent never sees the 137 KiCad tools — only the relevant ones per task. All tool execution happens on the real downstream servers; LightMCP only routes.

---

## Windows Startup Registration

`lightmcp setup` registers a Task Scheduler entry that starts LightMCP at every user login. To manage it manually:

```powershell
# Register (requires admin)
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -RegisterTask

# Remove
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -UnregisterTask
```

---

## What's New in v0.2.0

### Semantic Tool Selection Upgrades
- **Procedural tool tips** — `tool_tips.json` provides LLM-generated usage hints for each tool (when/why to use it, not just what it does). Generate via `lightmcp generate-tips`.
- **Domain-aware pre-filtering** — scans the task for domain keywords (Fusion, PCB, browser, etc.) and sends only relevant server tools to Ollama, eliminating cross-domain noise.
- **Structured reasoning framework** — system prompt guides the model through Task Analysis → Capability Mapping → Tool Selection.
- **Server-grouped catalog with domain labels** — tools presented to the LLM as `=== autodesk-fusion [3D CAD / Fusion 360] ===` with parameter hints and tips.

### CLI & Reliability
- **`get-tools` command** — one-line tool discovery: `lightmcp get-tools "create a 10mm cube in Fusion"`
- **`call` command with `--file`** — bypass PowerShell quoting hell by reading JSON arguments from a file: `lightmcp call fusion_mcp_execute --file args.json`
- **`call --output <path>`** — auto-decode base64 image results (screenshots, renders) to PNG files
- **`generate-tips` command** — per-tool LLM calls with zero cross-contamination, kept alive via `keepOllamaAlive()`
- **Timeout increased** — `get-tools` CLI timeout 5s → 30s for reliable cold-start responses
- Token budget: 512 → 1024, + `top_k` / `top_p` for inference quality
- Tool descriptions: 100 → 250 chars with word-boundary truncation

### Tested Use Cases
| # | Scenario | Comando | Risultato |
|---|----------|---------|-----------|
| 1 | **Fusion 360: cubo 10mm** | `lightmcp get-tools "generate a 10mm cube in Autodesk Fusion"` → seleziona `fusion_mcp_execute`. Script Python eseguito con `lightmcp call fusion_mcp_execute --file args.json`. | Cubo creato. Verificato con `lightmcp call fusion_mcp_read --queryType "document" --operation "open"` → 1 corpo solido nel documento attivo. |
| 2 | **Fusion 360: modello da disegno tecnico** | `lightmcp get-tools` su [TootallToby practice](https://tootalltoby.com/practice/b241362f-3964-4e43-9b31-057eeaa34147). `fusion_mcp_execute` selezionato, script generato dalle dimensioni del disegno. | Modello 3D creato correttamente fino a difficoltà Tier 2. Dimensioni verificate. |
| 3 | **KiCad: ricerca footprint** | `lightmcp get-tools "search for a JST-SH footprint"` → seleziona `search_footprints` + `get_footprint_info`. | Footprint trovato e parametri verificati. |

---

## Antigravity Global Rule

`lightmcp setup` automatically installs a global rule at `~/.gemini/GEMINI.md` that teaches Antigravity how to use LightMCP:

- Always call `get_task_tools` before any task
- Use `--file` for complex JSON arguments
- Domain-specific guidance for Fusion 360, KiCad, and Chrome DevTools

To install manually:
```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.gemini"
Copy-Item scripts\antigravity_rule.md "$env:USERPROFILE\.gemini\GEMINI.md"
```

If `~/.gemini/GEMINI.md` already exists, the template is prepended to preserve your existing rules.

---

## FAQ

**Q: Will the local model send my data anywhere?**  
A: No. Ollama runs entirely locally. No data leaves your machine.

**Q: What if Ollama selects wrong tools?**  
A: LightMCP validates all selected names against the catalog — hallucinated tool names are silently dropped. You can always fall back to manual catalog browsing.

**Q: Can I use a different model?**  
A: Yes — change `ollama.model` in `lightmcp_config.json`. Any Ollama model with reliable JSON output works. `qwen2.5-coder:7b-instruct` is the tested default.

**Q: How long does tool selection take?**  
A: First call: ~3–5s (Ollama startup) + ~1–2s inference. Subsequent calls (while Ollama is warm): ~1–2s.

---

## License

MIT © 2025
