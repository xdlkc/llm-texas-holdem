# Royal Hold'em AI Arena (`llm-texas-holdem`)

[English](./README.md) | 简体中文

支持 **1 名人类玩家 + 多大模型 / 多 CLI Agent 玩家**同台竞技与拉斯维加斯式多桌并发观战的无限注德州扑克（No-Limit Texas Hold'em）Web 应用，零第三方 npm 依赖，基于 Node.js 原生 HTTP 与内置 `node:sqlite` 构建。

## 核心特性

### 1. 双协议支持与 ModelHub 集成

- **OpenAI & Anthropic 双协议**：每个 AI 牌手席位均支持切换 **OpenAI 协议**（`POST /v1/chat/completions`，`Authorization: Bearer`）与 **Anthropic 协议**（`POST /v1/messages`，`x-api-key` + `anthropic-version: 2023-06-01`）。
- **ModelHub 统一网关与自定义路由**：自动对接本机 [**ModelHub**](https://github.com/xdlkc/loom) 入口（`http://127.0.0.1:4319`）与本地凭据文件，当上游路由返回权限或限流错误时自动热备降级；同时支持在界面中为任意席位单独配置自定义 `Base URL`、`API Key` 与 `Model ID`。

### 2. 五大模型厂商类与五大 CLI Agent 类

- **五大模型厂商（`VENDOR_CATALOG`，预置 21 个模型）**：
  - `deepseek`（DeepSeek：`deepseek-flash`、`deepseek-v4-pro`、`deepseek-chat`、`deepseek-reasoner`）
  - `zhipu-token-plan`（智谱 Token Plan：`glm-5.3-flash`、`glm-5.3`、`glm-5.3-flashx`）
  - `kimi`（Kimi：`k3.1-pro-highspeed`、`k3.1-pro`）
  - `gpt`（GPT / OpenAI：`openai/gpt-5.4-mini`、`openai/gpt-6-astra`、`openai/gpt-6.1-sol`、`openai/gpt-5.4`、`gpt-4o`）
  - `zenmux`（ZenMux：`anthropic/claude-haiku-5.5`、`anthropic/claude-sonnet-5.5`、`anthropic/claude-opus-5.5`、`openai/gpt-6-astra`、`google/gemini-3.8-flash`、`deepseek/deepseek-v4.1-flash`、`moonshotai/kimi-k3.1-pro`）
- **五大 CLI Agent（`AGENT_CATALOG`）**：
  - `codex`（OpenAI Codex CLI，`~/.local/bin/codex`）
  - `gemini`（Gemini / Antigravity CLI，`~/.local/bin/agy`）
  - `claude-code`（Anthropic Claude Code CLI，`~/.local/bin/claude`）
  - `pi`（Pi Coding Agent CLI，`~/.local/bin/pi`）
  - `opencode2`（OpenCode v2 CLI，`~/.local/bin/opencode2`）
- **四档思考强度**：每个 AI 席位均支持 `low` / `medium` / `high` / `max` 四档推理强度，分别映射到协议 `max_tokens`（`1024`–`4096`）或各 CLI Agent 的 reasoning 参数。

### 3. 多桌并发游戏大厅与可验证 CSPRNG 牌靴

- **10 张内置牌桌 + 自由扩桌**：默认打开全牌桌大厅视角，涵盖人机主桌、五大厂商争霸、五大 Agent 乱斗、澳门豪客室、HU 单挑擂台、闪电快刀 6-Max、OpenAI vs Anthropic 双协议对抗赛、WSOP 九人满员桌以及可随时加人的自由包厢，另内置 5 套阵容预设（`LINEUP_PRESETS`）并支持自定义建桌（最多 9 人桌）。
- **后台多桌并发调度**：开启全场并发博弈后，后台观战桌以轮询方式并发推进（最多 `MAX_CONCURRENT_LLM_TABLES = 3` 个在途模型请求），支持单桌独立暂停/恢复及一键急停全部牌桌。
- **三段式 CSPRNG 洗牌与哈希承诺**：每手牌通过 `node:crypto.randomInt` 执行独立洗牌（Fisher-Yates 洗牌 → 第 12 至 40 张随机切牌 → 二次 Fisher-Yates 洗牌），并生成唯一 `shoeId` 与整副牌 `SHA-256` `deckHash`。
- **完整规则与边池结算引擎**：支持全部 10 种标准牌型（含 A-2-3-4-5 最小顺子）、多人 All-In 主池/边池精确拆分、未跟注筹码退还与全桌筹码守恒校验。

### 4. AI 思考透视镜与 SQLite 全量持久化

- **AI 思考透视（`#aiThinkingModal`）**：实时查看每位 AI 牌手每一步决策的起手底牌、公共牌、牌型评估、底池赔率与后手筹码约束、三段式战术推理、原生思维链（`<think>` / `reasoning_content` / Anthropic `thinking` 块）、完整 System/User Prompt 快照与 Raw Output。
- **SQLite 数据库持久化（`node:sqlite`）**：自动落库至 `data/poker-arena.sqlite`（开启 WAL 模式），包含 `app_settings`、`ai_players`、`poker_tables`、`hand_records`、`hand_actions` 五张表，记录 26+ 位初始化 AI 牌手人设与生涯统计、牌桌座位状态，以及 `in_progress` 和 `completed` 状态的每手牌及每步动作详情。

### 5. Agent 四重防越界护栏

1. **第一重 · 十项铁律系统提示词**（[`src/ai/agentPromptGuard.mjs`](./src/ai/agentPromptGuard.mjs)）：强制锁定德州扑克牌手身份，严禁进入代码助手模式、严禁探测环境或文件、严禁反问、严禁输出非 JSON 文本。
2. **第二重 · CLI 零工具物理禁用参数**：按驱动注入禁用参数（Claude Code 使用 `--tools "" --strict-mcp-config --disable-slash-commands`；Pi 使用 `-nt --no-mcp -ne -ns --no-session`；Codex 使用 `--ignore-user-config --ephemeral -s read-only --output-schema`；`agy` 使用 `--disable-slash-commands`）。
3. **第三重 · 空目录沙箱隔离**：所有 Agent 子进程统一在 `/tmp/texas-holdem-agent-sandbox` 空目录运行，与项目源码和服务端状态完全隔离。
4. **第四重 · Schema 强约束与合法性校准**：自动清理 ANSI 转义符与 CLI 启动噪声、提取 `{action, amount, reasoning, table_talk}` 四字段 JSON，并自动拦截非法 `check`、将越界 `raise` 校准到 `[minRaiseTo, maxRaiseTo]`（超限自动转为 `all_in`）。

## 快速开始

### 环境要求

- **Node.js `>= 22.5`**（使用内置 `node:sqlite`，无需 `npm install` 安装外部依赖）。
- 可选：在 `http://127.0.0.1:4319` 运行本地 [ModelHub](https://github.com/xdlkc/loom)，或配置各厂商 API Key 及 `~/.local/bin` 下的 CLI Agent 可执行文件（`codex`、`agy`、`claude`、`pi`、`opencode2`）。

### 启动与测试

```bash
# 运行单元测试与集成测试（共 3 个测试文件、10 条用例）
npm test

# 启动德州扑克服务端（默认 http://127.0.0.1:4399）
npm start
```

可通过环境变量覆盖监听地址与端口：

```bash
HOST=127.0.0.1 PORT=4399 npm start
```

在 macOS 上也可直接运行或双击 [`start.command`](./start.command)，脚本会在 `4399` 端口启动服务并自动用浏览器打开 `http://127.0.0.1:4399`。

### 牌桌快捷键

| 按键 | 功能 |
| --- | --- |
| `Space` | 开始新一手牌（`idle` 或 `showdown` 状态） |
| `F` | 弃牌（Fold） |
| `C` | 过牌 / 跟注（Check / Call） |
| `R` | 加注（Raise） |
| `A` | 全下（All-In） |
| `Esc` | 关闭当前弹窗 |

## 项目结构

```text
.
├── package.json                      # 模块声明与 npm 脚本（start, test）
├── start.command                     # macOS 一键启动脚本（自动打开 http://127.0.0.1:4399）
├── src/
│   ├── server.mjs                    # HTTP 服务、REST API 与多桌并发赌场主循环
│   ├── ai/
│   │   ├── agentPromptGuard.mjs      # 十项铁律提示词、沙箱目录、JSON 清洗与动作校准器
│   │   ├── providers.mjs             # OpenAI/Anthropic 请求、ModelHub 热备与五大 CLI 驱动
│   │   └── rosterSeed.mjs            # 26 位初始化 AI 牌手、5 套原型模板与 4 档思考强度
│   ├── db/
│   │   └── database.mjs              # node:sqlite 建表、初始化播种与战绩/牌局落库
│   └── poker/
│       ├── cards.mjs                 # 三段式 CSPRNG 洗牌、shoeId 与 SHA-256 deckHash
│       ├── engine.mjs                # 无限注德州状态机、盲注与主池/边池结算
│       └── evaluator.mjs             # 5/7 张牌型评估器（10 类标准牌型）
├── public/
│   ├── index.html                    # 游戏大厅与牌桌 HUD 页面
│   ├── app.js                        # 前端状态机、Web Audio 音效合成与透视弹窗
│   └── styles.css                    # 牌桌与弹窗样式
└── test/
    ├── poker.test.mjs                # 牌组解析、牌型判定、弃牌结算与多人边池测试
    ├── ai-guardrail.test.mjs         # 厂商/Agent 目录校验、噪声清洗与非法动作校准测试
    └── db-and-multitable.test.mjs    # SQLite 播种、HTTP 多桌 API 与后台 CSPRNG 并发大厅测试
```
