// Built-in Web Audio API Casino Sound Effects Synthesizer
class CasinoSound {
  constructor() {
    this.enabled = true;
    this.ctx = null;
  }

  _init() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  tone(freq, duration = 0.08, type = 'sine', gainVal = 0.08, delay = 0) {
    if (!this.enabled) return;
    try {
      this._init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(gainVal, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // ignore audio errors
    }
  }

  deal() {
    this.tone(420, 0.06, 'triangle', 0.06, 0);
    this.tone(680, 0.05, 'sine', 0.04, 0.04);
  }

  chip() {
    this.tone(1450, 0.045, 'sine', 0.07, 0);
    this.tone(2180, 0.06, 'triangle', 0.05, 0.03);
  }

  check() {
    this.tone(150, 0.05, 'square', 0.06, 0);
    this.tone(130, 0.06, 'square', 0.05, 0.07);
  }

  fold() {
    this.tone(280, 0.09, 'sine', 0.05, 0);
    this.tone(190, 0.11, 'sine', 0.04, 0.04);
  }

  allIn() {
    this.tone(330, 0.22, 'sawtooth', 0.07, 0);
    this.tone(440, 0.25, 'triangle', 0.08, 0.05);
    this.tone(660, 0.32, 'sine', 0.09, 0.1);
  }

  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
      this.tone(f, 0.16, 'triangle', 0.08, idx * 0.07);
    });
  }
}

const sound = new CasinoSound();

let appState = null;
let aiStepTimer = null;
let spectateNextHandTimer = null;
let aiRequestInFlight = false;
let lastActionCount = 0;
let lastHandNumber = 0;

// Roster & Hall View State
let currentMainView = 'lobby'; // Default to QQ-Game-Hall-style All-Tables Lobby View ('lobby' | 'table')
let currentHallFilter = 'all';
let quickSeatTargetTableId = null;
let quickSeatSearch = '';

let currentRosterFilter = 'all';
let currentRosterSearch = '';
let selectedPlayerId = null;
let isCreatingNewPlayer = false;
let selectedEffortInEditor = 'medium';
let newTableSelectedPlayerIds = new Set();

// DOM Elements
const lobbyHallView = document.getElementById('lobbyHallView');
const tableViewport = document.getElementById('tableViewport');
const btnSwitchToLobby = document.getElementById('btnSwitchToLobby');
const btnSwitchToActiveTable = document.getElementById('btnSwitchToActiveTable');
const lobbyTablesCountBadge = document.getElementById('lobbyTablesCountBadge');
const activeTableShortLabel = document.getElementById('activeTableShortLabel');
const topbarTableCenterHud = document.getElementById('topbarTableCenterHud');
const topbarLobbyCenterHud = document.getElementById('topbarLobbyCenterHud');
const hudTotalTablesCount = document.getElementById('hudTotalTablesCount');
const hudTotalRosterCount = document.getElementById('hudTotalRosterCount');
const currentTableTitleFloating = document.getElementById('currentTableTitleFloating');
const hallTablesGrid = document.getElementById('hallTablesGrid');
const btnNewHandTop = document.getElementById('btnNewHand');
const tableTabsBar = document.getElementById('tableTabsBar');
const hudTableModeBadge = document.getElementById('hudTableModeBadge');
const btnToggleTableMode = document.getElementById('btnToggleTableMode');
const hudHandNumber = document.getElementById('hudHandNumber');
const hudStreetName = document.getElementById('hudStreetName');
const hudBlinds = document.getElementById('hudBlinds');
const tableSeatsCountBadge = document.getElementById('tableSeatsCountBadge');
const rosterTotalCountBadge = document.getElementById('rosterTotalCountBadge');
const historyCountBadge = document.getElementById('historyCountBadge');
const revealModeLabel = document.getElementById('revealModeLabel');
const audioModeLabel = document.getElementById('audioModeLabel');
const centerPotAmount = document.getElementById('centerPotAmount');
const sidePotsContainer = document.getElementById('sidePotsContainer');
const communityCardsRow = document.getElementById('communityCardsRow');
const tableStatusBanner = document.getElementById('tableStatusBanner');
const showdownBanner = document.getElementById('showdownBanner');
const showdownWinnerText = document.getElementById('showdownWinnerText');
const seatsContainer = document.getElementById('seatsContainer');

const dockRoleLabel = document.getElementById('dockRoleLabel');
const humanHandStrengthBadge = document.getElementById('humanHandStrengthBadge');
const humanPotOddsInfo = document.getElementById('humanPotOddsInfo');
const chkAutoAiStep = document.getElementById('chkAutoAiStep');
const chkAutoNextHandSpectate = document.getElementById('chkAutoNextHandSpectate');
const spectatorDockBar = document.getElementById('spectatorDockBar');
const spectatorStatusText = document.getElementById('spectatorStatusText');
const humanActionControls = document.getElementById('humanActionControls');

const btnActFold = document.getElementById('btnActFold');
const btnActCheckCall = document.getElementById('btnActCheckCall');
const checkCallTitle = document.getElementById('checkCallTitle');
const checkCallSub = document.getElementById('checkCallSub');
const btnActRaise = document.getElementById('btnActRaise');
const raiseTitle = document.getElementById('raiseTitle');
const raiseSub = document.getElementById('raiseSub');
const btnActAllIn = document.getElementById('btnActAllIn');
const allInTitle = document.getElementById('allInTitle');
const allInSub = document.getElementById('allInSub');
const raiseSlider = document.getElementById('raiseSlider');
const raiseInputNumber = document.getElementById('raiseInputNumber');

const telemetryDrawer = document.getElementById('telemetryDrawer');
const handLogList = document.getElementById('handLogList');
const reasoningFeed = document.getElementById('reasoningFeed');
const guardrailRulesBox = document.getElementById('guardrailRulesBox');
const guardrailAuditList = document.getElementById('guardrailAuditList');
const chkShowLiveReasoning = document.getElementById('chkShowLiveReasoning');

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPlayingCardHtml(card, sizeClass = '') {
  if (!card || card.hidden) {
    return `<div class="playing-card card-back ${sizeClass}"></div>`;
  }
  const suitClass = `suit-${card.suit}`;
  const winClass = card.isWinningCard ? 'winning-card' : '';
  return `
    <div class="playing-card ${suitClass} ${sizeClass} ${winClass}" title="${escapeHtml(card.display)}">
      <div class="card-corner-top">
        <span class="card-rank">${escapeHtml(card.label)}</span>
        <span class="card-suit-mini">${escapeHtml(card.suitSymbol)}</span>
      </div>
      <div class="card-center-pip">${escapeHtml(card.suitSymbol)}</div>
      <div class="card-corner-bottom">${escapeHtml(card.suitSymbol)}</div>
    </div>
  `;
}

const COMPACT_VENDOR_TAGS = {
  deepseek: 'DeepSeek',
  'zhipu-token-plan': '智谱GLM',
  kimi: 'Kimi',
  gpt: 'GPT',
  zenmux: 'ZenMux'
};

const COMPACT_AGENT_TAGS = {
  codex: 'Codex',
  gemini: 'Gemini',
  'claude-code': 'Claude',
  pi: 'Pi',
  opencode2: 'OpenCode2'
};

const EFFORT_SHORT_LABELS = {
  low: '⚡Low',
  medium: '🧠Med',
  high: '🔥High',
  max: '🌌Max'
};

function getCompactEngineBadge(seat) {
  if (seat.isHuman) return '人类';
  if (seat.driverType === 'agent') {
    return COMPACT_AGENT_TAGS[seat.agent] || seat.agent;
  }
  return COMPACT_VENDOR_TAGS[seat.vendor] || seat.vendor;
}

function getFullSeatTooltip(seat) {
  if (seat.isHuman) return `${seat.name} · 人类玩家`;
  const vName = COMPACT_VENDOR_TAGS[seat.vendor] || seat.vendor;
  const effort = EFFORT_SHORT_LABELS[seat.thinkingEffort] || '🧠Med';
  if (seat.driverType === 'agent') {
    const aName = COMPACT_AGENT_TAGS[seat.agent] || seat.agent;
    return `${seat.name} (${seat.title || 'AI'}) ｜ Agent: ${aName} ｜ 厂商: ${vName} ｜ 模型: ${seat.model || '默认'} ｜ 思考: ${effort}`;
  }
  return `${seat.name} (${seat.title || 'AI'}) ｜ 厂商: ${vName} (${(seat.protocol || 'openai').toUpperCase()}) ｜ 模型: ${seat.model || '默认'} ｜ 思考: ${effort}`;
}

function getCompactActionLabel(lastAct) {
  if (!lastAct) return '';
  const map = {
    fold: '弃牌',
    check: '过牌',
    call: '跟注',
    raise: '加注',
    all_in: 'ALL-IN',
    sb: '小盲',
    bb: '大盲'
  };
  return map[lastAct.action] || lastAct.action.toUpperCase();
}

function playSoundForLastAction(game) {
  if (game.handNumber !== lastHandNumber && game.handNumber > 0) {
    lastHandNumber = game.handNumber;
    lastActionCount = 0;
    sound.deal();
    return;
  }
  const hist = game.actionHistory || [];
  if (hist.length > lastActionCount) {
    const latest = hist[hist.length - 1];
    lastActionCount = hist.length;
    if (latest) {
      if (latest.action === 'fold') sound.fold();
      else if (latest.action === 'check') sound.check();
      else if (latest.action === 'all_in') sound.allIn();
      else sound.chip();
    }
  }
  if (game.street === 'showdown' && game.winners?.length) {
    sound.win();
  }
}

function switchMainView(mode) {
  currentMainView = mode === 'table' ? 'table' : 'lobby';
  const isLobby = currentMainView === 'lobby';
  lobbyHallView.classList.toggle('hidden', !isLobby);
  tableViewport.classList.toggle('hidden', isLobby);
  btnSwitchToLobby.classList.toggle('active', isLobby);
  btnSwitchToActiveTable.classList.toggle('active', !isLobby);
  topbarLobbyCenterHud.classList.toggle('hidden', !isLobby);
  topbarTableCenterHud.classList.toggle('hidden', isLobby);
  btnNewHandTop.classList.toggle('hidden', isLobby);
  if (appState) {
    renderApp(appState);
  }
}

