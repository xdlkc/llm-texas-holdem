import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TexasHoldemGame, STREETS } from './poker/engine.mjs';
import {
  DEFAULT_UNIFIED_AGENT_SYSTEM_PROMPT,
  POKER_DECISION_JSON_SCHEMA,
  GUARDRAIL_RULES_SUMMARY,
  buildUnifiedPokerPrompt
} from './ai/agentPromptGuard.mjs';
import {
  VENDOR_CATALOG,
  AGENT_CATALOG,
  PROTOCOL_CATALOG,
  getEnvironmentCapabilities,
  decideAiMove,
  testDriverConnectivity
} from './ai/providers.mjs';
import {
  THINKING_EFFORT_OPTIONS,
  PERSONA_ARCHETYPES
} from './ai/rosterSeed.mjs';
import {
  PokerArenaDatabase,
  DEFAULT_DB_PATH,
  buildSeatFromPlayerRecord,
  buildHumanSeat
} from './db/database.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '../public');

export const LINEUP_PRESETS = {
  mixed_all_stars: {
    id: 'mixed_all_stars',
    name: '全明星混合局 (模型厂商 + Agent)',
    mode: 'play',
    description: '1 名人类玩家 + 5 名 AI 牌手（陆沉·DeepSeek、诸葛明·智谱、苏夜·Kimi、克劳德·Claude Code、派叔·Pi）',
    playerIds: [
      'vendor-deepseek-flash',
      'vendor-glm-5.3-flash',
      'vendor-kimi-k3.1-highspeed',
      'agent-claude-code',
      'agent-pi'
    ]
  },
  five_vendors: {
    id: 'five_vendors',
    name: '五大模型厂商巅峰局 (OpenAI & Anthropic 双协议)',
    mode: 'play',
    description: '1 名人类 + 5 大模型厂商（陆沉·DeepSeek / 诸葛明·智谱 / 苏夜·Kimi / 维克多·GPT / 莫妮卡·ZenMux）',
    playerIds: [
      'vendor-deepseek-flash',
      'vendor-glm-5.3-flash',
      'vendor-kimi-k3.1-highspeed',
      'vendor-gpt-5.4-mini',
      'vendor-zenmux-haiku-5.5'
    ]
  },
  five_agents: {
    id: 'five_agents',
    name: '五大 Agent 传奇对决 (统一提示词防越界)',
    mode: 'play',
    description: '1 名人类 + 5 大 CLI Agent（柯德·Codex / 杰米·Gemini / 克劳德·Claude Code / 派叔·Pi / 欧文·OpenCode2）',
    playerIds: [
      'agent-codex',
      'agent-gemini',
      'agent-claude-code',
      'agent-pi',
      'agent-opencode2'
    ]
  },
  spectate_vendors_clash: {
    id: 'spectate_vendors_clash',
    name: '👁️ 纯 AI 观战 · 六大旗舰模型争霸',
    mode: 'spectate',
    description: '0 人类 · 6 位各大厂商旗舰模型全明牌自动博弈观战',
    playerIds: [
      'vendor-deepseek-v4-pro',
      'vendor-glm-5.3',
      'vendor-kimi-k3.1-pro',
      'vendor-gpt-6-astra',
      'vendor-zenmux-sonnet-5.5',
      'vendor-zenmux-gemini-3.8-flash'
    ]
  },
  spectate_agents_arena: {
    id: 'spectate_agents_arena',
    name: '👁️ 纯 AI 观战 · 五大 Agent + 推理王乱斗',
    mode: 'spectate',
    description: '0 人类 · 五大 CLI Agent 与 DeepSeek Reasoner 全明牌自动对决',
    playerIds: [
      'agent-codex',
      'agent-gemini',
      'agent-claude-code',
      'agent-pi',
      'agent-opencode2',
      'vendor-deepseek-reasoner'
    ]
  }
};

