import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PokerArenaDatabase } from '../src/db/database.mjs';
import { VENDOR_CATALOG, AGENT_CATALOG } from '../src/ai/providers.mjs';
import { createPokerAppServer } from '../src/server.mjs';

test('SQLite database initializes all (Vendor x Model) + Agent players with rich personas & thinking effort', () => {
  const tmpDbPath = path.join(os.tmpdir(), `poker-test-${Date.now()}.sqlite`);
  const db = new PokerArenaDatabase(tmpDbPath);

  const players = db.listAiPlayers();
  // Count expected Vendor x Model combinations
  const expectedVendorModelCount = Object.values(VENDOR_CATALOG).reduce(
    (sum, v) => sum + v.models.length,
    0
  );
  const expectedAgentCount = Object.keys(AGENT_CATALOG).length;
  assert.equal(expectedVendorModelCount, 21);
  assert.equal(expectedAgentCount, 5);
  assert.equal(players.length, expectedVendorModelCount + expectedAgentCount);

  // Every player must have a rich multi-paragraph persona and valid thinkingEffort
  for (const p of players) {
    assert.ok(p.persona.length >= 120, `Player ${p.name} persona should be detailed`);
    assert.ok(['low', 'medium', 'high', 'max'].includes(p.thinkingEffort));
  }

  // Test creating a new AI player and updating thinking effort
  const created = db.createAiPlayer({
    name: '测试狂鲨',
    title: '深筹算王',
    avatar: '🦈',
    driverType: 'vendor',
    vendor: 'deepseek',
    protocol: 'anthropic',
    model: 'deepseek-v4-pro',
    thinkingEffort: 'max',
    persona: '【性格与背景】测试新增牌手深度人设，擅长三街极化施压与阻断牌诈唬。'
  });
  assert.equal(created.name, '测试狂鲨');
  assert.equal(created.thinkingEffort, 'max');
  assert.equal(db.listAiPlayers().length, 27);

  const updated = db.updateAiPlayer(created.id, {
    thinkingEffort: 'high',
    title: 'GTO 宗师'
  });
  assert.equal(updated.thinkingEffort, 'high');
  assert.equal(updated.title, 'GTO 宗师');

  try { fs.unlinkSync(tmpDbPath); } catch {}
});

