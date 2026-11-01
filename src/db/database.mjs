import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { INITIAL_AI_ROSTER } from '../ai/rosterSeed.mjs';
import { DEFAULT_UNIFIED_AGENT_SYSTEM_PROMPT } from '../ai/agentPromptGuard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = path.join(__dirname, '../../data/poker-arena.sqlite');

export function buildSeatFromPlayerRecord(player, seatIndex, startingChips = 2000) {
  return {
    seatIndex,
    id: `seat-${seatIndex}-${player.id}`,
    playerId: player.id,
    name: player.name,
    title: player.title || 'AI 职业牌手',
    avatar: player.avatar || '🤖',
    isHuman: false,
    enabled: true,
    driverType: player.driverType || 'vendor',
    vendor: player.vendor || 'deepseek',
    protocol: player.protocol || 'openai',
    agent: player.agent || 'pi',
    model: player.model || '',
    thinkingEffort: player.thinkingEffort || 'medium',
    persona: player.persona || '',
    customBaseURL: player.customBaseURL || '',
    customApiKey: player.customApiKey || '',
    chips: startingChips,
    stats: {
      handsPlayed: Number(player.handsPlayed || 0),
      handsWon: Number(player.handsWon || 0),
      vpipCount: Number(player.vpipCount || 0),
      pfrCount: Number(player.pfrCount || 0),
      totalNetChips: Number(player.totalNetChips || 0)
    }
  };
}

export function buildHumanSeat(seatIndex = 0, startingChips = 2000, enabled = true) {
  return {
    seatIndex,
    id: 'seat-human',
    playerId: 'human-player',
    name: '高进 (你)',
    title: '人类传奇赌神',
    avatar: '👑',
    isHuman: true,
    enabled,
    driverType: 'human',
    vendor: 'deepseek',
    protocol: 'openai',
    agent: 'codex',
    model: '',
    thinkingEffort: 'high',
    persona: '【性格与背景】人类主角玩家，亲自坐镇牌桌与各大模型厂商及 Agent 同台竞技。',
    customBaseURL: '',
    customApiKey: '',
    chips: startingChips,
    stats: {
      handsPlayed: 0,
      handsWon: 0,
      vpipCount: 0,
      pfrCount: 0,
      totalNetChips: 0
    }
  };
}