function renderHallView(state) {
  const tables = state.tables || [];
  lobbyTablesCountBadge.textContent = `${tables.length}`;
  hudTotalTablesCount.textContent = `${tables.length} 张`;
  hudTotalRosterCount.textContent = `${(state.roster || []).length} 位`;
  const totalHandsEl = document.getElementById('hudTotalHandsRecorded');
  const totalHandsCount = state.totalRecordedHandsCount ?? (state.recentHandRecords || []).length;
  if (totalHandsEl) {
    totalHandsEl.textContent = `已落库 ${totalHandsCount} 手`;
  }
  const lvLabel = document.getElementById('lasVegasModeLabel');
  if (lvLabel) {
    lvLabel.textContent = state.lasVegasLiveMode ? '开启中' : '已暂停';
  }

  const filteredTables = tables.filter(t => {
    if (currentHallFilter === 'spectate') return t.mode === 'spectate' || t.humanCount === 0;
    if (currentHallFilter === 'play') return t.mode === 'play' && t.humanCount > 0;
    if (currentHallFilter === 'open') return t.seatCount < 9;
    if (currentHallFilter === 'high') return t.bigBlind >= 50;
    return true;
  });

  const cardsHtml = filteredTables
    .map(t => {
      const isSpectate = t.mode === 'spectate' || t.humanCount === 0;
      const isCurrentActive = t.id === state.activeTableId;
      const maxSlotsToShow = Math.max(6, Math.min(9, t.seatCount + 2));
      const seatByIdx = new Map((t.playersPreview || []).map((p, idx) => [idx, p]));

      let chairsHtml = '';
      for (let slot = 0; slot < maxSlotsToShow; slot++) {
        const p = seatByIdx.get(slot);
        if (p) {
          const subTag = p.isHuman
            ? '人类玩家'
            : (p.driverType === 'agent' ? (COMPACT_AGENT_TAGS[p.agent] || p.agent) : (COMPACT_VENDOR_TAGS[p.vendor] || p.vendor));
          const turnBadge = p.isTurn ? '⚡ ' : (p.folded ? '🏳️ ' : '');
          chairsHtml += `
            <div class="hall-chair chair-slot-${slot} ${p.isHuman ? 'human-chair' : ''}" ${p.isTurn ? 'style="border-color:#facc15;box-shadow:0 0 10px rgba(250,204,21,0.45);"' : ''} data-hall-inspect-player="${escapeHtml(p.playerId || '')}" data-hall-table="${escapeHtml(t.id)}" title="点击查看牌手【${escapeHtml(p.name)}】详情 (${escapeHtml(subTag)}) · 筹码 $${p.chips}">
              <div class="chair-avatar">${escapeHtml(p.avatar)}</div>
              <div class="chair-text">
                <span class="chair-name">${turnBadge}${escapeHtml(p.name)}</span>
                <span class="chair-sub">${escapeHtml(subTag)} · $${p.chips}</span>
              </div>
            </div>
          `;
        } else {
          chairsHtml += `
            <div class="hall-chair empty-chair chair-slot-${slot}" data-hall-empty-seat="${escapeHtml(t.id)}" title="点击空座从 26+ 牌手库派遣 AI 牌手入座">
              <span>💺 ➕ 空座</span>
            </div>
          `;
        }
      }

      const isTablePaused = Boolean(t.paused) || (!state.lasVegasLiveMode && isSpectate);
      const statusLine = isTablePaused
        ? `⏸️ 已停止运行 · 在座 ${t.seatCount}/9 人`
        : t.street === 'idle'
          ? `🟢 等待发牌 · 在座 ${t.seatCount}/9 人`
          : t.street === 'showdown'
            ? `🏆 第 #${t.handNumber} 手结算 · 底池 $${t.pot}`
            : `🔥 第 #${t.handNumber} 手 (${t.street.toUpperCase()}) · 底池 $${t.pot}`;

      const boardPreviewHtml = (t.communityCards && t.communityCards.length)
        ? `<div style="margin:2px 0;transform:scale(0.88);">${renderMiniCardChipsHtml(t.communityCards)}</div>`
        : (t.street !== 'idle'
            ? `<div style="font-size:10px;color:#93c5fd;">🂠 🂠 翻牌前博弈中 (${escapeHtml(t.shoeId || '随机牌靴')})</div>`
            : `<div style="font-size:10px;color:#64748b;">点击进桌立即加密洗牌发牌</div>`);

      return `
        <div class="hall-table-unit ${isCurrentActive ? 'active-table-unit' : ''}" data-hall-unit="${escapeHtml(t.id)}">
          <div class="hall-unit-top">
            <span class="hall-unit-title">${escapeHtml(t.name)}</span>
            <div class="hall-unit-badges">
              ${t.shoeId ? `<span class="pill-mini" style="background:rgba(139,92,246,0.2);color:#c4b5fd;font-family:monospace;" title="当前独立加密随机牌靴 SHA-256: ${escapeHtml(t.deckHash || '')}">🎲 ${escapeHtml(t.shoeId.replace('shoe-', '#'))}</span>` : ''}
              <span class="pill-mini ${isSpectate ? 'pill-vendor' : 'pill-proto'}">${isSpectate ? '👁️ 纯AI观战' : '🎮 人机对战'}</span>
              <span class="pill-mini pill-effort">盲注 ${t.smallBlind}/${t.bigBlind}</span>
              ${
                tables.length > 1
                  ? `<button class="btn-seat-gear" data-hall-delete-table="${escapeHtml(t.id)}" title="删除该牌桌">🗑️</button>`
                  : ''
              }
            </div>
          </div>

          <div class="hall-mini-table-stage">
            ${chairsHtml}
            <div class="hall-mini-felt ${isSpectate ? 'spectate-felt' : ''}">
              <div class="hall-felt-status">${escapeHtml(statusLine)}</div>
              ${boardPreviewHtml}
              <div class="hall-felt-actions">
                <button class="btn-hall-enter enter-spectate" data-hall-enter-spectate="${escapeHtml(t.id)}">
                  👁️ 进桌观战
                </button>
                <button class="btn-hall-enter enter-play" data-hall-enter-play="${escapeHtml(t.id)}">
                  👑 入座参战
                </button>
              </div>
            </div>
          </div>

          <div class="hall-unit-footer">
            <span class="hall-unit-desc" title="${escapeHtml(t.description)}">${escapeHtml(t.description || '点击椅子可随时增加 AI 牌手')}</span>
            <div style="display:flex;gap:6px;align-items:center;">
              <button class="btn btn-xs btn-glass" data-hall-toggle-stop="${escapeHtml(t.id)}" data-currently-paused="${t.paused ? '1' : '0'}" style="${t.paused ? 'color:#86efac;border-color:rgba(134,239,172,0.5);' : 'color:#fca5a5;border-color:rgba(252,165,165,0.45);'}">
                ${t.paused ? '▶️ 恢复此桌' : '⏸️ 停止此桌'}
              </button>
              <button class="btn btn-xs btn-glass" data-hall-add-ai="${escapeHtml(t.id)}">➕ 加 AI 入座</button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  const addNewCardHtml = `
    <div id="cardHallCreateNewTable" class="hall-add-table-card">
      <div style="font-size:36px;">➕</div>
      <div style="font-size:15px;font-weight:900;">新增自定义游戏牌桌</div>
      <div style="font-size:12px;color:#94a3b8;max-width:240px;text-align:center;">
        支持自定义盲注级别、初始筹码，并从 26+ 位 AI 牌手中自由点将组局
      </div>
    </div>
  `;

  hallTablesGrid.innerHTML = cardsHtml + addNewCardHtml;

  // Bind Hall Actions
  document.getElementById('cardHallCreateNewTable')?.addEventListener('click', () => {
    document.getElementById('btnOpenNewTableModal').click();
  });

  hallTablesGrid.querySelectorAll('[data-hall-enter-spectate]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const tid = btn.dataset.hallEnterSpectate;
      await enterTableFromHall(tid, 'spectate');
    });
  });

  hallTablesGrid.querySelectorAll('[data-hall-enter-play]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const tid = btn.dataset.hallEnterPlay;
      await enterTableFromHall(tid, 'play');
    });
  });

  hallTablesGrid.querySelectorAll('[data-hall-empty-seat], [data-hall-add-ai]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const tid = el.dataset.hallEmptySeat || el.dataset.hallAddAi;
      openQuickSeatModal(tid);
    });
  });

  hallTablesGrid.querySelectorAll('[data-hall-inspect-player]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const pid = el.dataset.hallInspectPlayer;
      if (pid && pid !== 'human-player') {
        openRosterModalWithPlayer(pid);
      } else {
        enterTableFromHall(el.dataset.hallTable, 'play');
      }
    });
  });

  hallTablesGrid.querySelectorAll('[data-hall-toggle-stop]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const tid = btn.dataset.hallToggleStop;
      const isPaused = btn.dataset.currentlyPaused === '1';
      const res = await fetch('/api/tables/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId: tid, paused: !isPaused })
      });
      if (res.ok) {
        const data = await res.json();
        renderApp(data);
      }
    });
  });

  hallTablesGrid.querySelectorAll('[data-hall-delete-table]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const tid = btn.dataset.hallDeleteTable;
      const res = await fetch('/api/tables/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId: tid })
      });
      const data = await res.json();
      if (res.ok) renderApp(data);
    });
  });
}

async function enterTableFromHall(tableId, desiredMode = '') {
  clearTimeout(aiStepTimer);
  clearTimeout(spectateNextHandTimer);
  aiRequestInFlight = false;

  const selRes = await fetch('/api/tables/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId })
  });
  let stateData = await selRes.json();

  if (desiredMode === 'play' || desiredMode === 'spectate') {
    const curEffectiveMode = (stateData?.game?.mode === 'spectate' || !stateData?.game?.hasHumanSeat)
      ? 'spectate'
      : 'play';
    if (curEffectiveMode !== desiredMode) {
      const res = await fetch('/api/tables/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, mode: desiredMode })
      });
      if (res.ok) {
        stateData = await res.json();
      }
    }
  }

  appState = stateData;
  // If the table is currently idle, immediately deal a fresh cryptographically random hand
  if (appState?.game?.street === 'idle') {
    const dealRes = await fetch('/api/game/new-hand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableId })
    });
    if (dealRes.ok) {
      appState = await dealRes.json();
    }
  }

  lastHandNumber = appState.game.handNumber;
  lastActionCount = (appState.game.actionHistory || []).length;
  switchMainView('table');

  // If entering in spectate mode, open the right drawer on the AI Thinking tab by default so user immediately sees AI thoughts
  const isSpectateNow = appState.game.mode === 'spectate' || !appState.game.hasHumanSeat;
  if (isSpectateNow && telemetryDrawer.classList.contains('hidden')) {
    telemetryDrawer.classList.remove('hidden');
    document.querySelectorAll('.sidebar-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'tabReasoning'));
    document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.toggle('active', p.id === 'tabReasoning'));
  }
}

function renderTableTabs(state) {
  const tables = state.tables || [];
  const activeId = state.activeTableId;
  tableTabsBar.innerHTML = tables
    .map(t => {
      const isActive = t.id === activeId;
      return `
        <button class="table-tab-btn ${isActive ? 'active' : ''}" data-select-table="${escapeHtml(t.id)}" title="${escapeHtml(t.description || t.name)}">
          <span>${escapeHtml(t.name)}</span>
          <span class="table-tab-count">${t.seatCount}人</span>
        </button>
      `;
    })
    .join('');

  tableTabsBar.querySelectorAll('[data-select-table]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectTable(btn.dataset.selectTable);
      if (currentMainView === 'lobby') {
        switchMainView('table');
      }
    });
  });
}

function renderApp(state) {
  appState = state;
  const { game, agentGuardrail } = state;
  playSoundForLastAction(game);

  renderTableTabs(state);
  renderHallView(state);

  activeTableShortLabel.textContent = game.tableName;
  if (currentTableTitleFloating) {
    currentTableTitleFloating.textContent = `${game.tableName} (${game.mode === 'spectate' ? '👁️ 纯AI观战' : '🎮 人机参战'})`;
  }

  const isSpectate = game.mode === 'spectate' || !game.hasHumanSeat;
  hudTableModeBadge.textContent = isSpectate ? '👁️ 纯AI观战' : '🎮 人机参战';
  btnToggleTableMode.classList.toggle('mode-spectate', isSpectate);

  // Top HUD
  hudHandNumber.textContent = `#${game.handNumber}`;
  hudStreetName.textContent = game.streetNameZh.replace(/\s*\(.*?\)/, '');
  hudBlinds.textContent = `${game.smallBlind}/${game.bigBlind}${game.ante ? `+${game.ante}` : ''}`;
  const shoeBadgeEl = document.getElementById('hudShoeBadge');
  if (shoeBadgeEl) {
    shoeBadgeEl.textContent = game.shoeId ? game.shoeId.replace('shoe-', '#') : '待洗牌';
    shoeBadgeEl.title = game.deckHash
      ? `本局独立 CSPRNG 随机牌靴: ${game.shoeId} ｜ SHA-256: ${game.deckHash}`
      : '发牌后生成唯一加密牌靴签名';
  }
  revealModeLabel.textContent = (game.revealAllCards || isSpectate) ? '明牌' : '暗牌';
  centerPotAmount.textContent = `$${game.pot.toLocaleString()}`;

  const enabledSeats = game.seats.filter(s => s.enabled);
  tableSeatsCountBadge.textContent = `${enabledSeats.length}`;
  rosterTotalCountBadge.textContent = `${(state.roster || []).length}`;
  historyCountBadge.textContent = `${state.totalRecordedHandsCount ?? (state.recentHandRecords || []).length}`;
  const allAiActionsInHand = (game.actionHistory || []).filter(a => !a.isHuman);
  const thinkingBadgeEl = document.getElementById('thinkingActionsCountBadge');
  if (thinkingBadgeEl) {
    thinkingBadgeEl.textContent = `${allAiActionsInHand.length}`;
  }

  // Side Pots
  if (game.pots && game.pots.length > 1) {
    sidePotsContainer.innerHTML = game.pots
      .map(p => `<span class="side-pot-pill">${escapeHtml(p.name.replace(/\s*\(.*?\)/, ''))}: <strong>$${p.amount}</strong></span>`)
      .join('');
  } else {
    sidePotsContainer.innerHTML = '';
  }

  // 5 Community Cards
  let commHtml = '';
  for (let i = 0; i < 5; i++) {
    const c = game.communityCards[i];
    if (c) {
      commHtml += renderPlayingCardHtml(c, '');
    } else {
      commHtml += `<div class="card-placeholder">♠</div>`;
    }
  }
  communityCardsRow.innerHTML = commHtml;

  // Center Status & Showdown Winner Banner
  const winnerSeatSet = new Set((game.winners || []).map(w => w.seatIndex));
  if (game.street === 'idle') {
    tableStatusBanner.classList.remove('hidden');
    tableStatusBanner.textContent = isSpectate
      ? '👁️ 纯 AI 观战桌就绪 · 点击「🃏 发牌」或开启「自动连发观战」欣赏 AI 巅峰对决'
      : '点击顶部「🃏 发牌」或按 [Space] 开始新牌局';
    showdownBanner.classList.add('hidden');
  } else if (game.street === 'showdown') {
    tableStatusBanner.classList.add('hidden');
    showdownBanner.classList.remove('hidden');
    const winSummary = (game.winners || [])
      .map(w => `🏆 ${escapeHtml(w.playerName)} 赢得 $${w.amountWon}（${escapeHtml(w.handDescription)}）`)
      .join(' ｜ ');
    showdownWinnerText.innerHTML = winSummary || '本手牌结算完成（已存入 SQLite 数据库）';
  } else {
    showdownBanner.classList.add('hidden');
    tableStatusBanner.classList.remove('hidden');
    const activeSeat = game.seats[game.actionSeatIndex];
    if (activeSeat) {
      tableStatusBanner.innerHTML = activeSeat.isHuman
        ? `👉 轮到你行动 ${game.legalActions.toCall > 0 ? `（需跟注 $${game.legalActions.toCall}）` : '（可免费过牌）'}`
        : `⚡ 轮到 <strong>${escapeHtml(activeSeat.name)}</strong> (${escapeHtml(getCompactEngineBadge(activeSeat))} · ${escapeHtml(EFFORT_SHORT_LABELS[activeSeat.thinkingEffort] || '🧠Med')}) 思考中...`;
    }
  }

  // Seats around the oval table (up to 9 seats)
  seatsContainer.innerHTML = enabledSeats
    .map((seat, visualIdx) => {
      const posSlot = visualIdx % 9;
      const isTurn = seat.isTurn;
      const isThinking = seat.thinking || (isTurn && !seat.isHuman && aiRequestInFlight);
      const isFolded = seat.folded;
      const isWinner = winnerSeatSet.has(seat.seatIndex);
      const tagClass = seat.isHuman ? 'tag-human' : (seat.driverType === 'agent' ? 'tag-agent' : 'tag-vendor');
      const engineBadge = getCompactEngineBadge(seat);
      const tooltip = getFullSeatTooltip(seat);
      const cardSize = seat.isHuman ? 'human-card' : 'sm';

      const cardsHtml = seat.holeCards && seat.holeCards.length
        ? `<div class="seat-cards-floating">${seat.holeCards.map(c => renderPlayingCardHtml(c, cardSize)).join('')}</div>`
        : '';

      const lastAct = seat.lastAction;
      const showReasoningNow = chkShowLiveReasoning.checked || game.revealAllCards || isSpectate || game.street === 'showdown';
      const talkBubble = lastAct?.tableTalk
        ? `<div class="table-talk-bubble" ${!seat.isHuman ? `data-open-thinking="${seat.seatIndex}" style="cursor:pointer;" title="点击查看【${escapeHtml(seat.name)}】的完整思考推演与决策细节"` : ''}>💬 “${escapeHtml(lastAct.tableTalk)}”</div>`
        : '';

      const thoughtSnippetHtml = (!seat.isHuman && lastAct?.reasoning && showReasoningNow)
        ? `<div class="seat-thought-pill" data-open-thinking="${seat.seatIndex}" title="点击查看完整思考：${escapeHtml(lastAct.reasoning)}">🧠 ${escapeHtml(lastAct.reasoning)}</div>`
        : '';

      const posLabel = seat.isDealer ? 'D' : (seat.position || '');
      const posPuckHtml = posLabel
        ? `<span class="pos-puck ${seat.isDealer ? 'is-dealer' : ''}">${escapeHtml(posLabel)}</span>`
        : '';

      let statusStampHtml = '';
      if (isThinking) {
        statusStampHtml = `<span class="action-stamp act-thinking">⚡${escapeHtml(EFFORT_SHORT_LABELS[seat.thinkingEffort] || '思考')}</span>`;
      } else if (seat.allIn) {
        statusStampHtml = `<span class="action-stamp act-all_in">ALL-IN</span>`;
      } else if (lastAct) {
        statusStampHtml = `<span class="action-stamp act-${escapeHtml(lastAct.action)}">${escapeHtml(getCompactActionLabel(lastAct))}</span>`;
      }

      const feltBetChipHtml = seat.currentBet > 0
        ? `<div class="seat-bet-on-felt">🪙 $${seat.currentBet}</div>`
        : '';

      return `
        <div class="seat-pod seat-pos-${posSlot} ${seat.isHuman ? 'seat-human' : ''} ${isTurn ? 'active-turn' : ''} ${isThinking ? 'is-thinking' : ''} ${isFolded ? 'is-folded' : ''} ${isWinner ? 'is-winner' : ''}" title="${escapeHtml(tooltip)}" data-seat-pod="${seat.seatIndex}">
          ${talkBubble}
          ${feltBetChipHtml}
          ${cardsHtml}

          <div class="seat-capsule">
            <div class="seat-avatar-ring">
              <span>${escapeHtml(seat.avatar)}</span>
              ${posPuckHtml}
            </div>

            <div class="seat-info-col">
              <div class="seat-title-line">
                <span class="seat-player-name">${escapeHtml(seat.name)}</span>
                <span class="engine-tag ${tagClass}">${escapeHtml(engineBadge)}</span>
              </div>
              <div class="seat-stack-line">
                <span class="seat-chips-val">$${seat.chips.toLocaleString()}</span>
                ${statusStampHtml}
              </div>
            </div>

            ${
              !seat.isHuman
                ? `<button class="btn-seat-brain" data-open-thinking="${seat.seatIndex}" title="点击查看【${escapeHtml(seat.name)}】的思考过程、赔率计算与 Prompt 细节">🧠</button>`
                : ''
            }
            <button class="btn-seat-gear" data-open-seat="${seat.seatIndex}" title="点击查看/编辑该牌手详情">⚙️</button>
          </div>
          ${thoughtSnippetHtml}
        </div>
      `;
    })
    .join('');

  seatsContainer.querySelectorAll('[data-open-thinking]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const sIdx = Number(el.dataset.openThinking);
      openAiThinkingModal(sIdx);
    });
  });

  seatsContainer.querySelectorAll('[data-open-seat]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const sIdx = Number(btn.dataset.openSeat);
      const seat = game.seats[sIdx];
      if (seat && seat.playerId && seat.playerId !== 'human-player') {
        openRosterModalWithPlayer(seat.playerId);
      } else {
        openTableSeatsModal();
      }
    });
  });

  // Toggle between Spectator Dock Bar and Human Action Controls
  const humanSeat = game.seats.find(s => s.isHuman && s.enabled);
  if (isSpectate || !humanSeat) {
    spectatorDockBar.classList.remove('hidden');
    humanActionControls.classList.add('hidden');
    dockRoleLabel.textContent = '观战焦点';
    const turnSeat = game.seats[game.actionSeatIndex];
    if (turnSeat && turnSeat.handEvaluation) {
      humanHandStrengthBadge.textContent = `${turnSeat.name}: ${turnSeat.handEvaluation.descriptionZh.replace(/\s*\(.*?\)/, '')}`;
      humanPotOddsInfo.textContent = `思考强度: ${EFFORT_SHORT_LABELS[turnSeat.thinkingEffort] || '标准'}`;
    } else {
      humanHandStrengthBadge.textContent = `${enabledSeats.length} 位 AI 在座`;
      humanPotOddsInfo.textContent = '全明牌上帝视角';
    }
    spectatorStatusText.textContent = game.street === 'idle' || game.street === 'showdown'
      ? `本桌共 ${enabledSeats.length} 位 AI 牌手 · 点击「▶️ 发观战牌」或开启「自动连发观战」`
      : `正在实时观战第 #${game.handNumber} 手牌 (${game.streetNameZh})`;
  } else {
    spectatorDockBar.classList.add('hidden');
    humanActionControls.classList.remove('hidden');
    dockRoleLabel.textContent = '我的牌型';
    if (humanSeat.handEvaluation) {
      humanHandStrengthBadge.textContent = humanSeat.handEvaluation.descriptionZh.replace(/\s*\(.*?\)/, '');
    } else {
      humanHandStrengthBadge.textContent = '等待发牌';
    }

    const legal = game.legalActions;
    if (humanSeat.isTurn && legal.canAct) {
      humanActionControls.classList.remove('disabled');
      const potAfterCall = game.pot + legal.callAmount;
      const odds = legal.callAmount > 0 && potAfterCall > 0
        ? `赔率 ${((legal.callAmount / potAfterCall) * 100).toFixed(0)}% (跟 $${legal.callAmount})`
        : '可免费看牌';
      humanPotOddsInfo.textContent = odds;

      btnActFold.disabled = !legal.canFold;
      btnActCheckCall.disabled = !(legal.canCheck || legal.canCall);
      if (legal.canCheck) {
        checkCallTitle.textContent = '过牌';
        checkCallSub.textContent = 'CHECK [C]';
        btnActCheckCall.dataset.mode = 'check';
      } else {
        checkCallTitle.textContent = `跟注 $${legal.callAmount}`;
        checkCallSub.textContent = 'CALL [C]';
        btnActCheckCall.dataset.mode = 'call';
      }

      btnActRaise.disabled = !legal.canRaise;
      if (legal.canRaise) {
        raiseSlider.min = legal.minRaiseTo;
        raiseSlider.max = legal.maxRaiseTo;
        raiseSlider.step = Math.max(1, game.smallBlind);
        const currentVal = Number(raiseInputNumber.value);
        const clampedVal = (currentVal >= legal.minRaiseTo && currentVal <= legal.maxRaiseTo)
          ? currentVal
          : legal.minRaiseTo;
        raiseSlider.value = clampedVal;
        raiseInputNumber.min = legal.minRaiseTo;
        raiseInputNumber.max = legal.maxRaiseTo;
        raiseInputNumber.value = clampedVal;
        raiseTitle.textContent = game.currentBet === 0 ? '下注' : '加注';
        raiseSub.textContent = `$${clampedVal} [R]`;
      } else {
        raiseTitle.textContent = '加注';
        raiseSub.textContent = '不可用';
      }

      btnActAllIn.disabled = !legal.canAllIn;
      allInTitle.textContent = '全下';
      allInSub.textContent = `$${legal.allInAmount} [A]`;
    } else {
      humanActionControls.classList.add('disabled');
      btnActFold.disabled = true;
      btnActCheckCall.disabled = true;
      btnActRaise.disabled = true;
      btnActAllIn.disabled = true;
      humanPotOddsInfo.textContent = '';
    }
  }

  // Right Drawer Tab 1: Hand Logs
  handLogList.innerHTML = (game.recentLogs || [])
    .slice()
    .reverse()
    .map(item => {
      const isHeader = item.message.includes('===') || item.message.includes('发出') || item.message.includes('🏆');
      return `<div class="log-item ${isHeader ? 'street-header' : ''}">${escapeHtml(item.message)}</div>`;
    })
    .join('');

  // Right Drawer Tab 2: AI Reasoning Feed
  const showReasoning = chkShowLiveReasoning.checked || game.revealAllCards || isSpectate || game.street === 'showdown';
  const aiActions = (game.actionHistory || []).filter(a => !a.isHuman).slice().reverse();
  if (!aiActions.length) {
    reasoningFeed.innerHTML = `<div class="log-item">尚无 AI 决策记录。发牌后每位 AI 行动的推理、赔率与思维链将实时展示于此。</div>`;
  } else {
    reasoningFeed.innerHTML = aiActions
      .map(a => {
        const effortBadge = EFFORT_SHORT_LABELS[a.thinkingEffort] || '🧠Med';
        const thoughtText = showReasoning
          ? escapeHtml(a.reasoning || '稳健博弈决策')
          : '🔒 暗牌进行中（摊牌阶段或开启明牌后揭晓）';
        const ctx = a.decisionContext;
        const ctxBarHtml = (showReasoning && ctx)
          ? `<div style="font-size:10.5px;color:#93c5fd;margin-top:3px;display:flex;flex-wrap:wrap;gap:6px;">
              <span>🃏 底牌: <strong>${escapeHtml((ctx.holeCards || []).join(' ') || '--')}</strong></span>
              <span>｜ 牌力: <strong>${escapeHtml(ctx.handStrength || '评估中')}</strong></span>
              <span>｜ 赔率: <strong>${ctx.potOddsPercentage ?? 0}%</strong> (底池 $${ctx.pot ?? a.potAfter})</span>
            </div>`
          : '';
        return `
          <div class="reasoning-card">
            <div class="reasoning-card-top">
              <span class="reasoning-player">${escapeHtml(a.playerAvatar || '🤖')} ${escapeHtml(a.playerName)} (${escapeHtml(a.position)} · ${escapeHtml((a.street || '').toUpperCase())})</span>
              <span>
                <span class="mini-badge">${escapeHtml(effortBadge)}</span>
                <span class="mini-badge">${a.latencyMs || 0}ms</span>
                <button class="btn btn-xs btn-glass" data-drawer-open-thinking="${a.seatIndex}" style="padding:1px 7px;font-size:10px;">🔍 细节</button>
              </span>
            </div>
            <div class="reasoning-route">${escapeHtml(a.driverBadge || '')} · ${escapeHtml(a.label)}</div>
            ${ctxBarHtml}
            <div class="reasoning-body" style="margin-top:4px;">🧠 ${thoughtText}</div>
            ${(showReasoning && a.thinkingContent) ? `<div style="font-size:10.5px;color:#c4b5fd;margin-top:3px;">💭 思维链 CoT: ${escapeHtml(a.thinkingContent.slice(0, 90))}${a.thinkingContent.length > 90 ? '...' : ''}</div>` : ''}
            ${a.tableTalk ? `<div class="reasoning-talk">💬 “${escapeHtml(a.tableTalk)}”</div>` : ''}
          </div>
        `;
      })
      .join('');

    reasoningFeed.querySelectorAll('[data-drawer-open-thinking]').forEach(btn => {
      btn.addEventListener('click', () => {
        openAiThinkingModal(Number(btn.dataset.drawerOpenThinking));
      });
    });
  }

  // Right Drawer Tab 3: Agent Guardrail Monitor
  if (agentGuardrail?.rulesSummary) {
    guardrailRulesBox.innerHTML = agentGuardrail.rulesSummary
      .map(r => `<div class="guardrail-rule-pill"><strong>[${escapeHtml(r.id)}] ${escapeHtml(r.title)}：</strong>${escapeHtml(r.desc)}</div>`)
      .join('');
  }
  const audits = (agentGuardrail?.recentAuditLogs || []).slice().reverse();
  guardrailAuditList.innerHTML = audits.length
    ? audits.map(item => `
        <div class="reasoning-card">
          <div class="reasoning-card-top">
            <span class="reasoning-player">${escapeHtml(item.playerName)}</span>
            <span class="mini-badge ${item.guardrailAdjusted ? '' : 'badge-emerald'}">
              ${item.guardrailAdjusted ? '⚠️ 修正' : '✅ 合规'} · ${item.latencyMs}ms
            </span>
          </div>
          <div class="reasoning-route">${escapeHtml(item.routeLabel)}</div>
          <div class="reasoning-body">动作: <strong>${escapeHtml(item.action)}</strong> (${item.amount})</div>
          ${item.guardrailNotes?.length ? `<div style="color:#fcd34d;font-size:10.5px;">校准: ${escapeHtml(item.guardrailNotes.join('; '))}</div>` : ''}
        </div>
      `).join('')
    : `<div class="log-item">暂无 Agent 调用审计记录</div>`;

  // Refresh open modals if visible
  if (!document.getElementById('rosterModal').classList.contains('hidden')) {
    renderRosterHorizontalList();
    renderTableSeatsHorizontalList();
  }
  if (!document.getElementById('aiThinkingModal').classList.contains('hidden')) {
    renderAiThinkingModal();
  }

  scheduleAiStepIfNeeded();
  scheduleSpectateNextHandIfNeeded();
}

