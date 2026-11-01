# Royal Hold'em AI Arena · 1人 + 多大模型/Agent 无限注德州扑克游戏大厅

支持 **1 名人类玩家 + 多名大模型 / CLI Agent 玩家**同台竞技与拉斯维加斯式多桌并发观战的无限注德州扑克（No-Limit Texas Hold'em）Web 应用。

## 核心特性

1. **双协议支持（OpenAI & Anthropic）**
   - 每个 AI 牌手席位均支持切换 **OpenAI 协议**（`POST /v1/chat/completions`）与 **Anthropic 协议**（`POST /v1/messages`）。
   - 自动对接本机统一模型入口（`ModelHub` `http://127.0.0.1:4319`）与已配置凭据，同时也支持在界面中为任意席位单独配置自定义 `Base URL`、`API Key` 与 `Model ID`。

2. **五大模型厂商类（Vendor Drivers）**
   - `deepseek`（DeepSeek · `deepseek-flash` / `deepseek-v4-pro` / `deepseek-chat` / `deepseek-reasoner`）
   - `zhipu-token-plan`（智谱 Token Plan · `glm-5.3-flash` / `glm-5.3` / `glm-5.3-flashx`）
   - `kimi`（Kimi · `k3.1-pro-highspeed` / `k3.1-pro`）
   - `gpt`（GPT / OpenAI · `openai/gpt-5.4-mini` / `openai/gpt-6-astra` / `openai/gpt-6.1-sol` / `openai/gpt-5.4` / `gpt-4o`）
   - `zenmux`（ZenMux · `anthropic/claude-haiku-5.5` / `anthropic/claude-sonnet-5.5` / `anthropic/claude-opus-5.5` / `google/gemini-3.8-flash` 等）

3. **五大 Agent 类（CLI Agent Drivers）**
   - `codex`（OpenAI Codex CLI）
   - `gemini`（Gemini / Antigravity CLI `agy`）
   - `claude-code`（Anthropic Claude Code CLI `claude`）
   - `pi`（Pi Coding Agent CLI `pi`）
   - `opencode2`（OpenCode v2 CLI `opencode2`）
   - 支持为每个 Agent 玩家绑定底层模型厂商、具体模型与 4 档思考强度（`low` / `medium` / `high` / `max`）。

4. **拉斯维加斯 / QQ 游戏大厅多桌并发架构 & 独立 CSPRNG 随机牌靴**
   - **默认所有牌桌大厅视角**：内置 10 张不同规格牌桌（人机主桌、五大厂商争霸、五大 Agent 乱斗、澳门豪客桌、HU 单挑擂台、闪电快刀 6-Max、OpenAI vs Anthropic 双协议对抗、WSOP 九人满员桌、自由约局包厢），并支持随时新增自定义牌桌。
   - **可验证独立加密洗牌（CSPRNG）**：每张牌桌每手牌均通过 `node:crypto.randomInt` 执行独立 Fisher-Yates 洗牌，并生成唯一牌靴编号（`shoeId`）与整副 52 张牌序列的 `SHA-256 deckHash` 承诺。
   - **灵活启停控制**：支持一键停止全部牌桌、开启/暂停全场并发博弈，以及对单张牌桌独立暂停/恢复。

5. **AI 思考透视镜（Thinking Inspector）与 SQLite 全量持久化**
   - **深度思考透视（`#aiThinkingModal`）**：支持实时查看每位 AI 牌手每一步决策的「起手底牌 + 公共牌 + 牌型评估」、「底池赔率与后手筹码约束」、「三段式战术推理」、「原生思维链（`<think>` / `reasoning_content` / Anthropic `thinking` block）」以及完整的「System / User Prompt 与 Raw Output 快照」。
   - **SQLite 数据库（`node:sqlite`）持久化**：自动持久化 26+ 位初始化 AI 牌手（`厂商 × 模型` + `五大 Agent`，每位均具备完整五段式人设与生涯战绩统计）、多牌桌座位状态，以及每一手牌（含 `in_progress` 与 `completed`）和每一步动作细节。

6. **Agent 统一防越界提示词与四重安全护栏**
   - **第一重（统一防越界系统提示词）**：内置十项铁律，强制锁定德州扑克牌手身份，严禁进入代码助手模式、严禁反问、严禁输出非 JSON 文本。
   - **第二重（CLI 零工具调用参数）**：自动注入 `--tools ""`、`--strict-mcp-config`、`-nt --no-mcp -ne -ns`、`--ignore-user-config -s read-only` 等参数物理禁用全部外部工具。
   - **第三重（独立空沙箱目录隔离）**：所有 Agent 进程固定在 `/tmp/texas-holdem-agent-sandbox` 空目录运行，隔绝项目源码与服务器状态。
   - **第四重（JSON Schema 强约束与合法性校准器）**：自动清洗 CLI 输出噪声、提取决策 JSON，并自动校准非法 `check` 或越界 `raise`。

## 启动与测试

> 依赖要求：Node.js `>= 22.5`（使用内置 `node:sqlite` 零外部依赖）

```bash
# 运行单元测试与集成测试
npm test

# 启动德州扑克服务端 (默认 http://127.0.0.1:4399)
npm start
```
