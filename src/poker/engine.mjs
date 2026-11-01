import { createDeck, shuffleDeck, createVerifiableShuffledShoe, formatCards } from './cards.mjs';
import { evaluateSevenCards, evaluatePartialHand, compareHandEvaluations } from './evaluator.mjs';

export const STREETS = {
  IDLE: 'idle',
  PREFLOP: 'preflop',
  FLOP: 'flop',
  TURN: 'turn',
  RIVER: 'river',
  SHOWDOWN: 'showdown'
};

export const STREET_NAMES_ZH = {
  idle: '等待开局',
  preflop: '翻牌前 (Pre-Flop)',
  flop: '翻牌圈 (Flop)',
  turn: '转牌圈 (Turn)',
  river: '河牌圈 (River)',
  showdown: '摊牌结算 (Showdown)'
};

const POSITION_NAMES_BY_COUNT = {
  2: ['BTN/SB', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'UTG'],
  5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  7: ['BTN', 'SB', 'BB', 'UTG', 'MP', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO']
};

export class TexasHoldemGame {
  constructor(options = {}) {
    this.tableId = options.tableId || 'table-main';
    this.tableName = options.tableName || '👑 皇家主桌';
    this.mode = options.mode || 'play'; // 'play' | 'spectate'
    this.description = options.description || '';
    this.smallBlind = options.smallBlind || 10;
    this.bigBlind = options.bigBlind || 20;
    this.ante = options.ante || 0;
    this.startingChips = options.startingChips || 2000;
    this.handNumber = Number(options.handNumber || 0);
    this.street = STREETS.IDLE;
    this.dealerSeatIndex = -1;
    this.smallBlindSeatIndex = -1;
    this.bigBlindSeatIndex = -1;
    this.actionSeatIndex = -1;
    this.handStartedAt = null;

    this.deck = [];
    this.shoeId = '';
    this.deckHash = '';
    this.burnCards = [];
    this.communityCards = [];

    this.currentBet = 0;
    this.minRaiseDelta = this.bigBlind;
    this.pot = 0;
    this.pots = [];

    this.seats = [];
    this.actionHistory = [];
    this.handLogs = [];
    this.winners = [];
    this.handSummary = null;
    this.revealAllCards = Boolean(options.revealAllCards);
    this.customDeckFactory = options.deckFactory || null;
  }

  _normalizeSeat(s, idx) {
    return {
      seatIndex: idx,
      id: s.id || `seat-${idx}`,
      playerId: s.playerId || (s.isHuman ? 'human-player' : `ai-seat-${idx}`),
      name: s.name || (idx === 0 && s.isHuman ? '高进 (你)' : `AI 牌手 ${idx}`),
      title: s.title || (s.isHuman ? '人类玩家' : 'AI 职业牌手'),
      avatar: s.avatar || '🎴',
      isHuman: Boolean(s.isHuman),
      enabled: s.enabled !== false,
      driverType: s.driverType || (s.isHuman ? 'human' : 'vendor'), // 'human' | 'vendor' | 'agent'
      vendor: s.vendor || 'deepseek', // 'deepseek' | 'zhipu-token-plan' | 'kimi' | 'gpt' | 'zenmux'
      protocol: s.protocol || 'openai', // 'openai' | 'anthropic'
      agent: s.agent || 'codex', // 'codex' | 'gemini' | 'claude-code' | 'pi' | 'opencode2'
      model: s.model || '',
      thinkingEffort: s.thinkingEffort || 'medium', // 'low' | 'medium' | 'high' | 'max'
      persona: s.persona || '均衡博弈型 (GTO)',
      customBaseURL: s.customBaseURL || '',
      customApiKey: s.customApiKey || '',
      chips: typeof s.chips === 'number' ? s.chips : this.startingChips,
      holeCards: [],
      inHand: false,
      folded: false,
      allIn: false,
      currentBet: 0,
      totalContribution: 0,
      actedThisStreet: false,
      position: '',
      lastAction: null,
      thinking: false,
      stats: s.stats || {
        handsPlayed: 0,
        handsWon: 0,
        vpipCount: 0,
        pfrCount: 0,
        totalNetChips: 0
      }
    };
  }

  setSeats(seatsConfig) {
    this.seats = seatsConfig.map((s, idx) => this._normalizeSeat(s, idx));
  }

  addSeat(seatConfig) {
    if (this.seats.length >= 9) {
      throw new Error('单张德州扑克牌桌最多支持 9 个座位');
    }
    const idx = this.seats.length;
    const newSeat = this._normalizeSeat(seatConfig, idx);
    this.seats.push(newSeat);
    this.addLog(`🪑 [${newSeat.name}] (${newSeat.title}) 已加入牌桌 #${idx + 1} 号位`);
    return newSeat;
  }

  removeSeat(seatIndex) {
    const idx = Number(seatIndex);
    if (idx < 0 || idx >= this.seats.length) {
      throw new Error(`座位 #${idx} 不存在`);
    }
    if (this.seats.length <= 2) {
      throw new Error('牌桌至少需要保留 2 个座位');
    }
    const [removed] = this.seats.splice(idx, 1);
    this.seats.forEach((s, i) => {
      s.seatIndex = i;
    });
    this.street = STREETS.IDLE;
    this.actionSeatIndex = -1;
    this.addLog(`👋 [${removed.name}] 已离开牌桌`);
    return removed;
  }

  serializeSeatsForStorage() {
    return this.seats.map((s, idx) => ({
      seatIndex: idx,
      id: s.id,
      playerId: s.playerId,
      name: s.name,
      title: s.title,
      avatar: s.avatar,
      isHuman: s.isHuman,
      enabled: s.enabled,
      driverType: s.driverType,
      vendor: s.vendor,
      protocol: s.protocol,
      agent: s.agent,
      model: s.model,
      thinkingEffort: s.thinkingEffort || 'medium',
      persona: s.persona,
      customBaseURL: s.customBaseURL || '',
      customApiKey: s.customApiKey || '',
      chips: s.chips,
      stats: s.stats
    }));
  }

  updateSeatConfig(seatIndex, patch) {
    const seat = this.seats[seatIndex];
    if (!seat) throw new Error(`Seat ${seatIndex} not found`);
    const allowed = [
      'playerId', 'name', 'title', 'avatar', 'isHuman', 'enabled', 'driverType', 'vendor',
      'protocol', 'agent', 'model', 'thinkingEffort', 'persona', 'customBaseURL', 'customApiKey'
    ];
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        seat[key] = patch[key];
      }
    }
    if (typeof patch.chips === 'number' && (this.street === STREETS.IDLE || this.street === STREETS.SHOWDOWN)) {
      seat.chips = Math.max(0, Math.floor(patch.chips));
    }
    return seat;
  }

  rebuyAllBusted(amount = this.startingChips) {
    for (const seat of this.seats) {
      if (seat.enabled && seat.chips <= 0) {
        seat.chips = amount;
        this.addLog(`💰 [${seat.name}] 补充筹码 +${amount}`);
      }
    }
  }

  rebuySeat(seatIndex, amount = this.startingChips) {
    const seat = this.seats[seatIndex];
    if (!seat) throw new Error(`Seat ${seatIndex} not found`);
    seat.chips += amount;
    this.addLog(`💰 [${seat.name}] 补充筹码 +${amount}（当前 ${seat.chips}）`);
    return seat;
  }

  addLog(message, meta = {}) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      handNumber: this.handNumber,
      street: this.street,
      message,
      ...meta
    };
    this.handLogs.push(entry);
    if (this.handLogs.length > 200) {
      this.handLogs.shift();
    }
    return entry;
  }

  getActiveOrderedSeats(fromSeatIndex = 0) {
    const enabledWithChips = this.seats.filter(s => s.enabled && s.chips > 0);
    if (!enabledWithChips.length) return [];
    const total = this.seats.length;
    const result = [];
    for (let offset = 1; offset <= total; offset++) {
      const idx = (fromSeatIndex + offset + total) % total;
      const s = this.seats[idx];
      if (s && s.enabled && s.chips > 0) {
        result.push(s);
      }
    }
    return result;
  }

  getNextInHandSeatIndex(fromSeatIndex, requireCanAct = false) {
    const total = this.seats.length;
    for (let offset = 1; offset <= total; offset++) {
      const idx = (fromSeatIndex + offset + total) % total;
      const s = this.seats[idx];
      if (!s || !s.inHand || s.folded) continue;
      if (requireCanAct && s.allIn) continue;
      return idx;
    }
    return -1;
  }

  startNewHand(options = {}) {
    // Auto-rebuy busted seats if requested or default so human+AI can always keep playing
    if (options.autoRebuy !== false) {
      for (const s of this.seats) {
        if (s.enabled && s.chips < this.bigBlind) {
          s.chips = this.startingChips;
        }
      }
    }

    const eligibleSeats = this.seats.filter(s => s.enabled && s.chips > 0);
    if (eligibleSeats.length < 2) {
      throw new Error('至少需要 2 名有筹码的在座玩家才能开始新牌局');
    }

    this.handNumber += 1;
    this.handStartedAt = new Date().toISOString();
    this.street = STREETS.PREFLOP;
    if (this.customDeckFactory) {
      this.deck = this.customDeckFactory();
      this.shoeId = `custom-shoe-${this.handNumber}`;
      this.deckHash = 'custom-test-deck';
    } else {
      const shoe = createVerifiableShuffledShoe({
        tableId: this.tableId,
        handNumber: this.handNumber
      });
      this.deck = shoe.deck;
      this.shoeId = shoe.shoeId;
      this.deckHash = shoe.deckHash;
    }
    this.burnCards = [];
    this.communityCards = [];
    this.actionHistory = [];
    this.winners = [];
    this.handSummary = null;
    this.currentBet = 0;
    this.minRaiseDelta = this.bigBlind;
    this.pot = 0;
    this.pots = [];

    // Reset all seats for new hand
    for (const s of this.seats) {
      s.holeCards = [];
      s.inHand = s.enabled && s.chips > 0;
      s.folded = false;
      s.allIn = false;
      s.currentBet = 0;
      s.totalContribution = 0;
      s.actedThisStreet = false;
      s.position = '';
      s.lastAction = null;
      s.thinking = false;
      s.handStartChips = s.chips;
      if (s.inHand) {
        s.stats.handsPlayed += 1;
        s.vpipThisHand = false;
      }
    }

    // Rotate dealer button to next inHand seat
    this.dealerSeatIndex = this.getNextInHandSeatIndex(this.dealerSeatIndex, false);
    const inHandOrderFromBtn = [];
    let cursor = this.dealerSeatIndex;
    for (let i = 0; i < eligibleSeats.length; i++) {
      inHandOrderFromBtn.push(this.seats[cursor]);
      cursor = this.getNextInHandSeatIndex(cursor, false);
    }

    const posNames = POSITION_NAMES_BY_COUNT[inHandOrderFromBtn.length] ||
      inHandOrderFromBtn.map((_, i) => (i === 0 ? 'BTN' : i === 1 ? 'SB' : i === 2 ? 'BB' : `MP${i - 2}`));
    inHandOrderFromBtn.forEach((s, i) => {
      s.position = posNames[i] || `P${i + 1}`;
    });

    if (inHandOrderFromBtn.length === 2) {
      // Heads-up rule: Dealer is Small Blind, other player is Big Blind
      this.smallBlindSeatIndex = inHandOrderFromBtn[0].seatIndex;
      this.bigBlindSeatIndex = inHandOrderFromBtn[1].seatIndex;
    } else {
      this.smallBlindSeatIndex = inHandOrderFromBtn[1].seatIndex;
      this.bigBlindSeatIndex = inHandOrderFromBtn[2].seatIndex;
    }

    this.addLog(`🃏 === 第 #${this.handNumber} 手牌开始 (盲注 ${this.smallBlind}/${this.bigBlind}) ===`);
    this.addLog(`🎲 独立加密洗牌完成 · 牌靴 [${this.shoeId}] (SHA-256: ${this.deckHash.slice(0, 12)}...)`);
    this.addLog(`🔘 庄家位 (BTN): ${this.seats[this.dealerSeatIndex].name}`);

    // Post antes if configured
    if (this.ante > 0) {
      for (const s of inHandOrderFromBtn) {
        this._commitChips(s, Math.min(s.chips, this.ante), false);
      }
      this.addLog(`🪙 全体在座玩家投入前注 (Ante) ${this.ante}`);
    }

    // Post Small Blind & Big Blind
    const sbSeat = this.seats[this.smallBlindSeatIndex];
    const bbSeat = this.seats[this.bigBlindSeatIndex];
    const sbAmount = this._commitChips(sbSeat, Math.min(sbSeat.chips, this.smallBlind), true);
    sbSeat.lastAction = { action: 'sb', label: `小盲 ${sbAmount}`, amount: sbAmount, street: STREETS.PREFLOP };

    const bbAmount = this._commitChips(bbSeat, Math.min(bbSeat.chips, this.bigBlind), true);
    bbSeat.lastAction = { action: 'bb', label: `大盲 ${bbAmount}`, amount: bbAmount, street: STREETS.PREFLOP };

    this.currentBet = Math.max(sbSeat.currentBet, bbSeat.currentBet, this.bigBlind);
    this.minRaiseDelta = this.bigBlind;

    this.addLog(`🎯 [${sbSeat.name}] (${sbSeat.position}) 下小盲注 ${sbAmount}，[${bbSeat.name}] (${bbSeat.position}) 下大盲注 ${bbAmount}`);

    // Deal 2 hole cards to each player starting left of dealer
    const dealOrder = inHandOrderFromBtn.length === 2
      ? [inHandOrderFromBtn[0], inHandOrderFromBtn[1]]
      : [...inHandOrderFromBtn.slice(1), inHandOrderFromBtn[0]];

    for (let round = 0; round < 2; round++) {
      for (const s of dealOrder) {
        s.holeCards.push(this.deck.pop());
      }
    }

    this._recalculatePots();

    // First to act pre-flop:
    // Heads-up: Dealer/SB acts first pre-flop
    // 3+ players: Left of BB (UTG) acts first pre-flop
    this.actionSeatIndex = this.getNextInHandSeatIndex(this.bigBlindSeatIndex, true);

    // Check if fewer than 2 players can act or everyone is already all-in
    if (this._shouldAutoRunout()) {
      this._advanceStreetOrShowdown();
    }

    return this.getPublicState();
  }

  _commitChips(seat, amount, countsTowardStreetBet = true) {
    const actual = Math.max(0, Math.min(seat.chips, Math.floor(amount)));
    seat.chips -= actual;
    if (countsTowardStreetBet) {
      seat.currentBet += actual;
    }
    seat.totalContribution += actual;
    this.pot += actual;
    if (seat.chips === 0 && seat.inHand && !seat.folded) {
      seat.allIn = true;
    }
    return actual;
  }

  getLegalActions(seatIndex = this.actionSeatIndex) {
    const seat = this.seats[seatIndex];
    if (!seat || !seat.inHand || seat.folded || seat.allIn || this.street === STREETS.IDLE || this.street === STREETS.SHOWDOWN) {
      return {
        canAct: false,
        toCall: 0,
        callAmount: 0,
        canFold: false,
        canCheck: false,
        canCall: false,
        canRaise: false,
        canAllIn: false,
        minRaiseTo: 0,
        maxRaiseTo: 0,
        allInAmount: 0,
        legalActionTypes: []
      };
    }

    const toCall = Math.max(0, this.currentBet - seat.currentBet);
    const callAmount = Math.min(toCall, seat.chips);
    const maxRaiseTo = seat.currentBet + seat.chips;
    const rawMinRaiseTo = this.currentBet === 0
      ? Math.max(this.bigBlind, this.minRaiseDelta)
      : this.currentBet + this.minRaiseDelta;
    const minRaiseTo = Math.min(maxRaiseTo, rawMinRaiseTo);

    const canFold = true;
    const canCheck = toCall === 0;
    const canCall = toCall > 0 && seat.chips > 0;
    // A player can make a standard raise if they have more chips than needed to call
    const canRaise = maxRaiseTo > this.currentBet && seat.chips > toCall;
    const canAllIn = seat.chips > 0;

    const legalActionTypes = ['fold'];
    if (canCheck) legalActionTypes.push('check');
    if (canCall) legalActionTypes.push('call');
    if (canRaise && maxRaiseTo >= rawMinRaiseTo) legalActionTypes.push('raise');
    if (canAllIn) legalActionTypes.push('all_in');

    return {
      canAct: seatIndex === this.actionSeatIndex,
      seatIndex,
      currentStreetBet: seat.currentBet,
      tableCurrentBet: this.currentBet,
      toCall,
      callAmount,
      canFold,
      canCheck,
      canCall,
      canRaise: canRaise && maxRaiseTo >= rawMinRaiseTo,
      canAllIn,
      minRaiseTo,
      maxRaiseTo,
      allInAmount: maxRaiseTo,
      potAfterCall: this.pot + callAmount,
      legalActionTypes
    };
  }

  applyAction(seatIndex, actionInput) {
    if (this.street === STREETS.IDLE || this.street === STREETS.SHOWDOWN) {
      throw new Error('当前不在可操作阶段');
    }
    if (seatIndex !== this.actionSeatIndex) {
      throw new Error(`当前未轮到座位 ${seatIndex} 行动（当前行动座位: ${this.actionSeatIndex}）`);
    }

    const seat = this.seats[seatIndex];
    const legal = this.getLegalActions(seatIndex);
    let action = String(actionInput?.action || '').toLowerCase().trim();
    let requestedAmount = Number(actionInput?.amount || 0);
    const reasoning = actionInput?.reasoning || '';
    const thinkingContent = actionInput?.thinkingContent || '';
    const tableTalk = actionInput?.tableTalk || actionInput?.table_talk || '';
    const latencyMs = actionInput?.latencyMs || 0;
    const driverBadge = actionInput?.driverBadge || '';
    const routeLabel = actionInput?.routeLabel || driverBadge || '';
    const guardrailAdjusted = Boolean(actionInput?.guardrailAdjusted);
    const guardrailNotes = Array.isArray(actionInput?.guardrailNotes) ? actionInput.guardrailNotes : [];
    const rawOutput = actionInput?.rawOutput || '';
    const decisionContext = actionInput?.decisionContext || null;
    const promptSnapshot = actionInput?.promptSnapshot || null;

    // Normalize aliases
    if (action === 'bet') action = 'raise';
    if (action === 'allin' || action === 'all-in') action = 'all_in';

    // Safety fallback if an invalid action slipped through
    if (action === 'check' && !legal.canCheck) {
      action = legal.canCall ? 'call' : 'fold';
    }
    if (action === 'call' && !legal.canCall) {
      action = legal.canCheck ? 'check' : 'fold';
    }
    if (action === 'raise' && !legal.canRaise) {
      if (seat.chips > legal.toCall) {
        action = 'all_in';
      } else {
        action = legal.canCall ? 'call' : (legal.canCheck ? 'check' : 'fold');
      }
    }

    let actionLabel = '';
    let chipsCommitted = 0;
    let finalStreetBet = seat.currentBet;

    if (action === 'fold') {
      seat.folded = true;
      seat.actedThisStreet = true;
      actionLabel = '弃牌 (Fold)';
      this.addLog(`🏳️ [${seat.name}] (${seat.position}) 选择弃牌`, { seatIndex, action: 'fold', tableTalk });
    } else if (action === 'check') {
      seat.actedThisStreet = true;
      actionLabel = '过牌 (Check)';
      this.addLog(`✊ [${seat.name}] (${seat.position}) 选择过牌`, { seatIndex, action: 'check', tableTalk });
    } else if (action === 'call') {
      chipsCommitted = this._commitChips(seat, legal.callAmount, true);
      finalStreetBet = seat.currentBet;
      seat.actedThisStreet = true;
      if (this.street === STREETS.PREFLOP && !seat.vpipThisHand) {
        seat.vpipThisHand = true;
        seat.stats.vpipCount += 1;
      }
      actionLabel = seat.allIn ? `全下跟注 (All-In ${finalStreetBet})` : `跟注 (Call ${chipsCommitted})`;
      this.addLog(`📞 [${seat.name}] (${seat.position}) ${actionLabel}`, { seatIndex, action: 'call', amount: chipsCommitted, tableTalk });
    } else if (action === 'raise' || action === 'all_in') {
      let targetBet = action === 'all_in'
        ? legal.maxRaiseTo
        : Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.floor(requestedAmount || legal.minRaiseTo)));

      if (targetBet >= legal.maxRaiseTo) {
        action = 'all_in';
        targetBet = legal.maxRaiseTo;
      }

      const additionalNeeded = targetBet - seat.currentBet;
      const previousTableBet = this.currentBet;
      chipsCommitted = this._commitChips(seat, additionalNeeded, true);
      finalStreetBet = seat.currentBet;
      seat.actedThisStreet = true;

      if (this.street === STREETS.PREFLOP) {
        if (!seat.vpipThisHand) {
          seat.vpipThisHand = true;
          seat.stats.vpipCount += 1;
        }
        seat.stats.pfrCount += 1;
      }

      if (finalStreetBet > previousTableBet) {
        const raiseIncrement = finalStreetBet - previousTableBet;
        // Full raise reopens action for all other active players
        if (raiseIncrement >= this.minRaiseDelta || previousTableBet === 0) {
          this.minRaiseDelta = Math.max(this.bigBlind, raiseIncrement);
          for (const other of this.seats) {
            if (other.seatIndex !== seatIndex && other.inHand && !other.folded && !other.allIn) {
              other.actedThisStreet = false;
            }
          }
        }
        this.currentBet = finalStreetBet;
      }

      if (seat.allIn || action === 'all_in') {
        action = 'all_in';
        actionLabel = `全下 (All-In ${finalStreetBet})`;
        this.addLog(`🔥 [${seat.name}] (${seat.position}) 推入全下 All-In 至 ${finalStreetBet}！`, { seatIndex, action: 'all_in', amount: finalStreetBet, tableTalk });
      } else {
        actionLabel = previousTableBet === 0 ? `下注 (Bet ${finalStreetBet})` : `加注至 (Raise to ${finalStreetBet})`;
        this.addLog(`📈 [${seat.name}] (${seat.position}) ${actionLabel}`, { seatIndex, action: 'raise', amount: finalStreetBet, tableTalk });
      }
    } else {
      throw new Error(`未知的德州扑克动作: ${action}`);
    }

    seat.thinking = false;
    const actionRecord = {
      handNumber: this.handNumber,
      street: this.street,
      seatIndex,
      playerId: seat.playerId || '',
      playerName: seat.name,
      playerTitle: seat.title || '',
      playerAvatar: seat.avatar || '🤖',
      position: seat.position,
      isHuman: seat.isHuman,
      driverType: seat.driverType,
      vendor: seat.vendor,
      protocol: seat.protocol,
      agent: seat.agent,
      model: seat.model,
      thinkingEffort: seat.thinkingEffort || 'medium',
      action,
      amount: finalStreetBet,
      label: actionLabel,
      chipsCommitted,
      streetBet: finalStreetBet,
      potAfter: this.pot,
      reasoning,
      thinkingContent,
      tableTalk,
      latencyMs,
      driverBadge,
      routeLabel,
      guardrailAdjusted,
      guardrailNotes,
      rawOutput,
      decisionContext,
      promptSnapshot,
      timestamp: new Date().toISOString()
    };

    seat.lastAction = actionRecord;
    this.actionHistory.push(actionRecord);
    this._recalculatePots();

    // Advance turn or street
    this._afterPlayerAction(seatIndex);
    return this.getPublicState();
  }

  _afterPlayerAction(lastActedSeatIndex) {
    const remainingInHand = this.seats.filter(s => s.inHand && !s.folded);

    // 1. Everyone else folded -> Single remaining player wins immediately!
    if (remainingInHand.length === 1) {
      this._awardSingleWinner(remainingInHand[0]);
      return;
    }

    // 2. Check if current betting round is complete
    if (this._isStreetBettingComplete()) {
      this._advanceStreetOrShowdown();
      return;
    }

    // 3. Move to next active player who can act
    const nextIdx = this.getNextInHandSeatIndex(lastActedSeatIndex, true);
    if (nextIdx === -1) {
      this._advanceStreetOrShowdown();
      return;
    }
    this.actionSeatIndex = nextIdx;
  }

  _isStreetBettingComplete() {
    const activePlayers = this.seats.filter(s => s.inHand && !s.folded);
    if (activePlayers.length <= 1) return true;

    const playersWhoCanAct = activePlayers.filter(s => !s.allIn);
    if (playersWhoCanAct.length === 0) return true;

    // Every non-all-in player must have acted this street and matched currentBet
    const allMatched = playersWhoCanAct.every(s => s.actedThisStreet && s.currentBet === this.currentBet);
    return allMatched;
  }

  _shouldAutoRunout() {
    const activePlayers = this.seats.filter(s => s.inHand && !s.folded);
    if (activePlayers.length <= 1) return true;
    const playersWhoCanAct = activePlayers.filter(s => !s.allIn);
    // If 0 players can act, or 1 player can act and already has >= currentBet, run out board
    if (playersWhoCanAct.length === 0) return true;
    if (playersWhoCanAct.length === 1 && playersWhoCanAct[0].currentBet >= this.currentBet) return true;
    return false;
  }

  _resetStreetBets() {
    for (const s of this.seats) {
      s.currentBet = 0;
      s.actedThisStreet = false;
      if (s.inHand && !s.folded && !s.allIn) {
        // Keep lastAction visible briefly or mark street transition
      }
    }
    this.currentBet = 0;
    this.minRaiseDelta = this.bigBlind;
  }

  _advanceStreetOrShowdown() {
    this._returnUncalledExcessIfNeeded();
    this._recalculatePots();

    const remainingInHand = this.seats.filter(s => s.inHand && !s.folded);
    if (remainingInHand.length === 1) {
      this._awardSingleWinner(remainingInHand[0]);
      return;
    }

    if (this.street === STREETS.PREFLOP) {
      this.street = STREETS.FLOP;
      this._resetStreetBets();
      this.burnCards.push(this.deck.pop());
      this.communityCards.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
      this.addLog(`🃏 [翻牌圈 Flop] 发出公共牌: ${formatCards(this.communityCards)}`);
    } else if (this.street === STREETS.FLOP) {
      this.street = STREETS.TURN;
      this._resetStreetBets();
      this.burnCards.push(this.deck.pop());
      this.communityCards.push(this.deck.pop());
      this.addLog(`🃏 [转牌圈 Turn] 发出第四张公共牌: ${formatCards([this.communityCards[3]])} (牌面: ${formatCards(this.communityCards)})`);
    } else if (this.street === STREETS.TURN) {
      this.street = STREETS.RIVER;
      this._resetStreetBets();
      this.burnCards.push(this.deck.pop());
      this.communityCards.push(this.deck.pop());
      this.addLog(`🃏 [河牌圈 River] 发出第五张公共牌: ${formatCards([this.communityCards[4]])} (最终牌面: ${formatCards(this.communityCards)})`);
    } else if (this.street === STREETS.RIVER) {
      this._resolveShowdown();
      return;
    }

    // If all remaining players are All-In (or at most 1 has chips left), automatically deal remaining streets to Showdown
    if (this._shouldAutoRunout()) {
      this._advanceStreetOrShowdown();
      return;
    }

    // Post-flop action always starts with first active non-all-in player left of the Dealer button
    this.actionSeatIndex = this.getNextInHandSeatIndex(this.dealerSeatIndex, true);
  }

  _returnUncalledExcessIfNeeded() {
    // If one non-folded player contributed strictly more than every other player in the hand,
    // return the uncalled excess to that player before computing pots/showdown.
    const contributors = this.seats.filter(s => s.totalContribution > 0);
    if (contributors.length < 2) return;
    const sortedDesc = [...contributors].sort((a, b) => b.totalContribution - a.totalContribution);
    const highest = sortedDesc[0];
    const secondHighest = sortedDesc[1];
    if (highest.totalContribution > secondHighest.totalContribution && !highest.folded) {
      const excess = highest.totalContribution - secondHighest.totalContribution;
      highest.totalContribution -= excess;
      highest.currentBet = Math.max(0, highest.currentBet - excess);
      highest.chips += excess;
      if (highest.chips > 0) highest.allIn = false;
      this.pot -= excess;
      this.addLog(`↩️ 退回 [${highest.name}] 未被跟注的超额筹码 ${excess}`);
    }
  }

  _recalculatePots() {
    const activeNonFolded = this.seats.filter(s => s.inHand && !s.folded);
    const allContributors = this.seats.filter(s => s.totalContribution > 0);
    if (!allContributors.length) {
      this.pots = [];
      this.pot = 0;
      return;
    }

    // Side pots only split at contribution caps of non-folded ALL-IN players
    const allInThresholds = activeNonFolded
      .filter(s => s.allIn && s.totalContribution > 0)
      .map(s => s.totalContribution);
    const maxContribution = Math.max(...allContributors.map(s => s.totalContribution));
    const thresholds = [...new Set([...allInThresholds, maxContribution])].sort((a, b) => a - b);

    const rawPots = [];
    let prevLevel = 0;
    for (const level of thresholds) {
      if (level <= prevLevel) continue;
      let sliceAmount = 0;
      for (const s of allContributors) {
        if (s.totalContribution > prevLevel) {
          sliceAmount += Math.min(s.totalContribution, level) - prevLevel;
        }
      }
      const eligibleSeatIndices = activeNonFolded
        .filter(s => s.totalContribution >= level || !s.allIn)
        .map(s => s.seatIndex);

      if (sliceAmount > 0) {
        rawPots.push({
          amount: sliceAmount,
          capLevel: level,
          eligibleSeatIndices: eligibleSeatIndices.length
            ? eligibleSeatIndices
            : activeNonFolded.map(s => s.seatIndex)
        });
      }
      prevLevel = level;
    }

    // Merge consecutive pots that have identical eligible winners
    const merged = [];
    for (const rp of rawPots) {
      const key = rp.eligibleSeatIndices.join(',');
      const prev = merged[merged.length - 1];
      if (prev && prev._key === key) {
        prev.amount += rp.amount;
        prev.capLevel = rp.capLevel;
      } else {
        merged.push({ ...rp, _key: key });
      }
    }

    this.pots = merged.map((p, idx) => ({
      index: idx,
      name: idx === 0 ? '主池 (Main Pot)' : `边池 ${idx} (Side Pot ${idx})`,
      amount: p.amount,
      eligibleSeatIndices: p.eligibleSeatIndices
    }));
    this.pot = allContributors.reduce((sum, s) => sum + s.totalContribution, 0);
  }

  _awardSingleWinner(winnerSeat) {
    this._returnUncalledExcessIfNeeded();
    this._recalculatePots();

    const winAmount = this.pot;
    winnerSeat.chips += winAmount;
    winnerSeat.stats.handsWon += 1;

    this.street = STREETS.SHOWDOWN;
    this.actionSeatIndex = -1;
    this.winners = [
      {
        seatIndex: winnerSeat.seatIndex,
        playerName: winnerSeat.name,
        amountWon: winAmount,
        potName: '全部底池',
        handDescription: '其余玩家弃牌获胜',
        bestFiveCodes: []
      }
    ];

    for (const s of this.seats) {
      if (s.inHand) {
        s.stats.totalNetChips += s.chips - (s.handStartChips ?? s.chips);
      }
    }

    this.handSummary = {
      handNumber: this.handNumber,
      byFold: true,
      winners: this.winners,
      totalPot: winAmount
    };

    this.addLog(`🏆 [${winnerSeat.name}] 因其余玩家全部弃牌，直接赢得底池 ${winAmount}！`);
  }

  _resolveShowdown() {
    this.street = STREETS.SHOWDOWN;
    this.actionSeatIndex = -1;
    this._recalculatePots();

    const contenders = this.seats.filter(s => s.inHand && !s.folded);
    const evalBySeat = new Map();

    for (const s of contenders) {
      const seven = [...s.holeCards, ...this.communityCards];
      const evaluation = evaluateSevenCards(seven);
      s.showdownEvaluation = evaluation;
      evalBySeat.set(s.seatIndex, evaluation);
      this.addLog(
        `🎴 [摊牌] ${s.name} (${s.position}) 亮出底牌 ${formatCards(s.holeCards)} → ${evaluation.descriptionZh} (${formatCards(evaluation.bestFiveCards)})`
      );
    }

    const payoutsBySeat = new Map();
    const potBreakdowns = [];

    for (const pot of this.pots) {
      const eligibleSeats = pot.eligibleSeatIndices
        .map(idx => this.seats[idx])
        .filter(Boolean);

      let bestEval = null;
      let potWinners = [];

      for (const s of eligibleSeats) {
        const ev = evalBySeat.get(s.seatIndex);
        if (!bestEval || compareHandEvaluations(ev, bestEval) > 0) {
          bestEval = ev;
          potWinners = [s];
        } else if (compareHandEvaluations(ev, bestEval) === 0) {
          potWinners.push(s);
        }
      }

      // Split pot equally; odd chips go to first winner clockwise from dealer button
      const baseShare = Math.floor(pot.amount / potWinners.length);
      let remainder = pot.amount % potWinners.length;

      // Sort potWinners in clockwise order starting left of dealer button for odd chip rule
      const totalSeats = this.seats.length;
      const orderedWinners = [...potWinners].sort((a, b) => {
        const distA = (a.seatIndex - this.dealerSeatIndex - 1 + totalSeats) % totalSeats;
        const distB = (b.seatIndex - this.dealerSeatIndex - 1 + totalSeats) % totalSeats;
        return distA - distB;
      });

      for (const w of orderedWinners) {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder -= 1;
        const payout = baseShare + extra;
        w.chips += payout;

        const existing = payoutsBySeat.get(w.seatIndex) || {
          seatIndex: w.seatIndex,
          playerName: w.name,
          amountWon: 0,
          potsWon: [],
          handDescription: bestEval.descriptionZh,
          categoryNameZh: bestEval.categoryNameZh,
          bestFiveCodes: bestEval.bestFiveCodes
        };
        existing.amountWon += payout;
        existing.potsWon.push(pot.name);
        payoutsBySeat.set(w.seatIndex, existing);
      }

      potBreakdowns.push({
        potName: pot.name,
        amount: pot.amount,
        winners: orderedWinners.map(w => w.name),
        handDescription: bestEval?.descriptionZh || ''
      });
    }

    this.winners = [...payoutsBySeat.values()];
    for (const w of this.winners) {
      const seat = this.seats[w.seatIndex];
      if (seat) seat.stats.handsWon += 1;
      this.addLog(`🏆 [${w.playerName}] 凭借【${w.handDescription}】赢得 ${w.amountWon} 筹码 (${w.potsWon.join(' + ')})！`);
    }

    for (const s of this.seats) {
      if (s.inHand) {
        s.stats.totalNetChips += s.chips - (s.handStartChips ?? s.chips);
      }
    }

    this.handSummary = {
      handNumber: this.handNumber,
      byFold: false,
      winners: this.winners,
      potBreakdowns,
      totalPot: this.pot
    };
  }

  getPublicState(options = {}) {
    const revealAll = options.revealAllCards ?? this.revealAllCards;
    const isShowdown = this.street === STREETS.SHOWDOWN;
    const legalActions = this.getLegalActions(this.actionSeatIndex);

    // Highlight winning 5 cards during showdown
    const winningCardCodes = new Set();
    if (isShowdown && this.winners.length > 0) {
      for (const w of this.winners) {
        for (const code of w.bestFiveCodes || []) {
          winningCardCodes.add(code);
        }
      }
    }

    const hasHumanSeat = this.seats.some(s => s.isHuman && s.enabled);

    return {
      tableId: this.tableId,
      tableName: this.tableName,
      mode: this.mode,
      description: this.description,
      hasHumanSeat,
      handNumber: this.handNumber,
      handStartedAt: this.handStartedAt,
      shoeId: this.shoeId || '',
      deckHash: this.deckHash || '',
      street: this.street,
      streetNameZh: STREET_NAMES_ZH[this.street] || this.street,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      ante: this.ante,
      dealerSeatIndex: this.dealerSeatIndex,
      smallBlindSeatIndex: this.smallBlindSeatIndex,
      bigBlindSeatIndex: this.bigBlindSeatIndex,
      actionSeatIndex: this.actionSeatIndex,
      currentBet: this.currentBet,
      minRaiseDelta: this.minRaiseDelta,
      pot: this.pot,
      pots: this.pots,
      communityCards: this.communityCards.map(c => ({
        ...c,
        isWinningCard: winningCardCodes.has(c.code)
      })),
      revealAllCards: revealAll,
      legalActions,
      winners: this.winners,
      handSummary: this.handSummary,
      seats: this.seats.map(s => {
        const shouldRevealSeatCards =
          s.isHuman ||
          revealAll ||
          this.mode === 'spectate' ||
          (isShowdown && s.inHand && !s.folded);

        const visibleCards = shouldRevealSeatCards
          ? s.holeCards.map(c => ({
              ...c,
              hidden: false,
              isWinningCard: winningCardCodes.has(c.code)
            }))
          : s.holeCards.map(() => ({
              hidden: true,
              code: '??',
              display: '🂠'
            }));

        let currentHandEval = null;
        if (shouldRevealSeatCards && s.holeCards.length === 2) {
          const allVisible = [...s.holeCards, ...this.communityCards];
          currentHandEval = allVisible.length >= 5
            ? evaluateSevenCards(allVisible)
            : evaluatePartialHand(allVisible);
        }

        return {
          seatIndex: s.seatIndex,
          id: s.id,
          playerId: s.playerId || '',
          name: s.name,
          title: s.title || '',
          avatar: s.avatar,
          isHuman: s.isHuman,
          enabled: s.enabled,
          driverType: s.driverType,
          vendor: s.vendor,
          protocol: s.protocol,
          agent: s.agent,
          model: s.model,
          thinkingEffort: s.thinkingEffort || 'medium',
          persona: s.persona,
          hasCustomApiKey: Boolean(s.customApiKey),
          customBaseURL: s.customBaseURL || '',
          chips: s.chips,
          inHand: s.inHand,
          folded: s.folded,
          allIn: s.allIn,
          currentBet: s.currentBet,
          totalContribution: s.totalContribution,
          position: s.position,
          isDealer: s.seatIndex === this.dealerSeatIndex,
          isSmallBlind: s.seatIndex === this.smallBlindSeatIndex,
          isBigBlind: s.seatIndex === this.bigBlindSeatIndex,
          isTurn: s.seatIndex === this.actionSeatIndex && this.street !== STREETS.IDLE && this.street !== STREETS.SHOWDOWN,
          thinking: s.thinking,
          holeCards: visibleCards,
          handEvaluation: currentHandEval
            ? {
                category: currentHandEval.category,
                categoryNameZh: currentHandEval.categoryNameZh,
                descriptionZh: currentHandEval.descriptionZh,
                bestFiveCodes: currentHandEval.bestFiveCodes
              }
            : null,
          lastAction: s.lastAction,
          stats: s.stats
        };
      }),
      recentLogs: this.handLogs.slice(-60),
      actionHistory: this.actionHistory.slice(-40)
    };
  }
}