function scheduleAiStepIfNeeded() {
  clearTimeout(aiStepTimer);
  if (!appState || !chkAutoAiStep.checked || aiRequestInFlight) return;
  // When in Lobby Hall view, background tables are managed solely by the backend Las Vegas switch
  if (currentMainView === 'lobby') return;
  const { game } = appState;
  if (!game || game.paused || game.street === 'idle' || game.street === 'showdown') return;
  const activeSeat = game.seats[game.actionSeatIndex];
  if (!activeSeat || activeSeat.isHuman) return;

  aiStepTimer = setTimeout(() => {
    triggerAiStep();
  }, 480);
}

function scheduleSpectateNextHandIfNeeded() {
  clearTimeout(spectateNextHandTimer);
  if (!appState || !chkAutoNextHandSpectate.checked || aiRequestInFlight) return;
  if (currentMainView === 'lobby') return;
  const { game } = appState;
  if (!game || game.paused) return;
  if (game.street === 'idle' || game.street === 'showdown') {
    spectateNextHandTimer = setTimeout(() => {
      if (chkAutoNextHandSpectate.checked && !aiRequestInFlight && !appState?.game?.paused) {
        startNewHand();
      }
    }, 2200);
  }
}

async function triggerAiStep() {
  if (aiRequestInFlight) return;
  const requestedTableId = appState?.activeTableId;
  if (!requestedTableId) return;
  aiRequestInFlight = true;
  if (appState) renderApp(appState);
  try {
    const res = await fetch('/api/game/ai-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableId: requestedTableId })
    });
    const data = await res.json();
    aiRequestInFlight = false;
    if (res.ok && data.game) {
      // Guard against overwriting active table state if the user switched to another table while this step was in flight
      if (appState && appState.activeTableId && data.game.tableId !== appState.activeTableId) {
        appState.tables = data.tables || appState.tables;
        appState.totalRecordedHandsCount = data.totalRecordedHandsCount ?? appState.totalRecordedHandsCount;
        renderHallView(appState);
        renderTableTabs(appState);
        scheduleAiStepIfNeeded();
        return;
      }
      renderApp(data);
    }
  } catch {
    aiRequestInFlight = false;
  }
}

