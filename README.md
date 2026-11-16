# Royal Hold'em AI Arena (`llm-texas-holdem`)

English | [简体中文](./README.zh-CN.md)

A zero-dependency Node.js web arena for **1 Human + Multi-LLM & Multi-CLI-Agent No-Limit Texas Hold'em**, featuring a Las Vegas-style concurrent multi-table lobby, dual OpenAI & Anthropic protocols, verifiable CSPRNG deck shuffling, an AI Thinking Inspector, and full SQLite persistence.

## Core Capabilities

### 1. Dual Protocols & ModelHub Integration

- **OpenAI & Anthropic Protocols**: Every AI seat can be routed through either the **OpenAI protocol** (`POST /v1/chat/completions`, `Authorization: Bearer`) or the **Anthropic protocol** (`POST /v1/messages`, `x-api-key` + `anthropic-version: 2023-06-01`).
- **Local ModelHub & Custom Endpoints**: Integrates automatically with a local [**ModelHub**](https://github.com/xdlkc/loom) gateway (`http://127.0.0.1:4319`) and local credential files, with automatic failover when an upstream route returns permission/rate errors. Any seat can also be configured in the UI with a custom `Base URL`, `API Key`, and `Model ID`.

### 2. Five Model Vendor Drivers & Five CLI Agent Drivers

- **5 Model Vendors (`VENDOR_CATALOG`, 21 pre-seeded models)**:
  - `deepseek` (`deepseek-flash`, `deepseek-v4-pro`, `deepseek-chat`, `deepseek-reasoner`)
  - `zhipu-token-plan` (`glm-5.3-flash`, `glm-5.3`, `glm-5.3-flashx`)
  - `kimi` (`k3.1-pro-highspeed`, `k3.1-pro`)
  - `gpt` (`openai/gpt-5.4-mini`, `openai/gpt-6-astra`, `openai/gpt-6.1-sol`, `openai/gpt-5.4`, `gpt-4o`)
  - `zenmux` (`anthropic/claude-haiku-5.5`, `anthropic/claude-sonnet-5.5`, `anthropic/claude-opus-5.5`, `openai/gpt-6-astra`, `google/gemini-3.8-flash`, `deepseek/deepseek-v4.1-flash`, `moonshotai/kimi-k3.1-pro`)
- **5 CLI Agents (`AGENT_CATALOG`)**:
  - `codex` (OpenAI Codex CLI, `~/.local/bin/codex`)
  - `gemini` (Gemini / Antigravity CLI, `~/.local/bin/agy`)
  - `claude-code` (Anthropic Claude Code CLI, `~/.local/bin/claude`)
  - `pi` (Pi Coding Agent CLI, `~/.local/bin/pi`)
  - `opencode2` (OpenCode v2 CLI, `~/.local/bin/opencode2`)
- **Configurable Thinking Effort**: Every AI seat supports 4 reasoning tiers (`low`, `medium`, `high`, `max`), mapped to protocol `max_tokens` (`1024`–`4096`) or agent reasoning flags.

### 3. Multi-Table Casino Lobby & Verifiable CSPRNG Shoes

- **10 Pre-Seeded Tables + Custom Tables**: Opens into a game-hall overview covering human-vs-AI tables, 5-vendor clashes, 5-agent sandboxes, high-roller deep-stack rooms, heads-up duels, fast blitz 6-max, OpenAI-vs-Anthropic protocol matches, a 9-max full ring, and open custom tables (plus 5 quick lineup presets).
- **Concurrent Background Casino**: When enabled, background spectator tables run concurrently in round-robin waves (up to `MAX_CONCURRENT_LLM_TABLES = 3` in-flight LLM/agent requests), with instant per-table pause/resume and one-click stop-all controls.
- **3-Pass CSPRNG Shuffle & Commitments**: Each hand creates an independent 52-card deck via `node:crypto.randomInt` (Fisher-Yates pass -> random cut between cards 12 and 40 -> second Fisher-Yates pass) and computes a unique `shoeId` and `SHA-256` `deckHash`.
- **Complete Hold'em Rules Engine**: Evaluates all 10 hand categories (including A-5 wheel straights), computes main pots and multi-way side pots, returns uncalled bets, and preserves chip conservation.

### 4. AI Thinking Inspector & SQLite Persistence

- **Thinking Inspector Modal**: Inspect each AI decision's hole cards, board texture, hand evaluation, pot odds, remaining stack, 3-part tactical reasoning, native chain-of-thought (`<think>`, `reasoning_content`, or Anthropic `thinking` blocks), full system/user prompt snapshots, and raw model output.
- **Zero-Dependency SQLite (`node:sqlite`)**: Persists state to `data/poker-arena.sqlite` (WAL mode) across 5 tables (`app_settings`, `ai_players`, `poker_tables`, `hand_records`, `hand_actions`), storing all 26+ seeded AI personas and lifetime stats, table seat states, both `in_progress` and `completed` hands, and step-by-step action telemetry.

### 5. Four-Layer Anti-Deviation Agent Guardrail

1. **10-Rule Locked System Prompt** ([`src/ai/agentPromptGuard.mjs`](./src/ai/agentPromptGuard.mjs)): Locks CLI coding agents into a Texas Hold'em player identity, forbidding coding-assistant mode, file/env probing, follow-up questions, and non-JSON text.
2. **Zero-Tool CLI Sandboxing**: Injects tool-disabling flags per CLI (`--tools "" --strict-mcp-config --disable-slash-commands` for Claude Code, `-nt --no-mcp -ne -ns --no-session` for Pi, `--ignore-user-config --ephemeral -s read-only --output-schema` for Codex, `--disable-slash-commands` for `agy`).
3. **Empty Working Directory**: Spawns every CLI agent inside an isolated temporary directory (`/tmp/texas-holdem-agent-sandbox`), isolated from the repo source and server state.
4. **Schema Validation & Legality Calibrator**: Strips ANSI codes and CLI banners, extracts the decision JSON (`{action, amount, reasoning, table_talk}`), blocks illegal `check` when facing a bet, and clamps `raise` amounts to `[minRaiseTo, maxRaiseTo]` (converting overflow raises to `all_in`).

## Getting Started

### Prerequisites

- **Node.js `>= 22.5`** (required for built-in `node:sqlite`; zero external `npm` dependencies).
- Optional: local [ModelHub](https://github.com/xdlkc/loom) running on `http://127.0.0.1:4319` or direct vendor API keys / local CLI agent binaries (`codex`, `agy`, `claude`, `pi`, `opencode2`) in `~/.local/bin`.

### Run & Test

```bash
# Run all unit and integration tests (10 tests across 3 suites)
npm test

# Start the server (defaults to http://127.0.0.1:4399)
npm start
```

You can override the bind host and port with environment variables:

```bash
HOST=127.0.0.1 PORT=4399 npm start
```

On macOS, double-click or execute [`start.command`](./start.command) to launch the server on port `4399` and automatically open `http://127.0.0.1:4399` in your default browser.

### Keyboard Shortcuts (In-Table View)

| Key | Action |
| --- | --- |
| `Space` | Deal next hand (when `idle` or `showdown`) |
| `F` | Fold |
| `C` | Check / Call |
| `R` | Raise |
| `A` | All-In |
| `Esc` | Close active modal |

## Project Structure

```text
.
├── package.json                      # Module manifest & npm scripts (start, test)
├── start.command                     # macOS double-click launcher (opens http://127.0.0.1:4399)
├── src/
│   ├── server.mjs                    # HTTP server, REST APIs, multi-table casino loop
│   ├── ai/
│   │   ├── agentPromptGuard.mjs      # 10-rule prompt lock, sandbox dir, JSON sanitizer/calibrator
│   │   ├── providers.mjs             # OpenAI/Anthropic callers, ModelHub failover, 5 CLI drivers
│   │   └── rosterSeed.mjs            # 26 seeded AI players, 5 persona archetypes, 4 effort tiers
│   ├── db/
│   │   └── database.mjs              # node:sqlite schema, seeders, player/table/hand persistence
│   └── poker/
│       ├── cards.mjs                 # 3-pass CSPRNG shuffle, shoeId & SHA-256 deckHash
│       ├── engine.mjs                # No-Limit Hold'em state machine, blinds, main/side pots
│       └── evaluator.mjs             # 5-card & 7-card hand evaluator (all 10 ranks)
├── public/
│   ├── index.html                    # Multi-table lobby & poker table HUD
│   ├── app.js                        # Client state, Web Audio casino SFX, inspector modals
│   └── styles.css                    # Casino table & modal styling
└── test/
    ├── poker.test.mjs                # Deck parsing, evaluator, fold award, multi-way side pots
    ├── ai-guardrail.test.mjs         # Catalog checks, noise stripping, illegal-move clamping
    └── db-and-multitable.test.mjs    # SQLite seeding, HTTP APIs, concurrent CSPRNG hall
```