export function createPokerAppServer(options = {}) {
  const db = new PokerArenaDatabase(options.dbPath || DEFAULT_DB_PATH);
  const gamesByTableId = new Map();
  const aiStepLocks = new Map(); // tableId -> boolean
  const persistedHandKeys = new Set();
  const guardrailAuditLog = [];

  let customAgentSystemPrompt =
    db.getSetting('unified_agent_system_prompt') || DEFAULT_UNIFIED_AGENT_SYSTEM_PROMPT;
  let activeTableId = db.getSetting('active_table_id') || 'table-main';
  const savedLiveMode = db.getSetting('las_vegas_live_mode');
  let lasVegasLiveMode = options.fastSimulationOnly
    ? Boolean(options.enableBackgroundCasino)
    : (savedLiveMode ? savedLiveMode === 'true' : false);
  const pausedTables = new Set(); // tableId set for individually paused tables
  const tableShowdownTimestamps = new Map(); // tableId -> timestamp ms when showdown was reached

  function hydrateGameFromTableRecord(tableRecord) {
    const g = new TexasHoldemGame({
      tableId: tableRecord.id,
      tableName: tableRecord.name,
      mode: tableRecord.mode || 'play',
      description: tableRecord.description || '',
      smallBlind: tableRecord.smallBlind || 10,
      bigBlind: tableRecord.bigBlind || 20,
      ante: tableRecord.ante || 0,
      startingChips: tableRecord.startingChips || 2000,
      handNumber: tableRecord.handNumber || 0,
      revealAllCards: Boolean(tableRecord.revealAllCards || tableRecord.mode === 'spectate')
    });
    g.setSeats(tableRecord.seats || []);
    gamesByTableId.set(tableRecord.id, g);
    aiStepLocks.set(tableRecord.id, false);
    return g;
  }

  for (const t of db.listTables()) {
    hydrateGameFromTableRecord(t);
  }

  if (!gamesByTableId.has(activeTableId)) {
    const first = db.listTables()[0];
    activeTableId = first ? first.id : 'table-main';
    db.setSetting('active_table_id', activeTableId);
  }

  function getTargetGame(requestedTableId = '') {
    const tid = requestedTableId || activeTableId;
    if (gamesByTableId.has(tid)) {
      return gamesByTableId.get(tid);
    }
    const fromDb = db.getTable(tid);
    if (fromDb) {
      return hydrateGameFromTableRecord(fromDb);
    }
    return gamesByTableId.get(activeTableId) || [...gamesByTableId.values()][0];
  }

  function syncGameToDatabase(game) {
    db.saveTableState(game.tableId, {
      name: game.tableName,
      mode: game.mode,
      description: game.description,
      smallBlind: game.smallBlind,
      bigBlind: game.bigBlind,
      ante: game.ante,
      startingChips: game.startingChips,
      revealAllCards: game.revealAllCards,
      handNumber: game.handNumber,
      seats: game.serializeSeatsForStorage()
    });
  }

  function persistHandIfCompleted(game) {
    if (!game || game.handNumber <= 0 || game.street === STREETS.IDLE) return null;
    const handKey = `${game.tableId}-hand-${game.handNumber}`;
    const isCompleted = game.street === STREETS.SHOWDOWN && Boolean(game.handSummary);

    if (isCompleted && !persistedHandKeys.has(handKey)) {
      persistedHandKeys.add(handKey);
      tableShowdownTimestamps.set(game.tableId, Date.now());
      const winnerSeatSet = new Set((game.winners || []).map(w => w.seatIndex));

      // Update lifetime stats in ai_players table once per completed hand
      for (const s of game.seats) {
        if (!s.inHand) continue;
        const netDelta = s.chips - (s.handStartChips ?? s.chips);
        if (s.playerId && s.playerId !== 'human-player') {
          db.incrementPlayerStats(s.playerId, {
            handsPlayedDelta: 1,
            handsWonDelta: winnerSeatSet.has(s.seatIndex) ? 1 : 0,
            vpipDelta: s.vpipThisHand ? 1 : 0,
            pfrDelta: 0,
            netChipsDelta: netDelta
          });
        }
      }
    }

    const seatsSnapshot = game.seats.map(s => ({
      seatIndex: s.seatIndex,
      playerId: s.playerId || '',
      name: s.name,
      title: s.title || '',
      avatar: s.avatar,
      isHuman: s.isHuman,
      driverType: s.driverType,
      vendor: s.vendor,
      protocol: s.protocol,
      agent: s.agent,
      model: s.model,
      thinkingEffort: s.thinkingEffort || 'medium',
      position: s.position,
      inHand: s.inHand,
      folded: s.folded,
      allIn: s.allIn,
      holeCards: s.holeCards.map(c => c.display),
      handStartChips: s.handStartChips ?? s.chips,
      chipsAfter: s.chips,
      netChips: s.chips - (s.handStartChips ?? s.chips)
    }));

    db.recordCompletedHand({
      handId: handKey,
      tableId: game.tableId,
      tableName: game.tableName,
      handNumber: game.handNumber,
      mode: game.mode,
      smallBlind: game.smallBlind,
      bigBlind: game.bigBlind,
      ante: game.ante,
      shoeId: game.shoeId || '',
      deckHash: game.deckHash || '',
      status: isCompleted ? 'completed' : 'in_progress',
      communityCards: game.communityCards.map(c => c.display),
      totalPot: isCompleted ? (game.handSummary.totalPot ?? game.pot) : game.pot,
      pots: game.pots,
      winners: game.winners || [],
      seatsSnapshot,
      actions: game.actionHistory,
      byFold: Boolean(game.handSummary?.byFold),
      startedAt: game.handStartedAt,
      completedAt: new Date().toISOString()
    });

    syncGameToDatabase(game);
    return handKey;
  }

  async function stepAiOnTable(game, { fastSimulation = false } = {}) {
    if (!game || aiStepLocks.get(game.tableId)) return false;
    if (game.street === STREETS.IDLE || game.street === STREETS.SHOWDOWN) return false;
    const activeSeat = game.seats[game.actionSeatIndex];
    if (!activeSeat || activeSeat.isHuman) return false;

    aiStepLocks.set(game.tableId, true);
    activeSeat.thinking = true;
    try {
      const decision = await decideAiMove({
        seat: activeSeat,
        game,
        customSystemPrompt: customAgentSystemPrompt,
        fastSimulation
      });

      guardrailAuditLog.push({
        id: `${Date.now()}-${game.tableId}-${activeSeat.seatIndex}`,
        timestamp: new Date().toISOString(),
        tableId: game.tableId,
        tableName: game.tableName,
        handNumber: game.handNumber,
        street: game.street,
        seatIndex: activeSeat.seatIndex,
        playerName: activeSeat.name,
        driverType: activeSeat.driverType,
        vendor: activeSeat.vendor,
        protocol: activeSeat.protocol,
        agent: activeSeat.agent,
        thinkingEffort: activeSeat.thinkingEffort || 'medium',
        routeLabel: decision.routeLabel,
        action: decision.action,
        amount: decision.amount,
        latencyMs: decision.latencyMs,
        guardrailAdjusted: decision.guardrailAdjusted,
        guardrailNotes: decision.guardrailNotes,
        reasoning: decision.reasoning,
        tableTalk: decision.tableTalk
      });
      if (guardrailAuditLog.length > 100) guardrailAuditLog.shift();

      game.applyAction(activeSeat.seatIndex, decision);
      persistHandIfCompleted(game);
      return true;
    } finally {
      activeSeat.thinking = false;
      aiStepLocks.set(game.tableId, false);
    }
  }

  function propagateRosterPlayerUpdateToTables(updatedPlayer) {
    for (const g of gamesByTableId.values()) {
      let touched = false;
      for (const s of g.seats) {
        if (s.playerId === updatedPlayer.id && !s.isHuman) {
          s.name = updatedPlayer.name;
          s.title = updatedPlayer.title;
          s.avatar = updatedPlayer.avatar;
          s.driverType = updatedPlayer.driverType;
          s.vendor = updatedPlayer.vendor;
          s.protocol = updatedPlayer.protocol;
          s.agent = updatedPlayer.agent;
          s.model = updatedPlayer.model;
          s.thinkingEffort = updatedPlayer.thinkingEffort;
          s.persona = updatedPlayer.persona;
          s.customBaseURL = updatedPlayer.customBaseURL || '';
          s.customApiKey = updatedPlayer.customApiKey || '';
          touched = true;
        }
      }
      if (touched) {
        syncGameToDatabase(g);
      }
    }
  }

  function sendJson(res, status, payload) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(payload));
  }

  async function readJsonBody(req) {
    const chunks = [];
    for await (const c of req) {
      chunks.push(c);
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw);
  }

  function buildTablesSummaryList() {
    const result = [];
    for (const [tid, g] of gamesByTableId.entries()) {
      const enabledSeats = g.seats.filter(s => s.enabled);
      const aiCount = enabledSeats.filter(s => !s.isHuman).length;
      const humanCount = enabledSeats.filter(s => s.isHuman).length;
      result.push({
        id: tid,
        name: g.tableName,
        mode: g.mode,
        description: g.description,
        smallBlind: g.smallBlind,
        bigBlind: g.bigBlind,
        ante: g.ante,
        startingChips: g.startingChips,
        handNumber: g.handNumber,
        shoeId: g.shoeId || '',
        deckHash: g.deckHash || '',
        street: g.street,
        pot: g.pot,
        communityCards: g.communityCards.map(c => c.display),
        winners: g.winners || [],
        seatCount: enabledSeats.length,
        aiCount,
        humanCount,
        revealAllCards: g.revealAllCards,
        paused: pausedTables.has(tid),
        aiStepInProgress: Boolean(aiStepLocks.get(tid)),
        playersPreview: enabledSeats.map(s => ({
          seatIndex: s.seatIndex,
          playerId: s.playerId || '',
          name: s.name,
          title: s.title || '',
          avatar: s.avatar,
          isHuman: s.isHuman,
          driverType: s.driverType,
          vendor: s.vendor,
          protocol: s.protocol,
          agent: s.agent,
          model: s.model,
          thinkingEffort: s.thinkingEffort || 'medium',
          chips: s.chips,
          folded: s.folded,
          allIn: s.allIn,
          currentBet: s.currentBet,
          lastActionLabel: s.lastAction?.label || '',
          isTurn: s.seatIndex === g.actionSeatIndex && g.street !== 'idle' && g.street !== 'showdown'
        }))
      });
    }
    return result;
  }

  function buildFullResponseState(targetGame = null) {
    const game = targetGame || getTargetGame(activeTableId);
    const roster = db.listAiPlayers().map(p => {
      const { customApiKey, ...safePlayer } = p;
      return safePlayer;
    });
    return {
      activeTableId: activeTableId,
      lasVegasLiveMode,
      totalRecordedHandsCount: db.countHandRecords(),
      tables: buildTablesSummaryList(),
      game: {
        ...game.getPublicState(),
        paused: pausedTables.has(game.tableId)
      },
      roster,
      thinkingEffortOptions: THINKING_EFFORT_OPTIONS,
      personaArchetypes: PERSONA_ARCHETYPES,
      recentHandRecords: db.listHandRecords({ limit: 40 }),
      catalog: getEnvironmentCapabilities(),
      presets: Object.values(LINEUP_PRESETS).map(p => ({
        id: p.id,
        name: p.name,
        mode: p.mode,
        description: p.description
      })),
      agentGuardrail: {
        systemPrompt: customAgentSystemPrompt,
        defaultSystemPrompt: DEFAULT_UNIFIED_AGENT_SYSTEM_PROMPT,
        jsonSchema: POKER_DECISION_JSON_SCHEMA,
        rulesSummary: GUARDRAIL_RULES_SUMMARY,
        recentAuditLogs: guardrailAuditLog.slice(-30)
      },
      aiStepInProgress: Boolean(aiStepLocks.get(game.tableId))
    };
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;

      if (pathname === '/api/state' && req.method === 'GET') {
        const reqTableId = url.searchParams.get('tableId') || '';
        if (reqTableId && gamesByTableId.has(reqTableId)) {
          activeTableId = reqTableId;
          db.setSetting('active_table_id', activeTableId);
        }
        return sendJson(res, 200, buildFullResponseState(getTargetGame(activeTableId)));
      }

      // ==========================================
      // Multi-Table Management Endpoints
      // ==========================================
      if (pathname === '/api/tables/select' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const tid = body.tableId;
        if (!tid || !gamesByTableId.has(tid)) {
          return sendJson(res, 404, { error: `未找到牌桌: ${tid}` });
        }
        activeTableId = tid;
        db.setSetting('active_table_id', activeTableId);
        return sendJson(res, 200, buildFullResponseState(getTargetGame(activeTableId)));
      }

      if (pathname === '/api/tables/create' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const createdRecord = db.createTable(body);
        const newGame = hydrateGameFromTableRecord(createdRecord);
        activeTableId = newGame.tableId;
        db.setSetting('active_table_id', activeTableId);
        newGame.addLog(`🎉 新建牌桌【${newGame.tableName}】已就绪（模式：${newGame.mode === 'spectate' ? '纯AI观战' : '人机对战'}）`);
        return sendJson(res, 200, buildFullResponseState(newGame));
      }

      if (pathname === '/api/tables/update' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const game = getTargetGame(body.tableId);
        if (aiStepLocks.get(game.tableId)) {
          return sendJson(res, 409, { error: '当前牌桌 AI 正在思考中，请稍候修改牌桌配置' });
        }
        if (typeof body.name === 'string' && body.name.trim()) {
          game.tableName = body.name.trim();
        }
        if (typeof body.description === 'string') {
          game.description = body.description.trim();
        }
        if (typeof body.smallBlind === 'number' && body.smallBlind > 0) {
          game.smallBlind = Math.floor(body.smallBlind);
          game.bigBlind = Math.floor(body.bigBlind || game.smallBlind * 2);
        }
        if (typeof body.ante === 'number' && body.ante >= 0) {
          game.ante = Math.floor(body.ante);
        }
        if (typeof body.startingChips === 'number' && body.startingChips >= game.bigBlind * 5) {
          game.startingChips = Math.floor(body.startingChips);
        }
        if (body.mode === 'play' || body.mode === 'spectate') {
          const currentHasHuman = game.seats.some(s => s.isHuman && s.enabled);
          const currentEffectiveMode = (game.mode === 'spectate' || !currentHasHuman) ? 'spectate' : 'play';
          game.mode = body.mode;

          if (body.mode !== currentEffectiveMode || body.forceReset === true) {
            if (body.mode === 'spectate') {
              game.revealAllCards = true;
              // Disable human seat so pure AI spectator mode runs seamlessly
              for (const s of game.seats) {
                if (s.isHuman) s.enabled = false;
              }
            } else {
              // Ensure there is an enabled human seat at index 0
              const humanSeat = game.seats.find(s => s.isHuman);
              if (humanSeat) {
                humanSeat.enabled = true;
                if (humanSeat.chips <= 0) humanSeat.chips = game.startingChips;
              } else {
                game.seats.unshift(buildHumanSeat(0, game.startingChips, true));
                game.seats.forEach((s, i) => { s.seatIndex = i; });
              }
            }
            game.street = STREETS.IDLE;
            game.actionSeatIndex = -1;
          } else if (body.mode === 'spectate') {
            game.revealAllCards = true;
          }
        }
        syncGameToDatabase(game);
        return sendJson(res, 200, buildFullResponseState(game));
      }

      if (pathname === '/api/casino/toggle' && req.method === 'POST') {
        const body = await readJsonBody(req);
        lasVegasLiveMode = typeof body.enabled === 'boolean' ? body.enabled : !lasVegasLiveMode;
        db.setSetting('las_vegas_live_mode', lasVegasLiveMode ? 'true' : 'false');
        if (lasVegasLiveMode) {
          pausedTables.clear();
        }
        return sendJson(res, 200, buildFullResponseState(getTargetGame(activeTableId)));
      }

      if (pathname === '/api/tables/stop' && req.method === 'POST') {
        const body = await readJsonBody(req);
        if (body.stopAll) {
          lasVegasLiveMode = false;
          db.setSetting('las_vegas_live_mode', 'false');
          for (const [tid, g] of gamesByTableId.entries()) {
            pausedTables.add(tid);
            if (body.resetToIdle && !aiStepLocks.get(tid)) {
              g.street = STREETS.IDLE;
              g.actionSeatIndex = -1;
              syncGameToDatabase(g);
            }
          }
          return sendJson(res, 200, buildFullResponseState(getTargetGame(activeTableId)));
        }

        const game = getTargetGame(body.tableId);
        const shouldPause = typeof body.paused === 'boolean' ? body.paused : !pausedTables.has(game.tableId);
        if (shouldPause) {
          pausedTables.add(game.tableId);
          if (body.resetToIdle && !aiStepLocks.get(game.tableId)) {
            game.street = STREETS.IDLE;
            game.actionSeatIndex = -1;
            game.addLog('⏹️ 牌桌已手动停止并回到待命状态');
            syncGameToDatabase(game);
          } else {
            game.addLog('⏸️ 牌桌已手动暂停自动运行');
          }
        } else {
          pausedTables.delete(game.tableId);
          game.addLog('▶️ 牌桌已恢复运行');
        }
        return sendJson(res, 200, buildFullResponseState(game));
      }

      if (pathname === '/api/casino/deal-all' && req.method === 'POST') {
        for (const g of gamesByTableId.values()) {
          if (aiStepLocks.get(g.tableId)) continue;
          const isSpectateTable = g.mode === 'spectate' || !g.seats.some(s => s.isHuman && s.enabled);
          if (isSpectateTable && g.seats.filter(s => s.enabled).length >= 2) {
            g.startNewHand({ autoRebuy: true });
            persistHandIfCompleted(g);
          }
        }
        return sendJson(res, 200, buildFullResponseState(getTargetGame(activeTableId)));
      }

      if (pathname === '/api/tables/delete' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const tid = body.tableId || activeTableId;
        if (gamesByTableId.size <= 1) {
          return sendJson(res, 400, { error: '至少需要保留 1 张牌桌' });
        }
        db.deleteTable(tid);
        gamesByTableId.delete(tid);
        aiStepLocks.delete(tid);
        if (activeTableId === tid) {
          activeTableId = [...gamesByTableId.keys()][0];
          db.setSetting('active_table_id', activeTableId);
        }
        return sendJson(res, 200, buildFullResponseState(getTargetGame(activeTableId)));
      }

      if (pathname === '/api/tables/add-seat' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const game = getTargetGame(body.tableId);
        if (aiStepLocks.get(game.tableId)) {
          return sendJson(res, 409, { error: '当前牌桌 AI 正在思考中，请稍候调整座位' });
        }
        const player = db.getAiPlayer(body.playerId);
        if (!player) {
          return sendJson(res, 404, { error: `牌手库中未找到牌手: ${body.playerId}` });
        }
        const seatConfig = buildSeatFromPlayerRecord(
          player,
          game.seats.length,
          Number(body.chips) || game.startingChips
        );
        if (typeof body.replaceSeatIndex === 'number' && game.seats[body.replaceSeatIndex]) {
          const targetIdx = body.replaceSeatIndex;
          seatConfig.seatIndex = targetIdx;
          game.seats[targetIdx] = game._normalizeSeat(seatConfig, targetIdx);
          game.addLog(`🔄 座位 #${targetIdx + 1} 已更换为 AI 牌手 [${player.name} · ${player.title}]`);
        } else {
          game.addSeat(seatConfig);
        }
        syncGameToDatabase(game);
        return sendJson(res, 200, buildFullResponseState(game));
      }

      if (pathname === '/api/tables/remove-seat' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const game = getTargetGame(body.tableId);
        if (aiStepLocks.get(game.tableId)) {
          return sendJson(res, 409, { error: '当前牌桌 AI 正在思考中，请稍候移除座位' });
        }
        game.removeSeat(Number(body.seatIndex));
        syncGameToDatabase(game);
        return sendJson(res, 200, buildFullResponseState(game));
      }

      // ==========================================
      // AI Player Roster CRUD Endpoints
      // ==========================================
      if (pathname === '/api/roster' && req.method === 'GET') {
        const players = db.listAiPlayers().map(p => {
          const { customApiKey, ...safe } = p;
          return safe;
        });
        return sendJson(res, 200, {
          roster: players,
          thinkingEffortOptions: THINKING_EFFORT_OPTIONS,
          personaArchetypes: PERSONA_ARCHETYPES
        });
      }

      if (pathname === '/api/roster/create' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const created = db.createAiPlayer(body);
        const game = getTargetGame(body.tableId);
        if (body.addToCurrentTable && game.seats.length < 9) {
          game.addSeat(buildSeatFromPlayerRecord(created, game.seats.length, game.startingChips));
          syncGameToDatabase(game);
        }
        return sendJson(res, 200, {
          createdPlayer: created,
          ...buildFullResponseState(game)
        });
      }

      if (pathname === '/api/roster/update' && req.method === 'POST') {
        const body = await readJsonBody(req);
        if (!body.id) {
          return sendJson(res, 400, { error: '缺少牌手 ID' });
        }
        const updated = db.updateAiPlayer(body.id, body);
        propagateRosterPlayerUpdateToTables(updated);
        return sendJson(res, 200, {
          updatedPlayer: updated,
          ...buildFullResponseState(getTargetGame(activeTableId))
        });
      }

      if (pathname === '/api/roster/delete' && req.method === 'POST') {
        const body = await readJsonBody(req);
        if (!body.id) {
          return sendJson(res, 400, { error: '缺少牌手 ID' });
        }
        db.deleteAiPlayer(body.id);
        return sendJson(res, 200, buildFullResponseState(getTargetGame(activeTableId)));
      }

      // ==========================================
      // Hand History & Replay Endpoints
      // ==========================================
      if (pathname === '/api/history' && req.method === 'GET') {
        const tableId = url.searchParams.get('tableId') || '';
        const limit = Number(url.searchParams.get('limit') || 50);
        return sendJson(res, 200, {
          records: db.listHandRecords({ tableId, limit })
        });
      }

      if (pathname === '/api/history/detail' && req.method === 'GET') {
        const handId = url.searchParams.get('handId') || '';
        const detail = db.getHandRecordDetail(handId);
        if (!detail) {
          return sendJson(res, 404, { error: `未找到对局记录: ${handId}` });
        }
        return sendJson(res, 200, { detail });
      }

      // ==========================================
      // Game Action & AI Step Endpoints
      // ==========================================
      if (pathname === '/api/game/new-hand' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const game = getTargetGame(body.tableId);
        if (aiStepLocks.get(game.tableId)) {
          return sendJson(res, 409, { error: 'AI 正在思考当前回合，请稍候开始新牌局' });
        }
        if (typeof body.smallBlind === 'number' && body.smallBlind > 0) {
          game.smallBlind = Math.floor(body.smallBlind);
          game.bigBlind = Math.floor(body.bigBlind || body.smallBlind * 2);
        }
        if (typeof body.ante === 'number' && body.ante >= 0) {
          game.ante = Math.floor(body.ante);
        }
        game.startNewHand({ autoRebuy: body.autoRebuy !== false });
        persistHandIfCompleted(game);
        syncGameToDatabase(game);
        return sendJson(res, 200, buildFullResponseState(game));
      }

      if (pathname === '/api/game/action' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const game = getTargetGame(body.tableId);
        const seatIndex = typeof body.seatIndex === 'number' ? body.seatIndex : game.actionSeatIndex;
        const seat = game.seats[seatIndex];
        if (!seat || !seat.isHuman) {
          return sendJson(res, 400, { error: '当前不是人类玩家的行动回合' });
        }
        game.applyAction(seatIndex, {
          action: body.action,
          amount: body.amount,
          reasoning: '人类玩家主动决策',
          tableTalk: body.tableTalk || '',
          driverBadge: 'Human Player'
        });
        persistHandIfCompleted(game);
        syncGameToDatabase(game);
        return sendJson(res, 200, buildFullResponseState(game));
      }

      if (pathname === '/api/game/ai-step' && req.method === 'POST') {
        let body = {};
        try {
          body = await readJsonBody(req);
        } catch {
          body = {};
        }
        const game = getTargetGame(body.tableId);
        await stepAiOnTable(game, {
          fastSimulation: Boolean(body.fastSimulation)
        });
        return sendJson(res, 200, buildFullResponseState(game));
      }

      if (pathname === '/api/game/toggle-reveal' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const game = getTargetGame(body.tableId);
        game.revealAllCards = typeof body.revealAllCards === 'boolean'
          ? body.revealAllCards
          : !game.revealAllCards;
        syncGameToDatabase(game);
        return sendJson(res, 200, buildFullResponseState(game));
      }

      if (pathname === '/api/game/rebuy' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const game = getTargetGame(body.tableId);
        const amount = Number(body.amount) || game.startingChips;
        if (typeof body.seatIndex === 'number') {
          game.rebuySeat(body.seatIndex, amount);
        } else {
          for (const s of game.seats) {
            if (s.enabled) s.chips = amount;
          }
          game.addLog(`💰 全桌玩家筹码已重置为 ${amount}`);
        }
        syncGameToDatabase(game);
        return sendJson(res, 200, buildFullResponseState(game));
      }

      if (pathname === '/api/seats/update' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const game = getTargetGame(body.tableId);
        if (Array.isArray(body.seats)) {
          for (const patch of body.seats) {
            if (typeof patch.seatIndex === 'number') {
              game.updateSeatConfig(patch.seatIndex, patch);
            }
          }
        } else if (typeof body.seatIndex === 'number') {
          game.updateSeatConfig(body.seatIndex, body);
        }
        syncGameToDatabase(game);
        return sendJson(res, 200, buildFullResponseState(game));
      }

      if (pathname === '/api/seats/preset' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const game = getTargetGame(body.tableId);
        if (aiStepLocks.get(game.tableId)) {
          return sendJson(res, 409, { error: '请等待当前 AI 回合结束后切换阵容预设' });
        }
        const preset = LINEUP_PRESETS[body.presetId];
        if (!preset) {
          return sendJson(res, 400, { error: `未找到预设阵容: ${body.presetId}` });
        }
        const rosterMap = new Map(db.listAiPlayers().map(p => [p.id, p]));
        const seats = [];
        if (preset.mode !== 'spectate') {
          seats.push(buildHumanSeat(0, game.startingChips, true));
        }
        for (const pid of preset.playerIds) {
          const p = rosterMap.get(pid);
          if (p) {
            seats.push(buildSeatFromPlayerRecord(p, seats.length, game.startingChips));
          }
        }
        game.mode = preset.mode || 'play';
        game.revealAllCards = game.mode === 'spectate';
        game.street = STREETS.IDLE;
        game.actionSeatIndex = -1;
        game.setSeats(seats);
        game.addLog(`🎭 已切换牌桌阵容为：【${preset.name}】`);
        syncGameToDatabase(game);
        return sendJson(res, 200, buildFullResponseState(game));
      }

      if (pathname === '/api/prompt/update' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const game = getTargetGame(body.tableId);
        if (body.reset) {
          customAgentSystemPrompt = DEFAULT_UNIFIED_AGENT_SYSTEM_PROMPT;
          db.setSetting('unified_agent_system_prompt', customAgentSystemPrompt);
          game.addLog('🛡️ Agent 统一防越界提示词已恢复为系统默认模板');
        } else if (typeof body.systemPrompt === 'string' && body.systemPrompt.trim()) {
          customAgentSystemPrompt = body.systemPrompt.trim();
          db.setSetting('unified_agent_system_prompt', customAgentSystemPrompt);
          game.addLog('🛡️ 已更新 Agent 统一防越界提示词配置并持久化至数据库');
        }
        return sendJson(res, 200, buildFullResponseState(game));
      }

      if (pathname === '/api/prompt/preview' && req.method === 'GET') {
        const game = getTargetGame(url.searchParams.get('tableId') || '');
        const seatIdx = Number(url.searchParams.get('seatIndex') || 1);
        const seat = game.seats[seatIdx] || game.seats.find(s => !s.isHuman) || game.seats[0];
        const preview = buildUnifiedPokerPrompt({
          seat,
          game,
          customSystemPrompt: customAgentSystemPrompt
        });
        return sendJson(res, 200, preview);
      }

      if (pathname === '/api/driver/test' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const result = await testDriverConnectivity({
          ...body,
          customSystemPrompt: customAgentSystemPrompt
        });
        return sendJson(res, 200, result);
      }

      // Serve static files from public/
      let relPath = pathname === '/' ? '/index.html' : pathname;
      const safePath = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(PUBLIC_DIR, safePath);
      if (filePath.startsWith(PUBLIC_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.mjs': 'application/javascript; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.svg': 'image/svg+xml'
        };
        res.writeHead(200, {
          'Content-Type': mimeTypes[ext] || 'application/octet-stream',
          'Cache-Control': 'no-store'
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      sendJson(res, 404, { error: 'Not Found' });
    } catch (err) {
      sendJson(res, 500, { error: err.message || 'Internal Server Error' });
    }
  });

  // =========================================================================
  // Las Vegas Multi-Table Live Casino Background Engine
  // Simulates a real multiplayer casino hall where every spectator table deals
  // completely independent CSPRNG hands concurrently and persists every hand to SQLite.
  // =========================================================================
  let casinoInterval = null;
  let roundRobinCursor = 0;
  const MAX_CONCURRENT_LLM_TABLES = 3;

  async function bootstrapAndStartLasVegasCasino() {
    if (!lasVegasLiveMode) return;
    const useFastSim = Boolean(options.fastSimulationOnly);
    let tableIdx = 0;

    for (const g of gamesByTableId.values()) {
      const isSpectateTable = g.mode === 'spectate' || !g.seats.some(s => s.isHuman && s.enabled);
      if (!isSpectateTable || g.seats.filter(s => s.enabled).length < 2) continue;

      if (useFastSim) {
        if (g.street === STREETS.IDLE) {
          g.startNewHand({ autoRebuy: true });
          persistHandIfCompleted(g);
          let guard = 0;
          while (g.street !== STREETS.SHOWDOWN && g.street !== STREETS.IDLE && guard < 40) {
            await stepAiOnTable(g, { fastSimulation: true });
            guard += 1;
          }
        }
        g.startNewHand({ autoRebuy: true });
        persistHandIfCompleted(g);
        const staggerSteps = (tableIdx * 2 + 1) % 7;
        for (let step = 0; step < staggerSteps; step++) {
          if (g.street === STREETS.SHOWDOWN || g.street === STREETS.IDLE) break;
          await stepAiOnTable(g, { fastSimulation: true });
        }
      } else {
        // Real LLM / Agent live mode: ensure every spectator table has an active CSPRNG hand dealt
        if (g.street === STREETS.IDLE || g.street === STREETS.SHOWDOWN) {
          g.startNewHand({ autoRebuy: true });
          persistHandIfCompleted(g);
        }
      }
      tableIdx += 1;
    }

    const tickLasVegasHall = async () => {
      if (!lasVegasLiveMode) return;
      const allGames = Array.from(gamesByTableId.values());
      const eligibleToStep = [];
      let inFlightCount = 0;

      for (const g of allGames) {
        if (pausedTables.has(g.tableId)) continue;
        if (aiStepLocks.get(g.tableId)) {
          inFlightCount += 1;
          continue;
        }
        const isSpectateTable = g.mode === 'spectate' || !g.seats.some(s => s.isHuman && s.enabled);
        if (!isSpectateTable || g.seats.filter(s => s.enabled).length < 2) continue;

        if (g.street === STREETS.IDLE) {
          g.startNewHand({ autoRebuy: true });
          persistHandIfCompleted(g);
        } else if (g.street === STREETS.SHOWDOWN) {
          const lastShowdown = tableShowdownTimestamps.get(g.tableId) || 0;
          if (Date.now() - lastShowdown >= 4500) {
            g.startNewHand({ autoRebuy: true });
            persistHandIfCompleted(g);
          } else {
            continue;
          }
        }

        if (g.street !== STREETS.IDLE && g.street !== STREETS.SHOWDOWN) {
          eligibleToStep.push(g);
        }
      }

      if (eligibleToStep.length === 0) return;

      if (useFastSim) {
        for (const g of eligibleToStep) {
          if (g.tableId !== activeTableId) {
            await stepAiOnTable(g, { fastSimulation: true });
          }
        }
        return;
      }

      // Real LLM / Agent execution across tables in round-robin order
      const availableSlots = Math.max(0, MAX_CONCURRENT_LLM_TABLES - inFlightCount);
      const countToLaunch = Math.min(availableSlots, eligibleToStep.length);
      for (let i = 0; i < countToLaunch; i++) {
        const targetGame = eligibleToStep[(roundRobinCursor + i) % eligibleToStep.length];
        stepAiOnTable(targetGame, { fastSimulation: false }).catch(() => {});
      }
      roundRobinCursor = (roundRobinCursor + countToLaunch) % Math.max(1, eligibleToStep.length);
    };

    if (!useFastSim) {
      // Immediately trigger first wave of real LLM calls without waiting for first interval
      setTimeout(() => {
        tickLasVegasHall().catch(() => {});
      }, 200);
    }

    casinoInterval = setInterval(() => {
      tickLasVegasHall().catch(() => {});
    }, 2400);

    if (casinoInterval.unref) {
      casinoInterval.unref();
    }
  }

  if (options.enableBackgroundCasino) {
    bootstrapAndStartLasVegasCasino();
  }

  server.on('close', () => {
    if (casinoInterval) {
      clearInterval(casinoInterval);
      casinoInterval = null;
    }
  });

  return {
    server,
    db,
    gamesByTableId,
    get game() {
      return getTargetGame(activeTableId);
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4399);
  const host = process.env.HOST || '127.0.0.1';
  const { server } = createPokerAppServer({ enableBackgroundCasino: true });
  server.listen(port, host, () => {
    console.log(`🃏 LLM & Agent 德州扑克竞技场已启动: http://${host}:${port}`);
  });
}