async function fetchInitialState() {
  const res = await fetch('/api/state');
  const data = await res.json();
  renderApp(data);
}

async function selectTable(tableId) {
  clearTimeout(aiStepTimer);
  clearTimeout(spectateNextHandTimer);
  aiRequestInFlight = false;
  const res = await fetch('/api/tables/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId })
  });
  let data = await res.json();
  if (res.ok) {
    if (data.game?.street === 'idle') {
      const dealRes = await fetch('/api/game/new-hand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId })
      });
      if (dealRes.ok) {
        data = await dealRes.json();
      }
    }
    lastHandNumber = data.game.handNumber;
    lastActionCount = (data.game.actionHistory || []).length;
    renderApp(data);
  }
}

async function toggleCurrentTableMode(forceMode = '') {
  if (!appState) return;
  const currentMode = appState.game.mode === 'spectate' ? 'spectate' : 'play';
  const nextMode = forceMode || (currentMode === 'spectate' ? 'play' : 'spectate');
  const res = await fetch('/api/tables/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tableId: appState.activeTableId,
      mode: nextMode
    })
  });
  const data = await res.json();
  if (res.ok) renderApp(data);
}

async function startNewHand() {
  const res = await fetch('/api/game/new-hand', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId: appState?.activeTableId })
  });
  const data = await res.json();
  if (res.ok) renderApp(data);
}

async function sendHumanAction(action, amount = 0) {
  const res = await fetch('/api/game/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tableId: appState?.activeTableId,
      action,
      amount
    })
  });
  const data = await res.json();
  if (res.ok) renderApp(data);
}

function updateRaiseAmount(newVal) {
  if (!appState) return;
  const legal = appState.game.legalActions;
  if (!legal.canRaise) return;
  const clamped = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.floor(Number(newVal) || legal.minRaiseTo)));
  raiseSlider.value = clamped;
  raiseInputNumber.value = clamped;
  raiseSub.textContent = `$${clamped} [R]`;
}

raiseSlider.addEventListener('input', () => updateRaiseAmount(raiseSlider.value));
raiseInputNumber.addEventListener('change', () => updateRaiseAmount(raiseInputNumber.value));

document.getElementById('btnRaiseMinus').addEventListener('click', () => {
  const step = appState?.game?.bigBlind || 20;
  updateRaiseAmount(Number(raiseInputNumber.value) - step);
});

document.getElementById('btnRaisePlus').addEventListener('click', () => {
  const step = appState?.game?.bigBlind || 20;
  updateRaiseAmount(Number(raiseInputNumber.value) + step);
});

document.querySelectorAll('.btn-quick-bet').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!appState) return;
    const { game } = appState;
    const legal = game.legalActions;
    if (!legal.canRaise) return;
    const mode = btn.dataset.sizing;
    const pot = game.pot + legal.callAmount;
    let target = legal.minRaiseTo;
    if (mode === 'min') target = legal.minRaiseTo;
    else if (mode === 'pot_33') target = legal.tableCurrentBet + Math.round(pot * 0.33);
    else if (mode === 'pot_50') target = legal.tableCurrentBet + Math.round(pot * 0.5);
    else if (mode === 'pot_66') target = legal.tableCurrentBet + Math.round(pot * 0.67);
    else if (mode === 'pot_100') target = legal.tableCurrentBet + pot;
    else if (mode === 'max') target = legal.maxRaiseTo;
    updateRaiseAmount(target);
  });
});

// Action button clicks
btnActFold.addEventListener('click', () => sendHumanAction('fold', 0));
btnActCheckCall.addEventListener('click', () => {
  const mode = btnActCheckCall.dataset.mode || 'check';
  const amt = appState?.game?.legalActions?.callAmount || 0;
  sendHumanAction(mode, amt);
});
btnActRaise.addEventListener('click', () => {
  sendHumanAction('raise', Number(raiseInputNumber.value));
});
btnActAllIn.addEventListener('click', () => {
  sendHumanAction('all_in', appState?.game?.legalActions?.allInAmount || 0);
});

// Topbar & Dock buttons
document.getElementById('btnNewHand').addEventListener('click', startNewHand);
document.getElementById('btnNextHandBanner').addEventListener('click', startNewHand);
document.getElementById('btnSpectateDealNext').addEventListener('click', startNewHand);
document.getElementById('btnManualAiStep').addEventListener('click', triggerAiStep);
btnToggleTableMode.addEventListener('click', () => toggleCurrentTableMode());
document.getElementById('btnJoinAsHuman').addEventListener('click', () => toggleCurrentTableMode('play'));

document.getElementById('btnQuickAddAiToTable').addEventListener('click', () => openRosterModalWithPlayer(null));
document.getElementById('btnSpectateAddAi').addEventListener('click', () => openRosterModalWithPlayer(null));
document.getElementById('btnOpenRosterModal').addEventListener('click', () => openRosterModalWithPlayer(null));
document.getElementById('btnOpenTableSeatsModal').addEventListener('click', () => openTableSeatsModal());

document.getElementById('btnToggleDrawer').addEventListener('click', () => {
  telemetryDrawer.classList.toggle('hidden');
});
document.getElementById('btnCloseDrawer').addEventListener('click', () => {
  telemetryDrawer.classList.add('hidden');
});

document.getElementById('btnRebuyAll').addEventListener('click', async () => {
  const res = await fetch('/api/game/rebuy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId: appState?.activeTableId, amount: appState?.game?.startingChips || 2000 })
  });
  const data = await res.json();
  if (res.ok) renderApp(data);
});

document.getElementById('btnToggleReveal').addEventListener('click', async () => {
  const res = await fetch('/api/game/toggle-reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId: appState?.activeTableId })
  });
  const data = await res.json();
  if (res.ok) renderApp(data);
});

document.getElementById('btnToggleAudio').addEventListener('click', () => {
  sound.enabled = !sound.enabled;
  audioModeLabel.textContent = sound.enabled ? '🔊' : '🔇';
  if (sound.enabled) sound.chip();
});

chkAutoAiStep.addEventListener('change', () => {
  if (chkAutoAiStep.checked) scheduleAiStepIfNeeded();
});

chkAutoNextHandSpectate.addEventListener('change', () => {
  if (chkAutoNextHandSpectate.checked) {
    if (appState?.game?.street === 'idle' || appState?.game?.street === 'showdown') {
      startNewHand();
    } else {
      scheduleSpectateNextHandIfNeeded();
    }
  } else {
    clearTimeout(spectateNextHandTimer);
  }
});

chkShowLiveReasoning.addEventListener('change', () => {
  if (appState) renderApp(appState);
});

// Sidebar Tabs
document.querySelectorAll('.sidebar-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab)?.classList.add('active');
  });
});

// Modals Management
function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

// ============================================================================
// Modal 1: AI Player Roster (Horizontal List + Click-for-Detail View) & Table Seats
// ============================================================================
function switchRosterModalView(viewId) {
  document.getElementById('tabBtnRosterView').classList.toggle('active', viewId === 'rosterView');
  document.getElementById('tabBtnTableSeatsView').classList.toggle('active', viewId === 'tableSeatsView');
  document.getElementById('rosterView').classList.toggle('hidden', viewId !== 'rosterView');
  document.getElementById('tableSeatsView').classList.toggle('hidden', viewId !== 'tableSeatsView');
}

document.getElementById('tabBtnRosterView').addEventListener('click', () => switchRosterModalView('rosterView'));
document.getElementById('tabBtnTableSeatsView').addEventListener('click', () => {
  switchRosterModalView('tableSeatsView');
  renderTableSeatsHorizontalList();
});
document.getElementById('btnSwitchToRosterToAdd').addEventListener('click', () => switchRosterModalView('rosterView'));

function openRosterModalWithPlayer(playerId = null) {
  if (!appState) return;
  switchRosterModalView('rosterView');
  isCreatingNewPlayer = false;
  const roster = appState.roster || [];
  if (playerId) {
    selectedPlayerId = playerId;
  } else if (!selectedPlayerId && roster.length) {
    selectedPlayerId = roster[0].id;
  }
  renderRosterHorizontalList();
  renderPlayerDetailPane();
  openModal('rosterModal');
}

function openTableSeatsModal() {
  if (!appState) return;
  switchRosterModalView('tableSeatsView');
  renderTableSeatsHorizontalList();
  openModal('rosterModal');
}

// Roster Filter & Search Bindings
document.querySelectorAll('#rosterFilterBar .filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#rosterFilterBar .filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentRosterFilter = chip.dataset.filter || 'all';
    renderRosterHorizontalList();
  });
});

document.getElementById('rosterSearchInput').addEventListener('input', e => {
  currentRosterSearch = (e.target.value || '').trim().toLowerCase();
  renderRosterHorizontalList();
});

document.getElementById('btnStartCreatePlayer').addEventListener('click', () => {
  isCreatingNewPlayer = true;
  selectedPlayerId = null;
  selectedEffortInEditor = 'high';
  renderRosterHorizontalList();
  renderPlayerDetailPane();
});