export class PokerArenaDatabase {
  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this._initSchema();
    this._seedInitialRosterIfNeeded();
    this._seedDefaultTablesIfNeeded();
  }

  _initSchema() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_players (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'AI 牌手',
        avatar TEXT NOT NULL DEFAULT '🤖',
        driver_type TEXT NOT NULL DEFAULT 'vendor',
        vendor TEXT NOT NULL DEFAULT 'deepseek',
        protocol TEXT NOT NULL DEFAULT 'openai',
        agent TEXT NOT NULL DEFAULT 'pi',
        model TEXT NOT NULL DEFAULT '',
        thinking_effort TEXT NOT NULL DEFAULT 'medium',
        persona TEXT NOT NULL DEFAULT '',
        custom_base_url TEXT NOT NULL DEFAULT '',
        custom_api_key TEXT NOT NULL DEFAULT '',
        is_builtin INTEGER NOT NULL DEFAULT 0,
        hands_played INTEGER NOT NULL DEFAULT 0,
        hands_won INTEGER NOT NULL DEFAULT 0,
        vpip_count INTEGER NOT NULL DEFAULT 0,
        pfr_count INTEGER NOT NULL DEFAULT 0,
        total_net_chips INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS poker_tables (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'play',
        description TEXT NOT NULL DEFAULT '',
        small_blind INTEGER NOT NULL DEFAULT 10,
        big_blind INTEGER NOT NULL DEFAULT 20,
        ante INTEGER NOT NULL DEFAULT 0,
        starting_chips INTEGER NOT NULL DEFAULT 2000,
        reveal_all_cards INTEGER NOT NULL DEFAULT 0,
        hand_number INTEGER NOT NULL DEFAULT 0,
        seats_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hand_records (
        id TEXT PRIMARY KEY,
        table_id TEXT NOT NULL,
        table_name TEXT NOT NULL,
        hand_number INTEGER NOT NULL,
        mode TEXT NOT NULL DEFAULT 'play',
        small_blind INTEGER NOT NULL,
        big_blind INTEGER NOT NULL,
        ante INTEGER NOT NULL DEFAULT 0,
        shoe_id TEXT NOT NULL DEFAULT '',
        deck_hash TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'completed',
        community_cards_json TEXT NOT NULL DEFAULT '[]',
        total_pot INTEGER NOT NULL DEFAULT 0,
        pots_json TEXT NOT NULL DEFAULT '[]',
        winners_json TEXT NOT NULL DEFAULT '[]',
        seats_snapshot_json TEXT NOT NULL DEFAULT '[]',
        action_count INTEGER NOT NULL DEFAULT 0,
        by_fold INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_hand_records_table_id
        ON hand_records(table_id, completed_at DESC);

      CREATE TABLE IF NOT EXISTS hand_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hand_id TEXT NOT NULL,
        table_id TEXT NOT NULL,
        hand_number INTEGER NOT NULL,
        step_index INTEGER NOT NULL,
        street TEXT NOT NULL,
        seat_index INTEGER NOT NULL,
        player_id TEXT NOT NULL DEFAULT '',
        player_name TEXT NOT NULL,
        position TEXT NOT NULL DEFAULT '',
        driver_badge TEXT NOT NULL DEFAULT '',
        thinking_effort TEXT NOT NULL DEFAULT 'medium',
        action TEXT NOT NULL,
        amount INTEGER NOT NULL DEFAULT 0,
        pot_after INTEGER NOT NULL DEFAULT 0,
        reasoning TEXT NOT NULL DEFAULT '',
        table_talk TEXT NOT NULL DEFAULT '',
        latency_ms INTEGER NOT NULL DEFAULT 0,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_hand_actions_hand_id
        ON hand_actions(hand_id, step_index ASC);
    `);

    try {
      this.db.exec(`ALTER TABLE hand_actions ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}'`);
    } catch {
      // column already exists
    }
    try {
      this.db.exec(`ALTER TABLE hand_records ADD COLUMN shoe_id TEXT NOT NULL DEFAULT ''`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE hand_records ADD COLUMN deck_hash TEXT NOT NULL DEFAULT ''`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE hand_records ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'`);
    } catch {}
  }

  _mapPlayerRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      title: row.title,
      avatar: row.avatar,
      driverType: row.driver_type,
      vendor: row.vendor,
      protocol: row.protocol,
      agent: row.agent,
      model: row.model,
      thinkingEffort: row.thinking_effort || 'medium',
      persona: row.persona,
      customBaseURL: row.custom_base_url || '',
      customApiKey: row.custom_api_key || '',
      hasCustomApiKey: Boolean(row.custom_api_key),
      isBuiltin: Boolean(row.is_builtin),
      handsPlayed: Number(row.hands_played || 0),
      handsWon: Number(row.hands_won || 0),
      vpipCount: Number(row.vpip_count || 0),
      pfrCount: Number(row.pfr_count || 0),
      totalNetChips: Number(row.total_net_chips || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  _seedInitialRosterIfNeeded() {
    const now = new Date().toISOString();
    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO ai_players (
        id, name, title, avatar, driver_type, vendor, protocol, agent, model,
        thinking_effort, persona, custom_base_url, custom_api_key, is_builtin,
        hands_played, hands_won, vpip_count, pfr_count, total_net_chips,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, '', '', 1,
        0, 0, 0, 0, 0,
        ?, ?
      )
    `);

    for (const p of INITIAL_AI_ROSTER) {
      insertStmt.run(
        p.id,
        p.name,
        p.title || 'AI 职业牌手',
        p.avatar || '🤖',
        p.driverType || 'vendor',
        p.vendor || 'deepseek',
        p.protocol || 'openai',
        p.agent || 'pi',
        p.model || '',
        p.thinkingEffort || 'medium',
        p.persona || '',
        now,
        now
      );
    }

    // Ensure default settings exist
    const existingPrompt = this.getSetting('unified_agent_system_prompt');
    if (!existingPrompt) {
      this.setSetting('unified_agent_system_prompt', DEFAULT_UNIFIED_AGENT_SYSTEM_PROMPT);
    }
  }

  _seedDefaultTablesIfNeeded() {
    const now = new Date().toISOString();
    const byId = new Map(this.listAiPlayers().map(p => [p.id, p]));
    const pick = id => byId.get(id) || this.listAiPlayers()[0];

    const defaultTables = [
      {
        id: 'table-main',
        name: '01号桌 · 皇家全明星主桌',
        mode: 'play',
        description: '大众竞技场 · 1 名人类 + 5 位明星 AI 牌手（DeepSeek / 智谱 / Kimi / Claude / Pi）',
        sb: 10,
        bb: 20,
        ante: 0,
        chips: 2000,
        reveal: 0,
        seats: [
          buildHumanSeat(0, 2000, true),
          buildSeatFromPlayerRecord(pick('vendor-deepseek-flash'), 1, 2000),
          buildSeatFromPlayerRecord(pick('vendor-glm-5.3-flash'), 2, 2000),
          buildSeatFromPlayerRecord(pick('vendor-kimi-k3.1-highspeed'), 3, 2000),
          buildSeatFromPlayerRecord(pick('agent-claude-code'), 4, 2000),
          buildSeatFromPlayerRecord(pick('agent-pi'), 5, 2000)
        ]
      },
      {
        id: 'table-vendors-spectate',
        name: '02号桌 · 五大厂商旗舰争霸',
        mode: 'spectate',
        description: '观战专区 · DeepSeek V4 Pro / GLM-5.3 / Kimi K3.1 / GPT-6 / Claude Sonnet / Gemini',
        sb: 25,
        bb: 50,
        ante: 0,
        chips: 3000,
        reveal: 1,
        seats: [
          buildSeatFromPlayerRecord(pick('vendor-deepseek-v4-pro'), 0, 3000),
          buildSeatFromPlayerRecord(pick('vendor-glm-5.3'), 1, 3000),
          buildSeatFromPlayerRecord(pick('vendor-kimi-k3.1-pro'), 2, 3000),
          buildSeatFromPlayerRecord(pick('vendor-gpt-6-astra'), 3, 3000),
          buildSeatFromPlayerRecord(pick('vendor-zenmux-sonnet-5.5'), 4, 3000),
          buildSeatFromPlayerRecord(pick('vendor-zenmux-gemini-3.8-flash'), 5, 3000)
        ]
      },
      {
        id: 'table-agents-spectate',
        name: '03号桌 · 五大 CLI Agent 乱斗',
        mode: 'spectate',
        description: 'Agent 专场 · Codex / Gemini / Claude Code / Pi / OpenCode2 沙箱巅峰对决',
        sb: 15,
        bb: 30,
        ante: 0,
        chips: 2500,
        reveal: 1,
        seats: [
          buildSeatFromPlayerRecord(pick('agent-codex'), 0, 2500),
          buildSeatFromPlayerRecord(pick('agent-gemini'), 1, 2500),
          buildSeatFromPlayerRecord(pick('agent-claude-code'), 2, 2500),
          buildSeatFromPlayerRecord(pick('agent-pi'), 3, 2500),
          buildSeatFromPlayerRecord(pick('agent-opencode2'), 4, 2500),
          buildSeatFromPlayerRecord(pick('vendor-deepseek-reasoner'), 5, 2500)
        ]
      },
      {
        id: 'table-high-roller',
        name: '04号桌 · 澳门高额深筹豪客室',
        mode: 'spectate',
        description: '高额盲注 100/200 · 宗师级思考强度 (High/Max) 深度算牌对决，含空余席位可随时加人',
        sb: 100,
        bb: 200,
        ante: 25,
        chips: 20000,
        reveal: 1,
        seats: [
          buildSeatFromPlayerRecord(pick('vendor-zenmux-opus-5.5'), 0, 20000),
          buildSeatFromPlayerRecord(pick('vendor-deepseek-reasoner'), 1, 20000),
          buildSeatFromPlayerRecord(pick('vendor-gpt-6.1-sol'), 2, 20000),
          buildSeatFromPlayerRecord(pick('vendor-zenmux-deepseek-v4.1'), 3, 20000)
        ]
      },
      {
        id: 'table-heads-up',
        name: '05号桌 · 紫禁之巅 HU 单挑擂台',
        mode: 'spectate',
        description: '双人单挑王座 (Heads-Up) · 顾渊 (DeepSeek Reasoner) vs 奥古斯特 (Claude Opus 5.5)',
        sb: 50,
        bb: 100,
        ante: 0,
        chips: 10000,
        reveal: 1,
        seats: [
          buildSeatFromPlayerRecord(pick('vendor-deepseek-reasoner'), 0, 10000),
          buildSeatFromPlayerRecord(pick('vendor-zenmux-opus-5.5'), 1, 10000)
        ]
      },
      {
        id: 'table-fast-blitz',
        name: '06号桌 · 闪电快刀 6-Max 极速房',
        mode: 'play',
        description: '快节奏低延迟局 · 集合全部 Flash 极速模型与你同台过招',
        sb: 5,
        bb: 10,
        ante: 0,
        chips: 1000,
        reveal: 0,
        seats: [
          buildHumanSeat(0, 1000, true),
          buildSeatFromPlayerRecord(pick('vendor-deepseek-flash'), 1, 1000),
          buildSeatFromPlayerRecord(pick('vendor-glm-5.3-flashx'), 2, 1000),
          buildSeatFromPlayerRecord(pick('vendor-gpt-5.4-mini'), 3, 1000),
          buildSeatFromPlayerRecord(pick('vendor-zenmux-haiku-5.5'), 4, 1000)
        ]
      },
      {
        id: 'table-anthropic-vs-openai',
        name: '07号桌 · 双协议对抗赛 (OpenAI vs Anthropic)',
        mode: 'spectate',
        description: 'OpenAI 协议战队 vs Anthropic 原生协议战队，预留空位供你继续派遣 AI',
        sb: 20,
        bb: 40,
        ante: 0,
        chips: 4000,
        reveal: 1,
        seats: [
          buildSeatFromPlayerRecord(pick('vendor-deepseek-chat'), 0, 4000),
          buildSeatFromPlayerRecord(pick('vendor-glm-5.3-flash'), 1, 4000),
          buildSeatFromPlayerRecord(pick('vendor-gpt-5.4'), 2, 4000),
          buildSeatFromPlayerRecord(pick('vendor-zenmux-sonnet-5.5'), 3, 4000)
        ]
      },
      {
        id: 'table-full-ring-9',
        name: '08号桌 · WSOP 九人满员金手链桌',
        mode: 'spectate',
        description: '9 人满员标准锦标赛桌 · 汇聚各大厂商与 Agent 代表人物',
        sb: 25,
        bb: 50,
        ante: 5,
        chips: 5000,
        reveal: 1,
        seats: [
          buildSeatFromPlayerRecord(pick('vendor-deepseek-v4-pro'), 0, 5000),
          buildSeatFromPlayerRecord(pick('vendor-glm-5.3'), 1, 5000),
          buildSeatFromPlayerRecord(pick('vendor-kimi-k3.1-pro'), 2, 5000),
          buildSeatFromPlayerRecord(pick('vendor-gpt-6-astra'), 3, 5000),
          buildSeatFromPlayerRecord(pick('vendor-gpt-4o'), 4, 5000),
          buildSeatFromPlayerRecord(pick('vendor-zenmux-kimi-k3.1'), 5, 5000),
          buildSeatFromPlayerRecord(pick('agent-codex'), 6, 5000),
          buildSeatFromPlayerRecord(pick('agent-claude-code'), 7, 5000),
          buildSeatFromPlayerRecord(pick('agent-pi'), 8, 5000)
        ]
      },
      {
        id: 'table-custom-sandbox-1',
        name: '09号桌 · 自由约局包厢 A (待加人)',
        mode: 'spectate',
        description: '当前仅 2 名牌手热身中 · 点击空座椅「➕」可随时从 26 人牌手库点将上桌',
        sb: 10,
        bb: 20,
        ante: 0,
        chips: 2000,
        reveal: 1,
        seats: [
          buildSeatFromPlayerRecord(pick('vendor-zenmux-gpt-6-astra'), 0, 2000),
          buildSeatFromPlayerRecord(pick('vendor-kimi-k3.1-highspeed'), 1, 2000)
        ]
      },
      {
        id: 'table-custom-sandbox-2',
        name: '10号桌 · 自由约局包厢 B (待加人)',
        mode: 'play',
        description: '人机自定义包厢 · 已预留多个空座，点击椅子「➕」即可邀请任意 AI 牌手入座',
        sb: 20,
        bb: 40,
        ante: 0,
        chips: 3000,
        reveal: 0,
        seats: [
          buildHumanSeat(0, 3000, true),
          buildSeatFromPlayerRecord(pick('agent-opencode2'), 1, 3000),
          buildSeatFromPlayerRecord(pick('vendor-zenmux-haiku-5.5'), 2, 3000)
        ]
      }
    ];

    const insertTable = this.db.prepare(`
      INSERT OR IGNORE INTO poker_tables (
        id, name, mode, description, small_blind, big_blind, ante,
        starting_chips, reveal_all_cards, hand_number, seats_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `);

    for (const t of defaultTables) {
      insertTable.run(
        t.id,
        t.name,
        t.mode,
        t.description,
        t.sb,
        t.bb,
        t.ante,
        t.chips,
        t.reveal,
        JSON.stringify(t.seats),
        now,
        now
      );
    }

    if (!this.getSetting('active_table_id')) {
      this.setSetting('active_table_id', 'table-main');
    }
  }

  getSetting(key, defaultValue = null) {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
  }

  setSetting(key, value) {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, String(value), now);
  }

  // ==========================================
  // AI Players Roster CRUD
  // ==========================================
  listAiPlayers() {
    const rows = this.db.prepare(`
      SELECT * FROM ai_players
      ORDER BY is_builtin DESC, created_at ASC, id ASC
    `).all();
    return rows.map(r => this._mapPlayerRow(r));
  }

  getAiPlayer(id) {
    const row = this.db.prepare('SELECT * FROM ai_players WHERE id = ?').get(id);
    return this._mapPlayerRow(row);
  }

  createAiPlayer(payload) {
    const now = new Date().toISOString();
    const id = payload.id || `custom-ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const name = (payload.name || '').trim() || '新晋 AI 牌手';
    const title = (payload.title || '').trim() || '自定义特邀牌手';
    const avatar = (payload.avatar || '').trim() || '🃏';
    const driverType = payload.driverType === 'agent' ? 'agent' : 'vendor';
    const vendor = payload.vendor || 'deepseek';
    const protocol = payload.protocol === 'anthropic' ? 'anthropic' : 'openai';
    const agent = payload.agent || 'pi';
    const model = (payload.model || '').trim();
    const thinkingEffort = ['low', 'medium', 'high', 'max'].includes(payload.thinkingEffort)
      ? payload.thinkingEffort
      : 'medium';
    const persona = (payload.persona || '').trim() || '【性格与背景】兼具算力与胆魄的 AI 牌手，擅长根据赔率与位置灵活调整策略。';
    const customBaseURL = (payload.customBaseURL || '').trim();
    const customApiKey = (payload.customApiKey || '').trim();

    this.db.prepare(`
      INSERT INTO ai_players (
        id, name, title, avatar, driver_type, vendor, protocol, agent, model,
        thinking_effort, persona, custom_base_url, custom_api_key, is_builtin,
        hands_played, hands_won, vpip_count, pfr_count, total_net_chips,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, 0,
        0, 0, 0, 0, 0,
        ?, ?
      )
    `).run(
      id, name, title, avatar, driverType, vendor, protocol, agent, model,
      thinkingEffort, persona, customBaseURL, customApiKey,
      now, now
    );

    return this.getAiPlayer(id);
  }

  updateAiPlayer(id, patch = {}) {
    const current = this.getAiPlayer(id);
    if (!current) {
      throw new Error(`未找到 AI 牌手: ${id}`);
    }
    const now = new Date().toISOString();
    const updated = {
      name: patch.name !== undefined ? String(patch.name).trim() || current.name : current.name,
      title: patch.title !== undefined ? String(patch.title).trim() || current.title : current.title,
      avatar: patch.avatar !== undefined ? String(patch.avatar).trim() || current.avatar : current.avatar,
      driverType: patch.driverType !== undefined ? (patch.driverType === 'agent' ? 'agent' : 'vendor') : current.driverType,
      vendor: patch.vendor !== undefined ? patch.vendor : current.vendor,
      protocol: patch.protocol !== undefined ? (patch.protocol === 'anthropic' ? 'anthropic' : 'openai') : current.protocol,
      agent: patch.agent !== undefined ? patch.agent : current.agent,
      model: patch.model !== undefined ? String(patch.model).trim() : current.model,
      thinkingEffort: patch.thinkingEffort !== undefined && ['low', 'medium', 'high', 'max'].includes(patch.thinkingEffort)
        ? patch.thinkingEffort
        : current.thinkingEffort,
      persona: patch.persona !== undefined ? String(patch.persona).trim() : current.persona,
      customBaseURL: patch.customBaseURL !== undefined ? String(patch.customBaseURL).trim() : current.customBaseURL,
      customApiKey: patch.customApiKey !== undefined && patch.customApiKey !== '__KEEP__'
        ? String(patch.customApiKey).trim()
        : current.customApiKey
    };

    this.db.prepare(`
      UPDATE ai_players
      SET name = ?, title = ?, avatar = ?, driver_type = ?, vendor = ?, protocol = ?,
          agent = ?, model = ?, thinking_effort = ?, persona = ?,
          custom_base_url = ?, custom_api_key = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updated.name, updated.title, updated.avatar, updated.driverType, updated.vendor,
      updated.protocol, updated.agent, updated.model, updated.thinkingEffort, updated.persona,
      updated.customBaseURL, updated.customApiKey, now, id
    );

    return this.getAiPlayer(id);
  }

  deleteAiPlayer(id) {
    const existing = this.getAiPlayer(id);
    if (!existing) throw new Error(`未找到 AI 牌手: ${id}`);
    this.db.prepare('DELETE FROM ai_players WHERE id = ?').run(id);
    return { deletedId: id };
  }

  incrementPlayerStats(playerId, { handsPlayedDelta = 0, handsWonDelta = 0, vpipDelta = 0, pfrDelta = 0, netChipsDelta = 0 }) {
    if (!playerId || playerId === 'human-player') return;
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE ai_players
      SET hands_played = hands_played + ?,
          hands_won = hands_won + ?,
          vpip_count = vpip_count + ?,
          pfr_count = pfr_count + ?,
          total_net_chips = total_net_chips + ?,
          updated_at = ?
      WHERE id = ?
    `).run(handsPlayedDelta, handsWonDelta, vpipDelta, pfrDelta, netChipsDelta, now, playerId);
  }

  // ==========================================
  // Poker Tables CRUD
  // ==========================================
  _mapTableRow(row) {
    if (!row) return null;
    let seats = [];
    try {
      seats = JSON.parse(row.seats_json || '[]');
    } catch {
      seats = [];
    }
    return {
      id: row.id,
      name: row.name,
      mode: row.mode || 'play', // 'play' | 'spectate'
      description: row.description || '',
      smallBlind: Number(row.small_blind || 10),
      bigBlind: Number(row.big_blind || 20),
      ante: Number(row.ante || 0),
      startingChips: Number(row.starting_chips || 2000),
      revealAllCards: Boolean(row.reveal_all_cards),
      handNumber: Number(row.hand_number || 0),
      seats,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  listTables() {
    const rows = this.db.prepare('SELECT * FROM poker_tables ORDER BY created_at ASC, id ASC').all();
    return rows.map(r => this._mapTableRow(r));
  }

  getTable(id) {
    const row = this.db.prepare('SELECT * FROM poker_tables WHERE id = ?').get(id);
    return this._mapTableRow(row);
  }

  createTable(payload = {}) {
    const now = new Date().toISOString();
    const id = payload.id || `table-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const mode = payload.mode === 'spectate' ? 'spectate' : 'play';
    const name = (payload.name || '').trim() || (mode === 'spectate' ? '👁️ 新建 AI 观战桌' : '👑 新建人机对战桌');
    const description = (payload.description || '').trim() || (mode === 'spectate' ? '纯 AI 牌手自动博弈观战牌桌' : '人类玩家 + AI 牌手同台竞技');
    const smallBlind = Math.max(1, Number(payload.smallBlind || 10));
    const bigBlind = Math.max(smallBlind * 2, Number(payload.bigBlind || smallBlind * 2));
    const ante = Math.max(0, Number(payload.ante || 0));
    const startingChips = Math.max(bigBlind * 10, Number(payload.startingChips || 2000));
    const revealAllCards = payload.revealAllCards !== undefined
      ? Boolean(payload.revealAllCards)
      : (mode === 'spectate');

    const roster = this.listAiPlayers();
    const byId = new Map(roster.map(p => [p.id, p]));
    const requestedPlayerIds = Array.isArray(payload.playerIds) && payload.playerIds.length > 0
      ? payload.playerIds
      : roster.slice(0, mode === 'spectate' ? 6 : 5).map(p => p.id);

    const seats = [];
    if (mode === 'play') {
      seats.push(buildHumanSeat(0, startingChips, true));
    }
    for (const pid of requestedPlayerIds) {
      if (seats.length >= 9) break;
      const p = byId.get(pid);
      if (p) {
        seats.push(buildSeatFromPlayerRecord(p, seats.length, startingChips));
      }
    }

    this.db.prepare(`
      INSERT INTO poker_tables (
        id, name, mode, description, small_blind, big_blind, ante,
        starting_chips, reveal_all_cards, hand_number, seats_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      id,
      name,
      mode,
      description,
      smallBlind,
      bigBlind,
      ante,
      startingChips,
      revealAllCards ? 1 : 0,
      JSON.stringify(seats),
      now,
      now
    );

    return this.getTable(id);
  }

  saveTableState(tableId, {
    name,
    mode,
    description,
    smallBlind,
    bigBlind,
    ante,
    startingChips,
    revealAllCards,
    handNumber,
    seats
  }) {
    const existing = this.getTable(tableId);
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE poker_tables
      SET name = ?, mode = ?, description = ?, small_blind = ?, big_blind = ?,
          ante = ?, starting_chips = ?, reveal_all_cards = ?, hand_number = ?,
          seats_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name ?? existing.name,
      mode ?? existing.mode,
      description ?? existing.description,
      smallBlind ?? existing.smallBlind,
      bigBlind ?? existing.bigBlind,
      ante ?? existing.ante,
      startingChips ?? existing.startingChips,
      (revealAllCards ?? existing.revealAllCards) ? 1 : 0,
      handNumber ?? existing.handNumber,
      JSON.stringify(seats ?? existing.seats),
      now,
      tableId
    );
    return this.getTable(tableId);
  }

  deleteTable(tableId) {
    const all = this.listTables();
    if (all.length <= 1) {
      throw new Error('至少需要保留 1 张牌桌');
    }
    this.db.prepare('DELETE FROM poker_tables WHERE id = ?').run(tableId);
    return { deletedId: tableId };
  }

  // ==========================================
  // Hand History & Action Persistence
  // ==========================================
  recordCompletedHand({
    handId,
    tableId,
    tableName,
    handNumber,
    mode = 'play',
    smallBlind,
    bigBlind,
    ante = 0,
    shoeId = '',
    deckHash = '',
    status = 'completed',
    communityCards = [],
    totalPot = 0,
    pots = [],
    winners = [],
    seatsSnapshot = [],
    actions = [],
    byFold = false,
    startedAt,
    completedAt
  }) {
    const finalHandId = handId || `${tableId}-hand-${handNumber}-${Date.now()}`;
    const now = completedAt || new Date().toISOString();

    this.db.prepare(`
      INSERT OR REPLACE INTO hand_records (
        id, table_id, table_name, hand_number, mode, small_blind, big_blind, ante,
        shoe_id, deck_hash, status,
        community_cards_json, total_pot, pots_json, winners_json, seats_snapshot_json,
        action_count, by_fold, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      finalHandId,
      tableId,
      tableName,
      handNumber,
      mode,
      smallBlind,
      bigBlind,
      ante,
      shoeId || '',
      deckHash || '',
      status || 'completed',
      JSON.stringify(communityCards),
      totalPot,
      JSON.stringify(pots),
      JSON.stringify(winners),
      JSON.stringify(seatsSnapshot),
      actions.length,
      byFold ? 1 : 0,
      startedAt || now,
      now
    );

    // Clear any existing actions for this handId and insert fresh
    this.db.prepare('DELETE FROM hand_actions WHERE hand_id = ?').run(finalHandId);
    const insertAction = this.db.prepare(`
      INSERT INTO hand_actions (
        hand_id, table_id, hand_number, step_index, street, seat_index,
        player_id, player_name, position, driver_badge, thinking_effort,
        action, amount, pot_after, reasoning, table_talk, latency_ms, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    actions.forEach((a, idx) => {
      const detailsPayload = {
        playerTitle: a.playerTitle || '',
        playerAvatar: a.playerAvatar || '🤖',
        driverType: a.driverType || '',
        vendor: a.vendor || '',
        protocol: a.protocol || '',
        agent: a.agent || '',
        model: a.model || '',
        routeLabel: a.routeLabel || a.driverBadge || '',
        thinkingContent: a.thinkingContent || '',
        guardrailAdjusted: Boolean(a.guardrailAdjusted),
        guardrailNotes: a.guardrailNotes || [],
        rawOutput: a.rawOutput || '',
        decisionContext: a.decisionContext || null,
        promptSnapshot: a.promptSnapshot || null
      };
      insertAction.run(
        finalHandId,
        tableId,
        handNumber,
        idx + 1,
        a.street || 'preflop',
        Number(a.seatIndex ?? 0),
        a.playerId || '',
        a.playerName || '',
        a.position || '',
        a.driverBadge || '',
        a.thinkingEffort || 'medium',
        a.action || 'check',
        Number(a.amount ?? a.streetBet ?? 0),
        Number(a.potAfter ?? 0),
        a.reasoning || '',
        a.tableTalk || '',
        Number(a.latencyMs ?? 0),
        JSON.stringify(detailsPayload),
        a.timestamp || now
      );
    });

    return finalHandId;
  }

  countHandRecords() {
    const row = this.db.prepare('SELECT COUNT(*) AS cnt FROM hand_records').get();
    return Number(row?.cnt || 0);
  }

  listHandRecords({ tableId = '', limit = 40 } = {}) {
    let rows;
    if (tableId) {
      rows = this.db.prepare(`
        SELECT * FROM hand_records
        WHERE table_id = ?
        ORDER BY completed_at DESC, hand_number DESC
        LIMIT ?
      `).all(tableId, Math.min(200, Math.max(1, Number(limit || 40))));
    } else {
      rows = this.db.prepare(`
        SELECT * FROM hand_records
        ORDER BY completed_at DESC, hand_number DESC
        LIMIT ?
      `).all(Math.min(200, Math.max(1, Number(limit || 40))));
    }

    return rows.map(r => ({
      id: r.id,
      tableId: r.table_id,
      tableName: r.table_name,
      handNumber: Number(r.hand_number),
      mode: r.mode,
      smallBlind: Number(r.small_blind),
      bigBlind: Number(r.big_blind),
      ante: Number(r.ante),
      shoeId: r.shoe_id || '',
      deckHash: r.deck_hash || '',
      status: r.status || 'completed',
      communityCards: JSON.parse(r.community_cards_json || '[]'),
      totalPot: Number(r.total_pot),
      pots: JSON.parse(r.pots_json || '[]'),
      winners: JSON.parse(r.winners_json || '[]'),
      seatsSnapshot: JSON.parse(r.seats_snapshot_json || '[]'),
      actionCount: Number(r.action_count),
      byFold: Boolean(r.by_fold),
      startedAt: r.started_at,
      completedAt: r.completed_at
    }));
  }

  getHandRecordDetail(handId) {
    const r = this.db.prepare('SELECT * FROM hand_records WHERE id = ?').get(handId);
    if (!r) return null;
    const actions = this.db.prepare(`
      SELECT * FROM hand_actions
      WHERE hand_id = ?
      ORDER BY step_index ASC
    `).all(handId).map(a => {
      let details = {};
      try {
        details = JSON.parse(a.details_json || '{}');
      } catch {
        details = {};
      }
      return {
        stepIndex: Number(a.step_index),
        street: a.street,
        seatIndex: Number(a.seat_index),
        playerId: a.player_id,
        playerName: a.player_name,
        position: a.position,
        driverBadge: a.driver_badge,
        thinkingEffort: a.thinking_effort,
        action: a.action,
        amount: Number(a.amount),
        potAfter: Number(a.pot_after),
        reasoning: a.reasoning,
        tableTalk: a.table_talk,
        latencyMs: Number(a.latency_ms),
        createdAt: a.created_at,
        ...details
      };
    });

    return {
      id: r.id,
      tableId: r.table_id,
      tableName: r.table_name,
      handNumber: Number(r.hand_number),
      mode: r.mode,
      smallBlind: Number(r.small_blind),
      bigBlind: Number(r.big_blind),
      ante: Number(r.ante),
      shoeId: r.shoe_id || '',
      deckHash: r.deck_hash || '',
      status: r.status || 'completed',
      communityCards: JSON.parse(r.community_cards_json || '[]'),
      totalPot: Number(r.total_pot),
      pots: JSON.parse(r.pots_json || '[]'),
      winners: JSON.parse(r.winners_json || '[]'),
      seatsSnapshot: JSON.parse(r.seats_snapshot_json || '[]'),
      actionCount: Number(r.action_count),
      byFold: Boolean(r.by_fold),
      startedAt: r.started_at,
      completedAt: r.completed_at,
      actions
    };
  }
}
