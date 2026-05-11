# LightMCP

> **A local LLM-powered semantic tool router for MCP** — bypass the Antigravity's 100-tool limit and reduce context window usage in any MCP-compatible AI agent.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![Ollama](https://img.shields.io/badge/Ollama-required-blue)](https://ollama.com)

---

## The Problem

MCP-compatible agents (like Antigravity) have a hard limit of **100 tools** across all connected servers. With tools like KiCad MCP (137 tools), Chrome DevTools, and Fusion360 active simultaneously, you instantly blow past the limit — and even within it, injecting every tool definition into every conversation wastes thousands of tokens.

## The Solution

LightMCP sits between your AI agent and your MCP servers. It exposes a **single tool** (`lightmcp_get_tools`) that the agent calls with a natural language task description. A local LLM (running via Ollama) reads the full catalog and returns **only the relevant tool definitions** for that task.

```
Agent → lightmcp_get_tools("create a KiCad footprint") → [create_footprint, get_footprint_info, ...]
```

- **Local model** — no data sent to external APIs
- **On-demand** — Ollama starts only when needed, shuts down after 2 minutes idle
- **Auto-updating catalog** — watches `mcp_config.json` and rebuilds on change
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

# 3. Run setup (installs Ollama, pulls model, builds catalog, registers startup)
node dist/cli/index.js setup
# or if globally installed:
lightmcp setup

# 4. Start
lightmcp start
```

Then add to your `mcp_config.json`:

```json
{
  "mcpServers": {
    "lightmcp": {
      "serverUrl": "http://127.0.0.1:3131/mcp"
    }
  }
}
```

---

## Architecture

```
┌──────────────────────────────────────┐
│   AI Agent (Antigravity / Claude)    │
│                                      │
│  Calls: lightmcp_get_tools(task)     │
└────────────────┬─────────────────────┘
                 │ MCP (HTTP)
                 ▼
┌──────────────────────────────────────┐
│   LightMCP Router  (localhost:3131)  │
│                                      │
│  1. Load tool catalog                │
│  2. Start Ollama (if idle)           │
│  3. qwen2.5-coder:7b selects tools   │
│  4. Validate & return MCP schemas    │
│  5. Reset 120s idle timer            │
└────────────────┬─────────────────────┘
                 │ Ollama REST
                 ▼
┌──────────────────────────────────────┐
│   Ollama (localhost:11434)           │
│   qwen2.5-coder:7b-instruct          │
│   → Starts on demand                 │
│   → Stops after 120s idle            │
└──────────────────────────────────────┘
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
| `lightmcp setup` | Full setup: Ollama + model + catalog + Windows startup |

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
    "model": "qwen2.5-coder:7b-instruct",
    "idleTimeoutSeconds": 120,
    "startupTimeoutSeconds": 30
  },
  "catalog": {
    "activeOnly": false,
    "watchMcpConfig": true
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `server.port` | `3131` | Port for the MCP HTTP server |
| `ollama.model` | `qwen2.5-coder:7b-instruct` | Ollama model for tool selection |
| `ollama.idleTimeoutSeconds` | `120` | Seconds before Ollama is shut down |
| `catalog.activeOnly` | `false` | Include tools from disabled servers |
| `catalog.watchMcpConfig` | `true` | Auto-rebuild catalog on config changes |
| `mcpConfigPath` | auto | Override path to `mcp_config.json` |

---

## How to Use in Antigravity

Once running, your agent can call `lightmcp_get_tools` before any task:

```
User: Create a KiCad footprint for a JST-SH connector

Agent: [calls lightmcp_get_tools with task="create a KiCad footprint for a JST-SH connector"]
LightMCP: returns [create_footprint, list_footprint_libraries, get_footprint_info]
Agent: [uses only those 3 tools]
```

The response includes full MCP-compatible tool schemas with input validation, so the agent can use them immediately.

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