function renderRosterHorizontalList() {
  if (!appState) return;
  const roster = appState.roster || [];
  const game = appState.game;
  document.getElementById('modalRosterCount').textContent = `${roster.length}`;
  document.getElementById('modalTableSeatsCount').textContent = `${game.seats.filter(s => s.enabled).length}`;

  const seatedMap = new Map();
  game.seats.forEach(s => {
    if (s.enabled && s.playerId) {
      seatedMap.set(s.playerId, s.seatIndex);
    }
  });

  const filtered = roster.filter(p => {
    if (currentRosterFilter === 'vendor' && p.driverType !== 'vendor') return false;
    if (currentRosterFilter === 'agent' && p.driverType !== 'agent') return false;
    if (['deepseek', 'zhipu-token-plan', 'kimi', 'gpt', 'zenmux'].includes(currentRosterFilter) && p.vendor !== currentRosterFilter) {
      return false;
    }
    if (currentRosterSearch) {
      const hay = `${p.name} ${p.title} ${p.vendor} ${p.agent} ${p.model} ${p.persona}`.toLowerCase();
      if (!hay.includes(currentRosterSearch)) return false;
    }
    return true;
  });

  const listEl = document.getElementById('rosterHorizontalList');
  if (!filtered.length) {
    listEl.innerHTML = `<div class="empty-hint" style="padding:24px;">未找到匹配的 AI 牌手，可点击右上角「➕ 新增 AI 牌手」创建。</div>`;
    return;
  }

  listEl.innerHTML = filtered
    .map(p => {
      const isSelected = !isCreatingNewPlayer && p.id === selectedPlayerId;
      const seatedIdx = seatedMap.get(p.id);
      const isSeated = seatedIdx !== undefined;
      const winRate = p.handsPlayed > 0 ? `${Math.round((p.handsWon / p.handsPlayed) * 100)}%` : '0%';
      const netStr = p.totalNetChips >= 0 ? `+$${p.totalNetChips}` : `-$${Math.abs(p.totalNetChips)}`;
      const driverPill = p.driverType === 'agent'
        ? `<span class="pill-mini pill-agent">Agent · ${escapeHtml(COMPACT_AGENT_TAGS[p.agent] || p.agent)}</span>`
        : `<span class="pill-mini pill-vendor">${escapeHtml(COMPACT_VENDOR_TAGS[p.vendor] || p.vendor)}</span>`;
      const protoPill = `<span class="pill-mini pill-proto">${escapeHtml((p.protocol || 'openai').toUpperCase())}</span>`;
      const effortPill = `<span class="pill-mini pill-effort">${escapeHtml(EFFORT_SHORT_LABELS[p.thinkingEffort] || '🧠Med')}</span>`;
      const oneLinePersona = (p.persona || '').replace(/\r?\n/g, ' ').slice(0, 75);

      return `
        <div class="player-row-item ${isSelected ? 'selected' : ''}" data-player-row="${escapeHtml(p.id)}">
          <div class="player-row-left">
            <div class="player-row-avatar">${escapeHtml(p.avatar)}</div>
            <div class="player-row-identity">
              <div class="player-row-name-line">
                <span class="player-row-name">${escapeHtml(p.name)}</span>
                <span class="player-row-title">${escapeHtml(p.title || 'AI 牌手')}</span>
              </div>
              <div class="player-row-badges">
                ${driverPill}
                ${protoPill}
                ${effortPill}
              </div>
            </div>
          </div>

          <div class="player-row-middle">
            <div class="player-row-model">模型: ${escapeHtml(p.model || '默认')}</div>
            <div class="player-row-persona-preview">${escapeHtml(oneLinePersona)}...</div>
          </div>

          <div class="player-row-right">
            <div class="player-row-stats">
              <div>${p.handsPlayed}局 · 胜率 ${winRate}</div>
              <div style="color:${p.totalNetChips >= 0 ? '#6ee7b7' : '#fca5a5'};font-weight:700;">${netStr}</div>
            </div>
            ${
              isSeated
                ? `<span class="mini-badge badge-emerald">在座 #${seatedIdx + 1}</span>`
                : `<button class="btn btn-xs btn-gold" data-seat-player="${escapeHtml(p.id)}" title="将该 AI 牌手加入当前牌桌">➕ 上桌</button>`
            }
          </div>
        </div>
      `;
    })
    .join('');

  listEl.querySelectorAll('[data-player-row]').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('[data-seat-player]')) return;
      isCreatingNewPlayer = false;
      selectedPlayerId = row.dataset.playerRow;
      renderRosterHorizontalList();
      renderPlayerDetailPane();
    });
  });

  listEl.querySelectorAll('[data-seat-player]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await addPlayerToCurrentTable(btn.dataset.seatPlayer);
    });
  });
}

async function addPlayerToCurrentTable(playerId) {
  const statusBar = document.getElementById('driverTestResultBar');
  const res = await fetch('/api/tables/add-seat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tableId: appState?.activeTableId,
      playerId
    })
  });
  const data = await res.json();
  if (res.ok) {
    renderApp(data);
    statusBar.innerHTML = `✅ 已将牌手派上当前牌桌【${escapeHtml(data.game.tableName)}】！`;
  } else {
    statusBar.innerHTML = `❌ 上桌失败: ${escapeHtml(data.error)}`;
  }
}

function renderPlayerDetailPane() {
  const container = document.getElementById('playerDetailContent');
  if (!appState) return;
  const { roster, catalog, thinkingEffortOptions, personaArchetypes } = appState;
  const vendors = catalog?.vendors || [];
  const agents = catalog?.agents || [];

  const defaultArchetypePersona = personaArchetypes?.gto_master?.persona || '';
  const player = isCreatingNewPlayer
    ? {
        id: '',
        name: '新晋算客',
        title: '特邀 AI 牌手',
        avatar: '🦊',
        driverType: 'vendor',
        vendor: 'deepseek',
        protocol: 'openai',
        agent: 'pi',
        model: 'deepseek-flash',
        thinkingEffort: selectedEffortInEditor || 'high',
        persona: defaultArchetypePersona,
        customBaseURL: '',
        handsPlayed: 0,
        handsWon: 0,
        totalNetChips: 0,
        isBuiltin: false
      }
    : (roster.find(p => p.id === selectedPlayerId) || roster[0]);

  if (!player) {
    container.innerHTML = `<div class="empty-hint">👈 点击左侧任意牌手行查看完整详情与配置</div>`;
    return;
  }

  selectedEffortInEditor = player.thinkingEffort || 'medium';
  const winRate = player.handsPlayed > 0 ? `${Math.round((player.handsWon / player.handsPlayed) * 100)}%` : '0%';
  const selectedVendorObj = vendors.find(v => v.id === player.vendor) || vendors[0];
  const vendorModels = selectedVendorObj?.models || [];

  container.innerHTML = `
    <div class="detail-header-card">
      <div style="display:flex;align-items:center;gap:12px;">
        <div class="detail-avatar-big">${escapeHtml(player.avatar)}</div>
        <div>
          <h3 style="font-size:16px;color:#fef08a;">
            ${isCreatingNewPlayer ? '➕ 新增自定义 AI 牌手' : `${escapeHtml(player.name)} · <span style="font-size:13px;color:#38bdf8;">${escapeHtml(player.title)}</span>`}
          </h3>
          <div style="font-size:11.5px;color:#94a3b8;">
            ${isCreatingNewPlayer ? '填写下方配置并保存，将永久存入 SQLite 牌手库' : `ID: ${escapeHtml(player.id)} ${player.isBuiltin ? '（内置种子牌手 · 支持编辑）' : '（自定义牌手）'}`}
          </div>
        </div>
      </div>
      ${
        !isCreatingNewPlayer
          ? `<button id="btnDetailSeatNow" class="btn btn-gold btn-sm">🪑 派上当前牌桌</button>`
          : ''
      }
    </div>

    ${
      !isCreatingNewPlayer
        ? `
      <div class="detail-stats-strip">
        <div class="stat-cell"><span>历史局数</span><strong>${player.handsPlayed}</strong></div>
        <div class="stat-cell"><span>获胜局数</span><strong>${player.handsWon}</strong></div>
        <div class="stat-cell"><span>生涯胜率</span><strong>${winRate}</strong></div>
        <div class="stat-cell"><span>累计净赢筹码</span><strong style="color:${player.totalNetChips >= 0 ? '#6ee7b7' : '#fca5a5'}">${player.totalNetChips >= 0 ? `+$${player.totalNetChips}` : `-$${Math.abs(player.totalNetChips)}`}</strong></div>
      </div>
    `
        : ''
    }

    <div class="form-grid-2">
      <div class="form-group">
        <label>牌手姓名</label>
        <input type="text" id="detName" value="${escapeHtml(player.name)}" />
      </div>
      <div class="form-group">
        <label>牌桌称号 (Title)</label>
        <input type="text" id="detTitle" value="${escapeHtml(player.title)}" />
      </div>
      <div class="form-group">
        <label>头像 Emoji</label>
        <input type="text" id="detAvatar" value="${escapeHtml(player.avatar)}" />
      </div>
      <div class="form-group">
        <label>驱动大类</label>
        <select id="detDriverType">
          <option value="vendor" ${player.driverType === 'vendor' ? 'selected' : ''}>模型厂商类 (OpenAI / Anthropic 协议)</option>
          <option value="agent" ${player.driverType === 'agent' ? 'selected' : ''}>CLI Agent 类 (统一防越界提示词)</option>
        </select>
      </div>
      <div class="form-group">
        <label>模型厂商 (Vendor)</label>
        <select id="detVendor">
          ${vendors.map(v => `<option value="${escapeHtml(v.id)}" ${player.vendor === v.id ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>通信协议 (Protocol)</label>
        <select id="detProtocol">
          <option value="openai" ${player.protocol === 'openai' ? 'selected' : ''}>OpenAI 协议 (/v1/chat/completions)</option>
          <option value="anthropic" ${player.protocol === 'anthropic' ? 'selected' : ''}>Anthropic 协议 (/v1/messages)</option>
        </select>
      </div>
      <div class="form-group">
        <label>Agent 类型 (仅 Agent 类生效)</label>
        <select id="detAgent">
          ${agents.map(a => `<option value="${escapeHtml(a.id)}" ${player.agent === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>模型 ID (可选预设或手填)</label>
        <input type="text" id="detModel" list="detModelList" value="${escapeHtml(player.model)}" placeholder="如 deepseek-flash" />
        <datalist id="detModelList">
          ${vendorModels.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join('')}
        </datalist>
      </div>
    </div>

    <div class="form-group" style="margin-top:6px;">
      <label><strong>🧠 思考强度 (Thinking Effort) 配置：</strong></label>
      <div class="effort-selector-grid">
        ${(thinkingEffortOptions || []).map(opt => `
          <button type="button" class="effort-option-btn ${selectedEffortInEditor === opt.id ? 'active' : ''}" data-effort-val="${escapeHtml(opt.id)}" title="${escapeHtml(opt.description)}">
            ${escapeHtml(opt.label)}
          </button>
        `).join('')}
      </div>
    </div>

    <div class="form-group" style="margin-top:6px;">
      <div class="label-row-between">
        <label><strong>📜 深度人设与战术基因 (五维完整人设 · 点击模板可一键套用)：</strong></label>
      </div>
      <div class="archetype-chips">
        ${Object.entries(personaArchetypes || {}).map(([key, arch]) => `
          <button type="button" class="archetype-chip" data-arch-key="${escapeHtml(key)}">✨ 套用：${escapeHtml(arch.name)}</button>
        `).join('')}
      </div>
      <textarea id="detPersona" class="persona-textarea" rows="7">${escapeHtml(player.persona)}</textarea>
    </div>

    <div class="form-grid-2" style="margin-top:4px;">
      <div class="form-group">
        <label>自定义 Base URL (留空走默认网关)</label>
        <input type="text" id="detBaseUrl" value="${escapeHtml(player.customBaseURL || '')}" placeholder="可选自定义端点" />
      </div>
      <div class="form-group">
        <label>自定义 API Key (留空使用本机凭证)</label>
        <input type="password" id="detApiKey" value="" placeholder="${player.hasCustomApiKey ? '已配置密钥 (留空保持)' : '留空自动使用本机凭证'}" />
      </div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.1);">
      <button type="button" id="btnTestPlayerDetail" class="btn btn-glass btn-sm">⚡ 测试连通性</button>
      <div style="display:flex;gap:8px;">
        ${
          !isCreatingNewPlayer && !player.isBuiltin
            ? `<button type="button" id="btnDeletePlayerDetail" class="btn btn-glass btn-sm" style="color:#fca5a5;">🗑️ 删除</button>`
            : ''
        }
        <button type="button" id="btnSavePlayerDetail" class="btn btn-gold btn-sm">
          ${isCreatingNewPlayer ? '🚀 创建牌手并加入牌桌' : '💾 保存牌手修改'}
        </button>
      </div>
    </div>
  `;

  // Bind Effort Buttons
  container.querySelectorAll('[data-effort-val]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedEffortInEditor = btn.dataset.effortVal;
      container.querySelectorAll('[data-effort-val]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Bind Archetype Template Chips
  container.querySelectorAll('[data-arch-key]').forEach(chip => {
    chip.addEventListener('click', () => {
      const arch = personaArchetypes?.[chip.dataset.archKey];
      if (arch) {
        document.getElementById('detPersona').value = arch.persona;
      }
    });
  });

  // Update model datalist when vendor changes
  document.getElementById('detVendor').addEventListener('change', e => {
    const vObj = vendors.find(v => v.id === e.target.value);
    if (vObj && vObj.models?.length) {
      document.getElementById('detModel').value = vObj.defaultModel || vObj.models[0].id;
      document.getElementById('detModelList').innerHTML = vObj.models
        .map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`)
        .join('');
    }
  });

  // Seat Now Button
  document.getElementById('btnDetailSeatNow')?.addEventListener('click', async () => {
    await addPlayerToCurrentTable(player.id);
  });

  // Connectivity Test Button
  document.getElementById('btnTestPlayerDetail').addEventListener('click', async () => {
    const statusBar = document.getElementById('driverTestResultBar');
    const payload = collectDetailFormPayload();
    statusBar.innerHTML = `⏳ 正在实测 [${escapeHtml(payload.name)}] (${escapeHtml(payload.vendor)} / ${escapeHtml(payload.protocol)})...`;
    try {
      const res = await fetch('/api/driver/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        statusBar.innerHTML = `✅ 连通性通过 (${data.latencyMs}ms) ｜ 路由: <strong>${escapeHtml(data.routeLabel)}</strong> ｜ 决策: ${escapeHtml(data.decision.action)}(${data.decision.amount}) “${escapeHtml(data.decision.tableTalk)}”`;
      } else {
        statusBar.innerHTML = `❌ 连通性异常: ${escapeHtml(data.error || '未知错误')}`;
      }
    } catch (err) {
      statusBar.innerHTML = `❌ 请求异常: ${escapeHtml(err.message)}`;
    }
  });

  // Save or Create Player Button
  document.getElementById('btnSavePlayerDetail').addEventListener('click', async () => {
    const statusBar = document.getElementById('driverTestResultBar');
    const payload = collectDetailFormPayload();
    if (isCreatingNewPlayer) {
      const res = await fetch('/api/roster/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          tableId: appState?.activeTableId,
          addToCurrentTable: true
        })
      });
      const data = await res.json();
      if (res.ok) {
        isCreatingNewPlayer = false;
        selectedPlayerId = data.createdPlayer.id;
        renderApp(data);
        renderPlayerDetailPane();
        statusBar.innerHTML = `🎉 已成功创建新 AI 牌手【${escapeHtml(data.createdPlayer.name)}】并派上当前牌桌！`;
      } else {
        statusBar.innerHTML = `❌ 创建失败: ${escapeHtml(data.error)}`;
      }
    } else {
      const res = await fetch('/api/roster/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: player.id,
          ...payload
        })
      });
      const data = await res.json();
      if (res.ok) {
        renderApp(data);
        renderPlayerDetailPane();
        statusBar.innerHTML = `💾 已保存牌手【${escapeHtml(data.updatedPlayer.name)}】的人设、思考强度与模型配置至 SQLite 数据库！`;
      } else {
        statusBar.innerHTML = `❌ 保存失败: ${escapeHtml(data.error)}`;
      }
    }
  });

  // Delete Custom Player Button
  document.getElementById('btnDeletePlayerDetail')?.addEventListener('click', async () => {
    const res = await fetch('/api/roster/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: player.id })
    });
    const data = await res.json();
    if (res.ok) {
      selectedPlayerId = data.roster?.[0]?.id || null;
      renderApp(data);
      renderPlayerDetailPane();
    }
  });
}

