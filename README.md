# LightMCP

> **A local LLM-powered semantic tool router for MCP** -- keeps context windows lean by exposing only the tools relevant to each task.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![Ollama](https://img.shields.io/badge/Ollama-required-blue)](https://ollama.com)
[![Version](https://img.shields.io/badge/version-0.4.1-orange)](https://github.com/NulledNah/LightMCP/releases)

---

## The Problem

MCP-compatible AI agents enforce strict limits on the number of usable tools to prevent context window overload. With servers like KiCad MCP (137 tools), Chrome DevTools, and Fusion 360 active simultaneously, the limit is exceeded immediately — and even within it, injecting every tool definition into every conversation wastes thousands of tokens.

## The Solution

LightMCP sits between your AI agent and your MCP servers. It exposes a **single tool** (`get_task_tools`) that the agent calls with a natural language task description. A local LLM (via Ollama) reads the full catalog and returns **only the relevant tools** for that task. The selected tools are dynamically registered and calls are forwarded transparently to the real downstream servers.

- **Fully local** — no data sent to external APIs
- **On-demand** — Ollama starts only when needed, shuts down after idle timeout
- **Auto-updating catalog** — watches MCP config files and rebuilds on change
- **Transparent proxy** — agent calls tools through LightMCP as if they were its own
- **Multilingual** — auto-detects non-English queries and translates before tool matching
- **Server management** — add, remove, disable, enable MCP servers from the CLI
- **Clean uninstall** — restores all original agent configurations from backup
- **Cross-platform** — Windows and Linux with unattended `setup`
- **Hardened** — rate limiting, CORS, prompt injection guard, path traversal protection

---

## Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| GPU VRAM  | 4 GB    | 6 GB |
| RAM       | 8 GB    | 16 GB |
| Disk      | 4 GB free | 8 GB free |

The default model (`gemma3:4b`) uses approximately 2.5 GB VRAM.

---

## Quick Start

```bash
git clone https://github.com/NulledNah/LightMCP.git
cd LightMCP
npm install && npm run build

# Full automated setup (Ollama, model, catalog, agent config, auto-start)
node dist/cli/index.js setup

# Start the router
lightmcp start
```

`lightmcp setup` handles everything: installs Ollama, pulls the model, builds the tool catalog, generates usage tips, configures your AI agents, installs mandatory tool discovery rules, and registers auto-start (Task Scheduler on Windows, systemd on Linux).

---

## Client Compatibility

| AI Agent | Status | Transport | Config Path |
|----------|--------|-----------|-------------|
| **Antigravity** (VS Code) | Working | STDIO bridge | `~/.gemini/config/mcp_config.json` (2.0) |
| **Claude Code** | Working | HTTP `type: "http"` | `~/.claude.json` |
| **Cursor** | Working | HTTP `url` | `~/.cursor/mcp.json` |
| **openCode CLI** | Working | `type: "remote"` | `~/.config/opencode/opencode.json` |
| **openCode Desktop** | Working | `type: "remote"` | Same as openCode CLI |

---

## Basic Configuration

Edit `lightmcp_config.json` in the project root:

```json
{
  "server": {
    "port": 3131,
    "mode": "filtered"
  },
  "ollama": {
    "model": "gemma3:4b"
  },
  "mcpServers": {
    "kicad": {
      "command": "node",
      "args": ["/path/to/KiCAD-MCP-Server/dist/index.js"]
    }
  }
}
```

Key settings:
- `server.mode`: `"filtered"` (LLM selects tools, default) or `"full"` (all tools exposed)
- `ollama.model`: change to any Ollama model with structured JSON output
- `mcpServers`: define your downstream MCP servers inline (the recommended approach)

For a complete reference of all configuration options, see [docs/REFERENCE.md](docs/REFERENCE.md).

---

## Basic Usage

```
lightmcp get-tools "create a KiCad footprint for a JST-SH connector"
lightmcp call kicad_search_footprints --search_term "JST-SH"

lightmcp get-tools "debug performance of my landing page"
lightmcp call chrome-devtools_navigate_page --url "https://mysite.com"
lightmcp call chrome-devtools_take_screenshot --output landing.png

lightmcp server list
lightmcp server disable kicad
lightmcp server enable kicad
```

Your agent never sees the full tool list -- only the relevant ones per task. All execution happens on the real downstream servers; LightMCP only routes.

---

## Documentation

For comprehensive details, see [docs/REFERENCE.md](docs/REFERENCE.md):

- Full architecture with Mermaid diagrams
- Complete CLI command reference
- All configuration options and server resolution cascade
- Agent configuration modes (Isolate / Add / Manual)
- Agent rules and manual agent setup
- Linux / WSL2 setup
- FAQ

---

## License

MIT (c) 2026