test('Multi-table HTTP API, adding AI players to table, Spectator mode, and SQLite hand persistence', async () => {
  const tmpDbPath = path.join(os.tmpdir(), `poker-srv-test-${Date.now()}.sqlite`);
  const { server, db, gamesByTableId } = createPokerAppServer({ dbPath: tmpDbPath });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Check initial state has 10 default QQ-Game-Hall tables and 26 roster players
    const stateRes = await fetch(`${baseUrl}/api/state`);
    const stateData = await stateRes.json();
    assert.equal(stateData.roster.length, 26);
    assert.equal(stateData.tables.length, 10);

    // 2. Create a new Spectator Table via API
    const createTableRes = await fetch(`${baseUrl}/api/tables/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '👁️ 测试纯AI观战桌',
        mode: 'spectate',
        smallBlind: 25,
        bigBlind: 50,
        startingChips: 2500,
        playerIds: ['vendor-deepseek-flash', 'vendor-glm-5.3-flash', 'vendor-kimi-k3.1-highspeed']
      })
    });
    const createdTableData = await createTableRes.json();
    assert.equal(createdTableData.game.mode, 'spectate');
    assert.equal(createdTableData.game.hasHumanSeat, false);
    assert.equal(createdTableData.game.seats.length, 3);

    const newTableId = createdTableData.activeTableId;

    // 3. Add another AI player from the roster to this table
    const addSeatRes = await fetch(`${baseUrl}/api/tables/add-seat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tableId: newTableId,
        playerId: 'agent-claude-code'
      })
    });
    const afterAddData = await addSeatRes.json();
    assert.equal(afterAddData.game.seats.length, 4);

    // 4. Start a hand on the Spectator table and simulate AI actions to completion
    const newHandRes = await fetch(`${baseUrl}/api/game/new-hand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableId: newTableId })
    });
    const handStartData = await newHandRes.json();
    assert.equal(handStartData.game.handNumber, 1);
    assert.equal(handStartData.game.street, 'preflop');

    // Directly complete the hand on the table instance and verify persistence via API/DB
    const g = gamesByTableId.get(newTableId);
    while (g.street !== 'showdown') {
      const idx = g.actionSeatIndex;
      const leg = g.getLegalActions(idx);
      g.applyAction(idx, {
        action: leg.canCheck ? 'check' : (leg.canCall ? 'call' : 'fold'),
        amount: leg.canCheck ? 0 : leg.callAmount,
        reasoning: '【牌力与位置】测试结构化推理 ｜【赔率与范围】赔率合适 ｜【战术意图】控池跟注',
        thinkingContent: '内部深度思维链 CoT 测试推演过程',
        tableTalk: '看看牌面',
        driverBadge: 'Test AI',
        routeLabel: 'OpenAI Protocol -> deepseek-v4',
        rawOutput: '{"action":"call","amount":50,"reasoning":"测试"}',
        decisionContext: {
          holeCards: ['♠A', '♥K'],
          communityCards: g.communityCards.map(c => c.display),
          handStrength: '高牌 A',
          pot: g.pot,
          toCall: leg.toCall,
          callAmount: leg.callAmount,
          potOddsPercentage: 25,
          chipsRemaining: 2450,
          legalActionTypes: leg.legalActionTypes
        },
        promptSnapshot: {
          systemPrompt: '统一系统提示词',
          userPrompt: '实时牌局上下文'
        }
      });
    }

    // Trigger state/persist check by recording or calling toggle-reveal
    db.recordCompletedHand({
      handId: `${g.tableId}-hand-${g.handNumber}`,
      tableId: g.tableId,
      tableName: g.tableName,
      handNumber: g.handNumber,
      mode: g.mode,
      smallBlind: g.smallBlind,
      bigBlind: g.bigBlind,
      communityCards: g.communityCards.map(c => c.display),
      totalPot: g.handSummary.totalPot,
      pots: g.pots,
      winners: g.winners,
      seatsSnapshot: g.seats,
      actions: g.actionHistory,
      byFold: g.handSummary.byFold
    });

    const histRes = await fetch(`${baseUrl}/api/history?tableId=${encodeURIComponent(newTableId)}`);
    const histData = await histRes.json();
    assert.equal(histData.records.length, 1);

    const detailRes = await fetch(`${baseUrl}/api/history/detail?handId=${encodeURIComponent(histData.records[0].id)}`);
    const detailData = await detailRes.json();
    assert.ok(detailData.detail.actions.length >= 4);
    const firstAct = detailData.detail.actions[0];
    assert.equal(firstAct.thinkingContent, '内部深度思维链 CoT 测试推演过程');
    assert.deepEqual(firstAct.decisionContext.holeCards, ['♠A', '♥K']);
    assert.equal(firstAct.promptSnapshot.systemPrompt, '统一系统提示词');
  } finally {
    await new Promise(resolve => server.close(resolve));
    try { fs.unlinkSync(tmpDbPath); } catch {}
  }
});

test('Las Vegas Multi-Table Casino Hall deals independent CSPRNG shoes per table and persists every hand to SQLite', async () => {
  const tmpDbPath = path.join(os.tmpdir(), `poker-vegas-test-${Date.now()}.sqlite`);
  const { server, db, gamesByTableId } = createPokerAppServer({
    dbPath: tmpDbPath,
    enableBackgroundCasino: true,
    fastSimulationOnly: true
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  // Wait briefly for async bootstrap of spectator tables
  await new Promise(resolve => setTimeout(resolve, 120));

  try {
    const deckHashes = new Set();
    const shoeIds = new Set();
    const holeCardFingerprints = new Set();

    for (const g of gamesByTableId.values()) {
      const isSpectate = g.mode === 'spectate' || !g.seats.some(s => s.isHuman && s.enabled);
      if (!isSpectate) continue;
      assert.ok(g.handNumber >= 2, `Spectator table ${g.tableId} should have played and started hands`);
      assert.ok(g.shoeId && g.deckHash, `Table ${g.tableId} must have verifiable shoeId & deckHash`);
      shoeIds.add(g.shoeId);
      deckHashes.add(g.deckHash);

      const fp = g.seats
        .filter(s => s.inHand)
        .map(s => s.holeCards.map(c => c.code).join(''))
        .join('|');
      holeCardFingerprints.add(fp);
    }

    // All 7 spectator tables must have 7 distinct shoeIds, 7 distinct deckHashes, and 7 distinct dealt hands
    assert.equal(shoeIds.size, 7);
    assert.equal(deckHashes.size, 7);
    assert.equal(holeCardFingerprints.size, 7);

    // Every single hand (7 completed + 7 in-progress = 14 hands) must be persisted in SQLite
    const totalPersisted = db.countHandRecords();
    assert.ok(totalPersisted >= 14, `Expected at least 14 persisted hands in SQLite, got ${totalPersisted}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    try { fs.unlinkSync(tmpDbPath); } catch {}
  }
});