function collectDetailFormPayload() {
  const apiKeyVal = document.getElementById('detApiKey').value.trim();
  return {
    name: document.getElementById('detName').value.trim() || 'AI 牌手',
    title: document.getElementById('detTitle').value.trim() || 'AI 职业牌手',
    avatar: document.getElementById('detAvatar').value.trim() || '🤖',
    driverType: document.getElementById('detDriverType').value,
    vendor: document.getElementById('detVendor').value,
    protocol: document.getElementById('detProtocol').value,
    agent: document.getElementById('detAgent').value,
    model: document.getElementById('detModel').value.trim(),
    thinkingEffort: selectedEffortInEditor || 'medium',
    persona: document.getElementById('detPersona').value.trim(),
    customBaseURL: document.getElementById('detBaseUrl').value.trim(),
    customApiKey: apiKeyVal || '__KEEP__'
  };
}

// ============================================================================
// View B in Roster Modal: Current Table Seats (Horizontal List)
// ============================================================================
function renderTableSeatsHorizontalList() {
  if (!appState) return;
  const { game } = appState;
  document.getElementById('cfgTableName').value = game.tableName;
  document.getElementById('cfgTableMode').value = game.mode === 'spectate' ? 'spectate' : 'play';
  document.getElementById('cfgSmallBlind').value = game.smallBlind;
  document.getElementById('cfgBigBlind').value = game.bigBlind;

  const listEl = document.getElementById('tableSeatsHorizontalList');
  listEl.innerHTML = game.seats
    .map(seat => {
      const driverPill = seat.isHuman
        ? `<span class="pill-mini" style="background:rgba(234,179,8,0.2);color:#fde047;">👑 人类玩家</span>`
        : seat.driverType === 'agent'
          ? `<span class="pill-mini pill-agent">Agent · ${escapeHtml(COMPACT_AGENT_TAGS[seat.agent] || seat.agent)}</span>`
          : `<span class="pill-mini pill-vendor">${escapeHtml(COMPACT_VENDOR_TAGS[seat.vendor] || seat.vendor)}</span>`;
      const protoPill = seat.isHuman
        ? ''
        : `<span class="pill-mini pill-proto">${escapeHtml((seat.protocol || 'openai').toUpperCase())}</span>`;
      const effortPill = seat.isHuman
        ? ''
        : `<span class="pill-mini pill-effort">${escapeHtml(EFFORT_SHORT_LABELS[seat.thinkingEffort] || '🧠Med')}</span>`;
      const personaLine = (seat.persona || '').replace(/\r?\n/g, ' ').slice(0, 80);

      return `
        <div class="player-row-item" data-seat-row="${seat.seatIndex}">
          <div class="player-row-left">
            <div class="player-row-avatar">${escapeHtml(seat.avatar)}</div>
            <div class="player-row-identity">
              <div class="player-row-name-line">
                <span class="player-row-name">#${seat.seatIndex + 1} · ${escapeHtml(seat.name)}</span>
                <span class="player-row-title">${escapeHtml(seat.title || (seat.isHuman ? '人类主角' : 'AI 牌手'))}</span>
              </div>
              <div class="player-row-badges">
                ${driverPill}
                ${protoPill}
                ${effortPill}
              </div>
            </div>
          </div>

          <div class="player-row-middle">
            <div class="player-row-model">${seat.isHuman ? '手动实时决策' : `模型: ${escapeHtml(seat.model || '默认')}`}</div>
            <div class="player-row-persona-preview">${escapeHtml(personaLine)}</div>
          </div>

          <div class="player-row-right">
            <div class="player-row-stats">
              <div style="color:#fde047;font-weight:800;">筹码 $${seat.chips}</div>
              <div>${seat.enabled ? '🟢 在座参战' : '⚪ 已离座'}</div>
            </div>
            ${
              !seat.isHuman
                ? `<button class="btn btn-xs btn-glass" data-inspect-seat-player="${escapeHtml(seat.playerId)}">详情/编辑</button>`
                : ''
            }
            ${
              game.seats.length > 2
                ? `<button class="btn btn-xs btn-glass" style="color:#fca5a5;" data-remove-seat="${seat.seatIndex}">移除</button>`
                : ''
            }
          </div>
        </div>
      `;
    })
    .join('');

  listEl.querySelectorAll('[data-inspect-seat-player]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openRosterModalWithPlayer(btn.dataset.inspectSeatPlayer);
    });
  });

  listEl.querySelectorAll('[data-remove-seat]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const res = await fetch('/api/tables/remove-seat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId: appState?.activeTableId,
          seatIndex: Number(btn.dataset.removeSeat)
        })
      });
      const data = await res.json();
      if (res.ok) renderApp(data);
    });
  });
}

document.getElementById('btnSaveTableSettings').addEventListener('click', async () => {
  const statusBar = document.getElementById('driverTestResultBar');
  const res = await fetch('/api/tables/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tableId: appState?.activeTableId,
      name: document.getElementById('cfgTableName').value.trim(),
      mode: document.getElementById('cfgTableMode').value,
      smallBlind: Number(document.getElementById('cfgSmallBlind').value) || 10,
      bigBlind: Number(document.getElementById('cfgBigBlind').value) || 20
    })
  });
  const data = await res.json();
  if (res.ok) {
    renderApp(data);
    statusBar.innerHTML = '✅ 牌桌名称、模式与盲注设置已保存至 SQLite！';
  }
});

document.getElementById('presetSelector').addEventListener('change', async e => {
  const presetId = e.target.value;
  if (!presetId) return;
  const res = await fetch('/api/seats/preset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tableId: appState?.activeTableId,
      presetId
    })
  });
  const data = await res.json();
  if (res.ok) {
    renderApp(data);
    e.target.value = '';
  }
});

// ============================================================================
// Modal 2: Create New Table Modal (Play or Spectate + Pick AI Players)
// ============================================================================
document.getElementById('btnOpenNewTableModal').addEventListener('click', () => {
  if (!appState) return;
  const roster = appState.roster || [];
  newTableSelectedPlayerIds = new Set(roster.slice(0, 6).map(p => p.id));
  renderNewTablePickerList();
  openModal('newTableModal');
});

function renderNewTablePickerList() {
  if (!appState) return;
  const roster = appState.roster || [];
  document.getElementById('newTableSelectedCount').textContent = `已选 ${newTableSelectedPlayerIds.size} 位 AI 牌手`;
  const pickerEl = document.getElementById('newTablePlayerPickerList');
  pickerEl.innerHTML = roster
    .map(p => {
      const checked = newTableSelectedPlayerIds.has(p.id);
      return `
        <div class="player-row-item ${checked ? 'selected' : ''}" data-pick-player="${escapeHtml(p.id)}">
          <div class="player-row-left">
            <div class="player-row-avatar">${escapeHtml(p.avatar)}</div>
            <div class="player-row-identity">
              <div class="player-row-name-line">
                <span class="player-row-name">${escapeHtml(p.name)}</span>
                <span class="player-row-title">${escapeHtml(p.title)}</span>
              </div>
              <div class="player-row-badges">
                <span class="pill-mini pill-vendor">${escapeHtml(COMPACT_VENDOR_TAGS[p.vendor] || p.vendor)}</span>
                <span class="pill-mini pill-effort">${escapeHtml(EFFORT_SHORT_LABELS[p.thinkingEffort] || '🧠Med')}</span>
              </div>
            </div>
          </div>
          <div class="player-row-middle">
            <div class="player-row-model">${escapeHtml(p.model)}</div>
            <div class="player-row-persona-preview">${escapeHtml((p.persona || '').replace(/\r?\n/g, ' ').slice(0, 65))}...</div>
          </div>
          <div class="player-row-right">
            <span class="mini-badge ${checked ? 'badge-emerald' : ''}">${checked ? '✅ 已选上桌' : '点击选择'}</span>
          </div>
        </div>
      `;
    })
    .join('');

  pickerEl.querySelectorAll('[data-pick-player]').forEach(row => {
    row.addEventListener('click', () => {
      const pid = row.dataset.pickPlayer;
      if (newTableSelectedPlayerIds.has(pid)) {
        if (newTableSelectedPlayerIds.size > 2) newTableSelectedPlayerIds.delete(pid);
      } else if (newTableSelectedPlayerIds.size < 8) {
        newTableSelectedPlayerIds.add(pid);
      }
      renderNewTablePickerList();
    });
  });
}

document.getElementById('btnConfirmCreateTable').addEventListener('click', async () => {
  const mode = document.getElementById('newTableMode').value;
  const name = document.getElementById('newTableName').value.trim();
  const smallBlind = Number(document.getElementById('newTableSB').value) || 20;
  const bigBlind = Number(document.getElementById('newTableBB').value) || 40;
  const startingChips = Number(document.getElementById('newTableChips').value) || 3000;

  const res = await fetch('/api/tables/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mode,
      smallBlind,
      bigBlind,
      startingChips,
      playerIds: [...newTableSelectedPlayerIds]
    })
  });
  const data = await res.json();
  if (res.ok) {
    renderApp(data);
    closeModal('newTableModal');
  }
});

// ============================================================================
// Modal 3: SQLite Persisted Hand History & Replay Center
// ============================================================================
document.getElementById('btnOpenHistoryModal').addEventListener('click', async () => {
  await loadAndRenderHistoryModal();
  openModal('historyModal');
});

document.getElementById('btnRefreshHistory').addEventListener('click', () => loadAndRenderHistoryModal());
document.getElementById('historyTableFilter').addEventListener('change', () => loadAndRenderHistoryModal());

async function loadAndRenderHistoryModal() {
  if (!appState) return;
  const filterSelect = document.getElementById('historyTableFilter');
  const currentFilterVal = filterSelect.value;
  filterSelect.innerHTML = `<option value="">🌐 全部牌桌对局记录</option>` +
    (appState.tables || [])
      .map(t => `<option value="${escapeHtml(t.id)}" ${t.id === currentFilterVal ? 'selected' : ''}>${escapeHtml(t.name)}</option>`)
      .join('');

  const res = await fetch(`/api/history?tableId=${encodeURIComponent(filterSelect.value)}&limit=60`);
  const data = await res.json();
  const records = data.records || [];

  const listEl = document.getElementById('historyRecordsList');
  if (!records.length) {
    listEl.innerHTML = `<div class="empty-hint" style="padding:20px;">当前尚无已完成的牌局记录，完成任意一手牌后将自动写入 SQLite 数据库。</div>`;
    return;
  }

  listEl.innerHTML = records
    .map(r => {
      const winText = (r.winners || []).map(w => `${w.playerName} (+$${w.amountWon})`).join(', ');
      const cardsText = (r.communityCards || []).join(' ') || '翻前进行中/结束';
      const statusBadge = r.status === 'in_progress'
        ? `<span class="pill-mini pill-vendor">🔥 进行中(已落库)</span>`
        : `<span class="pill-mini pill-proto">✅ 已完结</span>`;
      const shoeTag = r.shoeId ? `<span style="color:#c4b5fd;font-family:monospace;">🎲 ${escapeHtml(r.shoeId.replace('shoe-', '#'))}</span>` : '';
      return `
        <div class="history-item-card" data-hand-id="${escapeHtml(r.id)}">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:800;color:#fde047;">
            <span>${escapeHtml(r.tableName)} · 第 #${r.handNumber} 手</span>
            <span>${statusBadge} 底池 $${r.totalPot}</span>
          </div>
          <div style="font-size:11.5px;color:#6ee7b7;display:flex;justify-content:space-between;">
            <span>🏆 赢家: ${escapeHtml(winText || (r.status === 'in_progress' ? '实时博弈中' : '平分'))}</span>
            ${shoeTag}
          </div>
          <div style="font-size:11px;color:#94a3b8;display:flex;justify-content:space-between;">
            <span>公共牌: ${escapeHtml(cardsText)}</span>
            <span>${r.actionCount} 步动作</span>
          </div>
        </div>
      `;
    })
    .join('');

  listEl.querySelectorAll('[data-hand-id]').forEach(card => {
    card.addEventListener('click', () => {
      listEl.querySelectorAll('[data-hand-id]').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      loadHandRecordDetail(card.dataset.handId);
    });
  });

  if (records[0]) {
    listEl.querySelector('[data-hand-id]')?.classList.add('active');
    loadHandRecordDetail(records[0].id);
  }
}

async function loadHandRecordDetail(handId) {
  const pane = document.getElementById('historyDetailPane');
  const res = await fetch(`/api/history/detail?handId=${encodeURIComponent(handId)}`);
  const data = await res.json();
  if (!res.ok || !data.detail) {
    pane.innerHTML = `<div class="empty-hint">加载对局详情失败</div>`;
    return;
  }
  const d = data.detail;
  const winSummary = (d.winners || []).length
    ? (d.winners || [])
        .map(w => `🏆 <strong>${escapeHtml(w.playerName)}</strong> 赢得 <strong>$${w.amountWon}</strong> (${escapeHtml(w.handDescription)})`)
        .join(' ｜ ')
    : (d.status === 'in_progress' ? '🔥 当前牌局正在实时博弈中（每步动作已实时落库）' : '本局平分底池');

  pane.innerHTML = `
    <div style="border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <h3 style="color:#fef08a;font-size:15px;">${escapeHtml(d.tableName)} · 第 #${d.handNumber} 手复盘</h3>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          ${d.shoeId ? `<span class="mini-badge" style="color:#c4b5fd;font-family:monospace;" title="SHA-256: ${escapeHtml(d.deckHash || '')}">🎲 牌靴 ${escapeHtml(d.shoeId)}</span>` : ''}
          <span class="mini-badge badge-emerald">盲注 ${d.smallBlind}/${d.bigBlind} · 总底池 $${d.totalPot}</span>
        </div>
      </div>
      <div style="margin-top:6px;font-size:12.5px;color:#e2e8f0;">${winSummary}</div>
      <div style="margin-top:4px;font-size:12px;color:#93c5fd;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <span>公共牌: <strong>${escapeHtml((d.communityCards || []).join('  ') || '翻牌前 (Pre-flop)')}</strong></span>
        ${d.deckHash ? `<span style="font-size:10.5px;color:#94a3b8;font-family:monospace;">CSPRNG SHA-256: ${escapeHtml(d.deckHash.slice(0, 24))}...</span>` : ''}
      </div>
    </div>

    <div>
      <strong style="font-size:12px;color:#cbd5e1;">在座牌手底牌与净输赢快照：</strong>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px;margin-top:6px;">
        ${(d.seatsSnapshot || []).filter(s => s.inHand).map(s => `
          <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:8px;font-size:11.5px;">
            <div style="display:flex;justify-content:space-between;font-weight:700;">
              <span>${escapeHtml(s.avatar)} ${escapeHtml(s.name)} (${escapeHtml(s.position)})</span>
              <span style="color:${s.netChips >= 0 ? '#6ee7b7' : '#fca5a5'}">${s.netChips >= 0 ? `+$${s.netChips}` : `-$${Math.abs(s.netChips)}`}</span>
            </div>
            <div style="color:#fde047;font-family:monospace;margin-top:2px;">底牌: ${escapeHtml((s.holeCards || []).join(' ') || '--')}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
      <strong style="font-size:12px;color:#cbd5e1;">逐街行动与 AI 思考推理复盘 (${(d.actions || []).length} 步)：</strong>
      ${(d.actions || []).map(a => {
        const ctx = a.decisionContext;
        return `
        <div class="reasoning-card">
          <div class="reasoning-card-top">
            <span class="reasoning-player">#${a.stepIndex} [${escapeHtml(a.street.toUpperCase())}] ${escapeHtml(a.playerName)} (${escapeHtml(a.position)})</span>
            <span>
              ${a.thinkingEffort ? `<span class="mini-badge">${escapeHtml(EFFORT_SHORT_LABELS[a.thinkingEffort] || a.thinkingEffort)}</span>` : ''}
              <span class="mini-badge">${escapeHtml(a.action.toUpperCase())} ${a.amount > 0 ? `$${a.amount}` : ''} · 底池 $${a.potAfter}</span>
              ${a.latencyMs ? `<span class="mini-badge">${a.latencyMs}ms</span>` : ''}
            </span>
          </div>
          ${a.routeLabel || a.driverBadge ? `<div class="reasoning-route">${escapeHtml(a.routeLabel || a.driverBadge)}</div>` : ''}
          ${ctx ? `
            <div style="font-size:11px;color:#93c5fd;margin-top:4px;display:flex;flex-wrap:wrap;gap:8px;">
              <span>🃏 底牌: <strong>${escapeHtml((ctx.holeCards || []).join(' ') || '--')}</strong></span>
              <span>｜ 公共牌: <strong>${escapeHtml((ctx.communityCards || []).join(' ') || '翻牌前')}</strong></span>
              <span>｜ 牌力: <strong>${escapeHtml(ctx.handStrength || '--')}</strong></span>
              <span>｜ 赔率: <strong>${ctx.potOddsPercentage ?? 0}%</strong> (跟 $${ctx.callAmount ?? 0})</span>
            </div>
          ` : ''}
          ${a.reasoning ? `<div class="reasoning-body" style="margin-top:4px;">🧠 <strong>战术推演：</strong>${escapeHtml(a.reasoning)}</div>` : ''}
          ${a.thinkingContent ? `<div style="font-size:11px;color:#c4b5fd;margin-top:4px;white-space:pre-wrap;">💭 <strong>思维链 CoT：</strong>${escapeHtml(a.thinkingContent)}</div>` : ''}
          ${a.tableTalk ? `<div class="reasoning-talk">💬 “${escapeHtml(a.tableTalk)}”</div>` : ''}
          ${(a.promptSnapshot || a.rawOutput) ? `
            <details class="thinking-prompt-details" style="margin-top:5px;">
              <summary>🔍 查看当时下发 Prompt 快照与原始 JSON 输出</summary>
              ${a.rawOutput ? `<div class="thinking-prompt-pre"><strong>[原始响应 Raw Output]</strong>\n${escapeHtml(a.rawOutput)}</div>` : ''}
              ${a.promptSnapshot?.userPrompt ? `<div class="thinking-prompt-pre"><strong>[牌局上下文 User Prompt]</strong>\n${escapeHtml(a.promptSnapshot.userPrompt)}</div>` : ''}
            </details>
          ` : ''}
        </div>
      `;
      }).join('')}
    </div>
  `;
}

// ============================================================================
// Modal 4 & 5: Unified Agent Prompt Guardrail & Rules Modal
// ============================================================================
document.getElementById('btnOpenPromptModal').addEventListener('click', () => {
  if (!appState) return;
  document.getElementById('txtUnifiedSystemPrompt').value = appState.agentGuardrail?.systemPrompt || '';
  document.getElementById('livePromptPreviewBox').classList.add('hidden');
  openModal('promptModal');
});

document.getElementById('btnPreviewLivePrompt').addEventListener('click', async () => {
  const res = await fetch(`/api/prompt/preview?tableId=${encodeURIComponent(appState?.activeTableId || '')}&seatIndex=1`);
  const data = await res.json();
  const box = document.getElementById('livePromptPreviewBox');
  const pre = document.getElementById('livePromptPreviewText');
  box.classList.remove('hidden');
  pre.textContent = data.combinedPrompt || '';
});

document.getElementById('btnSaveUnifiedPrompt').addEventListener('click', async () => {
  const systemPrompt = document.getElementById('txtUnifiedSystemPrompt').value;
  const res = await fetch('/api/prompt/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId: appState?.activeTableId, systemPrompt })
  });
  const data = await res.json();
  if (res.ok) {
    renderApp(data);
    closeModal('promptModal');
  }
});

document.getElementById('btnResetUnifiedPrompt').addEventListener('click', async () => {
  const res = await fetch('/api/prompt/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId: appState?.activeTableId, reset: true })
  });
  const data = await res.json();
  if (res.ok) {
    document.getElementById('txtUnifiedSystemPrompt').value = data.agentGuardrail?.systemPrompt || '';
    renderApp(data);
  }
});

document.getElementById('btnOpenRulesModal').addEventListener('click', () => {
  openModal('rulesModal');
});

// ============================================================================
// QQ Game Hall View Switchers & Quick Seat Picker Modal
// ============================================================================
btnSwitchToLobby.addEventListener('click', () => switchMainView('lobby'));
btnSwitchToActiveTable.addEventListener('click', () => switchMainView('table'));
document.getElementById('btnBackToHallFloating')?.addEventListener('click', () => switchMainView('lobby'));
document.getElementById('btnHallCreateTable')?.addEventListener('click', () => {
  document.getElementById('btnOpenNewTableModal').click();
});
document.getElementById('btnHallOpenRoster')?.addEventListener('click', () => {
  openRosterModalWithPlayer(null);
});

document.querySelectorAll('#hallCategoryFilterBar .hall-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#hallCategoryFilterBar .hall-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentHallFilter = btn.dataset.hallFilter || 'all';
    if (appState) renderHallView(appState);
  });
});

function openQuickSeatModal(tableId) {
  if (!appState) return;
  quickSeatTargetTableId = tableId || appState.activeTableId;
  const targetTable = (appState.tables || []).find(t => t.id === quickSeatTargetTableId);
  document.getElementById('quickSeatModalTitle').textContent =
    `💺 为【${targetTable ? targetTable.name : '当前牌桌'}】派遣 AI 牌手入座`;
  quickSeatSearch = '';
  document.getElementById('quickSeatSearchInput').value = '';
  renderQuickSeatList();
  openModal('quickSeatModal');
}

document.getElementById('quickSeatSearchInput')?.addEventListener('input', e => {
  quickSeatSearch = (e.target.value || '').trim().toLowerCase();
  renderQuickSeatList();
});

document.getElementById('btnQuickSeatHuman')?.addEventListener('click', async () => {
  if (!quickSeatTargetTableId) return;
  closeModal('quickSeatModal');
  await enterTableFromHall(quickSeatTargetTableId, 'play');
});

function renderQuickSeatList() {
  if (!appState) return;
  const roster = appState.roster || [];
  const targetTable = (appState.tables || []).find(t => t.id === quickSeatTargetTableId);
  const seatedIds = new Set((targetTable?.playersPreview || []).map(p => p.playerId));

  const filtered = roster.filter(p => {
    if (!quickSeatSearch) return true;
    const hay = `${p.name} ${p.title} ${p.vendor} ${p.agent} ${p.model} ${p.persona}`.toLowerCase();
    return hay.includes(quickSeatSearch);
  });

  const listEl = document.getElementById('quickSeatHorizontalList');
  listEl.innerHTML = filtered
    .map(p => {
      const alreadySeated = seatedIds.has(p.id);
      return `
        <div class="player-row-item" data-quick-seat-pick="${escapeHtml(p.id)}">
          <div class="player-row-left">
            <div class="player-row-avatar">${escapeHtml(p.avatar)}</div>
            <div class="player-row-identity">
              <div class="player-row-name-line">
                <span class="player-row-name">${escapeHtml(p.name)}</span>
                <span class="player-row-title">${escapeHtml(p.title)}</span>
              </div>
              <div class="player-row-badges">
                <span class="pill-mini pill-vendor">${escapeHtml(COMPACT_VENDOR_TAGS[p.vendor] || p.vendor)}</span>
                <span class="pill-mini pill-proto">${escapeHtml((p.protocol || 'openai').toUpperCase())}</span>
                <span class="pill-mini pill-effort">${escapeHtml(EFFORT_SHORT_LABELS[p.thinkingEffort] || '🧠Med')}</span>
              </div>
            </div>
          </div>
          <div class="player-row-middle">
            <div class="player-row-model">${escapeHtml(p.model)}</div>
            <div class="player-row-persona-preview">${escapeHtml((p.persona || '').replace(/\r?\n/g, ' ').slice(0, 68))}...</div>
          </div>
          <div class="player-row-right">
            ${
              alreadySeated
                ? `<span class="mini-badge badge-emerald">已在座 (可再加分身)</span>`
                : `<button class="btn btn-xs btn-gold">➕ 派上该桌</button>`
            }
          </div>
        </div>
      `;
    })
    .join('');

  listEl.querySelectorAll('[data-quick-seat-pick]').forEach(row => {
    row.addEventListener('click', async () => {
      const playerId = row.dataset.quickSeatPick;
      const res = await fetch('/api/tables/add-seat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId: quickSeatTargetTableId,
          playerId
        })
      });
      const data = await res.json();
      if (res.ok) {
        renderApp(data);
        closeModal('quickSeatModal');
      }
    });
  });
}

// ============================================================================
// Modal 7: AI Thinking Process & Decision Details Inspector (AI 思考过程与决策细节透视中心)
// ============================================================================
let thinkingFilterSeatIndex = 'all';

function renderMiniCardChipsHtml(cardsArr) {
  if (!Array.isArray(cardsArr) || !cardsArr.length) {
    return `<span style="color:#64748b;">无</span>`;
  }
  return `<span class="thinking-mini-cards">` + cardsArr.map(cStr => {
    const str = typeof cStr === 'string' ? cStr : (cStr?.display || '');
    const isRed = str.includes('♥') || str.includes('♦');
    return `<span class="mini-card-chip ${isRed ? 'red' : ''}">${escapeHtml(str)}</span>`;
  }).join('') + `</span>`;
}

function openAiThinkingModal(seatIndexOrAll = 'all') {
  thinkingFilterSeatIndex = seatIndexOrAll === 'all' || seatIndexOrAll === null || seatIndexOrAll === undefined
    ? 'all'
    : Number(seatIndexOrAll);
  renderAiThinkingModal();
  openModal('aiThinkingModal');
}

document.getElementById('btnOpenThinkingModal')?.addEventListener('click', () => {
  openAiThinkingModal('all');
});

document.getElementById('btnFloatingThinkingInspector')?.addEventListener('click', () => {
  openAiThinkingModal('all');
});

document.getElementById('btnSpectateThinkingModal')?.addEventListener('click', () => {
  openAiThinkingModal('all');
});

document.getElementById('btnThinkingOpenHistory')?.addEventListener('click', async () => {
  closeModal('aiThinkingModal');
  await loadAndRenderHistoryModal();
  openModal('historyModal');
});

function renderAiThinkingModal() {
  if (!appState || !appState.game) return;
  const { game } = appState;
  const isSpectate = game.mode === 'spectate' || !game.hasHumanSeat;
  const showReasoning = chkShowLiveReasoning.checked || game.revealAllCards || isSpectate || game.street === 'showdown';

  const aiSeats = (game.seats || []).filter(s => s.enabled && !s.isHuman);
  const allAiActions = (game.actionHistory || []).filter(a => !a.isHuman);

  // If currently selected seatIndex is not in aiSeats, reset to 'all'
  if (thinkingFilterSeatIndex !== 'all' && !aiSeats.some(s => s.seatIndex === thinkingFilterSeatIndex)) {
    thinkingFilterSeatIndex = 'all';
  }

  // 1. Render Player Filter Tabs
  const tabsEl = document.getElementById('thinkingPlayerTabs');
  const allTabHtml = `
    <button class="thinking-player-tab ${thinkingFilterSeatIndex === 'all' ? 'active' : ''}" data-thinking-seat="all">
      🌐 本桌全部 AI 思考流 (${allAiActions.length} 步)
    </button>
  `;
  const seatTabsHtml = aiSeats.map(s => {
    const count = allAiActions.filter(a => a.seatIndex === s.seatIndex).length;
    const isActive = thinkingFilterSeatIndex === s.seatIndex;
    const engineTag = getCompactEngineBadge(s);
    return `
      <button class="thinking-player-tab ${isActive ? 'active' : ''}" data-thinking-seat="${s.seatIndex}">
        <span>${escapeHtml(s.avatar)} ${escapeHtml(s.name)}</span>
        <span class="pill-mini pill-vendor">${escapeHtml(engineTag)}</span>
        <span class="mini-count">${count}</span>
      </button>
    `;
  }).join('');
  tabsEl.innerHTML = allTabHtml + seatTabsHtml;

  tabsEl.querySelectorAll('[data-thinking-seat]').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.thinkingSeat;
      thinkingFilterSeatIndex = val === 'all' ? 'all' : Number(val);
      renderAiThinkingModal();
    });
  });

  // 2. Render Selected AI Player Profile & Persona Banner
  const bannerEl = document.getElementById('thinkingPlayerProfileBanner');
  if (thinkingFilterSeatIndex === 'all') {
    bannerEl.classList.add('hidden');
    bannerEl.innerHTML = '';
  } else {
    const seat = aiSeats.find(s => s.seatIndex === thinkingFilterSeatIndex);
    if (seat) {
      bannerEl.classList.remove('hidden');
      const rosterPlayer = (appState.roster || []).find(p => p.id === seat.playerId);
      const personaText = seat.persona || rosterPlayer?.persona || '标准德州扑克 AI 牌手';
      const effortBadge = EFFORT_SHORT_LABELS[seat.thinkingEffort] || '🧠Med';
      const currentHoleCards = (showReasoning && seat.holeCards?.length && !seat.holeCards[0]?.hidden)
        ? seat.holeCards.map(c => c.display)
        : [];
      const currentHandDesc = (showReasoning && seat.handEvaluation?.descriptionZh)
        ? seat.handEvaluation.descriptionZh
        : '暗牌 / 等待发牌';

      bannerEl.innerHTML = `
        <div class="thinking-profile-top">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span style="font-size:26px;">${escapeHtml(seat.avatar)}</span>
            <div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <strong style="font-size:15px;color:#fef08a;">${escapeHtml(seat.name)}</strong>
                <span class="player-row-title">${escapeHtml(seat.title || 'AI 牌手')}</span>
                <span class="pill-mini pill-vendor">${escapeHtml(COMPACT_VENDOR_TAGS[seat.vendor] || seat.vendor)}</span>
                ${seat.driverType === 'agent' ? `<span class="pill-mini pill-agent">Agent: ${escapeHtml(COMPACT_AGENT_TAGS[seat.agent] || seat.agent)}</span>` : ''}
                <span class="pill-mini pill-proto">${escapeHtml((seat.protocol || 'openai').toUpperCase())}</span>
                <span class="pill-mini pill-effort">思考强度: ${escapeHtml(effortBadge)}</span>
              </div>
              <div style="font-size:11.5px;color:#93c5fd;margin-top:2px;font-family:monospace;">
                模型: ${escapeHtml(seat.model || '默认模型')} ｜ 当前位置: ${escapeHtml(seat.position || '--')} ｜ 当前筹码: $${seat.chips.toLocaleString()}
              </div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <div style="font-size:12px;color:#e2e8f0;background:rgba(0,0,0,0.35);padding:5px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);">
              当前底牌: ${currentHoleCards.length ? renderMiniCardChipsHtml(currentHoleCards) : '<span>🔒 暗牌</span>'}
              <span style="margin-left:8px;color:#6ee7b7;font-weight:700;">${escapeHtml(currentHandDesc)}</span>
            </div>
            <button class="btn btn-xs btn-glass" data-edit-thinking-player="${escapeHtml(seat.playerId)}">⚙️ 配置该 AI 思考强度与人设</button>
          </div>
        </div>
        <div class="thinking-profile-persona">
          <strong>🎭 完整战术人设 (Persona)：</strong>${escapeHtml(personaText)}
        </div>
      `;

      bannerEl.querySelector('[data-edit-thinking-player]')?.addEventListener('click', () => {
        closeModal('aiThinkingModal');
        openRosterModalWithPlayer(seat.playerId);
      });
    }
  }

  // 3. Render Detailed Thinking Timeline Cards
  const timelineEl = document.getElementById('thinkingTimelineList');
  const filteredActions = (thinkingFilterSeatIndex === 'all'
    ? allAiActions
    : allAiActions.filter(a => a.seatIndex === thinkingFilterSeatIndex)
  ).slice().reverse();

  if (!filteredActions.length) {
    timelineEl.innerHTML = `
      <div class="empty-hint" style="padding:36px 20px;">
        <div style="font-size:28px;margin-bottom:8px;">🧠</div>
        <div>当前牌局尚无该 AI 牌手的行动思考记录。</div>
        <div style="margin-top:6px;font-size:12px;color:#94a3b8;">
          点击顶部「🃏 发牌」开始对局后，每次 AI 决策的<strong>底牌快照、底池赔率、战术推理、原生思维链 (CoT) 以及完整下发 Prompt</strong> 都将实时呈现在这里。
        </div>
      </div>
    `;
    return;
  }

  timelineEl.innerHTML = filteredActions.map((a, revIdx) => {
    const stepNo = filteredActions.length - revIdx;
    const effortBadge = EFFORT_SHORT_LABELS[a.thinkingEffort] || '🧠Med';
    const ctx = a.decisionContext;

    const contextGridHtml = (showReasoning && ctx)
      ? `
        <div class="thinking-context-grid">
          <div class="thinking-ctx-cell">
            <span>🃏 决策时刻底牌</span>
            <div>${renderMiniCardChipsHtml(ctx.holeCards)}</div>
          </div>
          <div class="thinking-ctx-cell">
            <span>🎴 决策时刻公共牌 (${escapeHtml((a.street || '').toUpperCase())})</span>
            <div>${ctx.communityCards?.length ? renderMiniCardChipsHtml(ctx.communityCards) : '<span style="color:#94a3b8;">翻牌前 (Pre-flop)</span>'}</div>
          </div>
          <div class="thinking-ctx-cell">
            <span>📊 实时牌力评估</span>
            <strong style="color:#fde047;">${escapeHtml(ctx.handStrength || '评估中')}</strong>
          </div>
          <div class="thinking-ctx-cell">
            <span>🪙 底池与跟注赔率 (Pot Odds)</span>
            <strong style="color:#38bdf8;">底池 $${ctx.pot ?? a.potAfter} ｜ 需跟 $${ctx.callAmount ?? 0} (${ctx.potOddsPercentage ?? 0}%)</strong>
          </div>
          <div class="thinking-ctx-cell">
            <span>⚖️ 合法动作与加注边界</span>
            <strong>[${escapeHtml((ctx.legalActionTypes || []).join(', '))}] ${ctx.minRaiseTo ? `($${ctx.minRaiseTo}~$${ctx.maxRaiseTo})` : ''}</strong>
          </div>
          <div class="thinking-ctx-cell">
            <span>💰 决策前剩余后手</span>
            <strong style="color:#6ee7b7;">$${(ctx.chipsRemaining ?? a.chipsAfter ?? 0).toLocaleString()}</strong>
          </div>
        </div>
      `
      : (!showReasoning ? `<div style="font-size:11.5px;color:#94a3b8;">🔒 当前处于暗牌保护状态，勾选右侧栏「暗牌期透视思考」或点击顶部「👁️ 明牌」即可实时透视底牌与赔率细节。</div>` : '');

    const reasoningText = showReasoning
      ? escapeHtml(a.reasoning || '稳健执行标准博弈策略。')
      : '🔒 暗牌期隐藏（摊牌或开启明牌后揭晓）';

    const cotHtml = (showReasoning && a.thinkingContent)
      ? `
        <div class="thinking-section-box thinking-cot-box">
          <div class="thinking-section-label" style="color:#c4b5fd;">
            <span>💭 原生深度思维链 (Chain-of-Thought / &lt;think&gt; 内部推演)</span>
            <span>${a.thinkingContent.length} 字</span>
          </div>
          <div>${escapeHtml(a.thinkingContent)}</div>
        </div>
      `
      : '';

    const promptDetailsHtml = (showReasoning && (a.promptSnapshot || a.rawOutput))
      ? `
        <details class="thinking-prompt-details">
          <summary>🔍 展开查看本次决策的【原始 JSON 输出】与【完整下发 Prompt 快照】</summary>
          ${a.rawOutput ? `<div class="thinking-prompt-pre"><strong>[1. 模型/Agent 原始返回内容 Raw Output]</strong>\n${escapeHtml(a.rawOutput)}</div>` : ''}
          ${a.promptSnapshot?.userPrompt ? `<div class="thinking-prompt-pre"><strong>[2. 牌局实时状态上下文 User Prompt]</strong>\n${escapeHtml(a.promptSnapshot.userPrompt)}</div>` : ''}
          ${a.promptSnapshot?.systemPrompt ? `<div class="thinking-prompt-pre"><strong>[3. 统一防越界系统提示词 System Prompt]</strong>\n${escapeHtml(a.promptSnapshot.systemPrompt)}</div>` : ''}
        </details>
      `
      : '';

    return `
      <div class="thinking-detail-card">
        <div class="thinking-card-header">
          <div class="thinking-card-who">
            <span class="mini-badge">#${stepNo}</span>
            <span class="pill-mini pill-vendor">${escapeHtml((a.street || '').toUpperCase())}</span>
            <span style="font-size:18px;">${escapeHtml(a.playerAvatar || '🤖')}</span>
            <strong style="font-size:14px;color:#f8fafc;">${escapeHtml(a.playerName)}</strong>
            ${a.playerTitle ? `<span class="player-row-title">${escapeHtml(a.playerTitle)}</span>` : ''}
            <span class="pill-mini pill-proto">位置: ${escapeHtml(a.position || '--')}</span>
            <span class="mini-badge badge-emerald" style="font-size:12px;">动作: ${escapeHtml(a.label)}</span>
          </div>
          <div class="thinking-card-meta">
            <span class="pill-mini pill-effort">思考强度: ${escapeHtml(effortBadge)}</span>
            <span class="mini-badge">⏱️ ${a.latencyMs || 0}ms</span>
            <span class="mini-badge" title="调用路由">${escapeHtml(a.routeLabel || a.driverBadge || 'AI Engine')}</span>
          </div>
        </div>

        ${contextGridHtml}

        <div class="thinking-section-box thinking-reasoning-box">
          <div class="thinking-section-label" style="color:#6ee7b7;">
            <span>🧠 AI 战术决策推演 (Tactical Reasoning)</span>
            <span>执行动作: ${escapeHtml(a.action.toUpperCase())} ${a.amount > 0 ? `$${a.amount}` : ''}</span>
          </div>
          <div>${reasoningText}</div>
          ${a.tableTalk ? `<div style="margin-top:6px;color:#fde047;font-style:italic;font-size:12px;">💬 牌桌发言：“${escapeHtml(a.tableTalk)}”</div>` : ''}
        </div>

        ${cotHtml}
        ${promptDetailsHtml}
      </div>
    `;
  }).join('');
}

// Keyboard Shortcuts for Real Poker Feel
window.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  const anyModalOpen = [...document.querySelectorAll('.modal-backdrop')].some(m => !m.classList.contains('hidden'));
  if (anyModalOpen) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
    }
    return;
  }

  const key = e.key.toLowerCase();
  if (key === ' ') {
    e.preventDefault();
    if (!appState || appState.game.street === 'idle' || appState.game.street === 'showdown') {
      startNewHand();
    }
  } else if (key === 'f' && !btnActFold.disabled) {
    btnActFold.click();
  } else if (key === 'c' && !btnActCheckCall.disabled) {
    btnActCheckCall.click();
  } else if (key === 'r' && !btnActRaise.disabled) {
    btnActRaise.click();
  } else if (key === 'a' && !btnActAllIn.disabled) {
    btnActAllIn.click();
  }
});

// Las Vegas Live Multi-Table Hall Controls & Auto-Refresh
document.getElementById('btnStopAllTablesNow')?.addEventListener('click', async () => {
  clearTimeout(aiStepTimer);
  clearTimeout(spectateNextHandTimer);
  chkAutoAiStep.checked = false;
  chkAutoNextHandSpectate.checked = false;
  const res = await fetch('/api/tables/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stopAll: true, resetToIdle: true })
  });
  if (res.ok) {
    const data = await res.json();
    renderApp(data);
  }
});

document.getElementById('btnToggleLasVegasCasino')?.addEventListener('click', async () => {
  const res = await fetch('/api/casino/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  if (res.ok) {
    const data = await res.json();
    renderApp(data);
  }
});

document.getElementById('btnDealAllTablesNow')?.addEventListener('click', async () => {
  const res = await fetch('/api/casino/deal-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  if (res.ok) {
    const data = await res.json();
    renderApp(data);
  }
});

// Periodically refresh hall & background table summaries when in Lobby View
setInterval(async () => {
  if (currentMainView !== 'lobby') return;
  const anyModalOpen = [...document.querySelectorAll('.modal-backdrop')].some(m => !m.classList.contains('hidden'));
  if (anyModalOpen) return;
  try {
    const res = await fetch('/api/state');
    if (res.ok) {
      const data = await res.json();
      appState = data;
      renderHallView(data);
      renderTableTabs(data);
      historyCountBadge.textContent = `${data.totalRecordedHandsCount ?? (data.recentHandRecords || []).length}`;
    }
  } catch {
    // ignore background poll errors
  }
}, 2200);

fetchInitialState();
