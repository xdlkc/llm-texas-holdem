import { RANK_LABELS, parseCard } from './cards.mjs';

export const HAND_CATEGORIES = {
  0: { zh: '高牌', en: 'High Card' },
  1: { zh: '一对', en: 'One Pair' },
  2: { zh: '两对', en: 'Two Pair' },
  3: { zh: '三条', en: 'Three of a Kind' },
  4: { zh: '顺子', en: 'Straight' },
  5: { zh: '同花', en: 'Flush' },
  6: { zh: '葫芦', en: 'Full House' },
  7: { zh: '四条', en: 'Four of a Kind' },
  8: { zh: '同花顺', en: 'Straight Flush' },
  9: { zh: '皇家同花顺', en: 'Royal Flush' }
};

function normalizeCard(c) {
  return typeof c === 'string' ? parseCard(c) : c;
}

function getStraightHighRank(uniqueRanksDesc) {
  if (uniqueRanksDesc.length < 5) return 0;
  for (let i = 0; i <= uniqueRanksDesc.length - 5; i++) {
    const r0 = uniqueRanksDesc[i];
    if (
      uniqueRanksDesc[i + 1] === r0 - 1 &&
      uniqueRanksDesc[i + 2] === r0 - 2 &&
      uniqueRanksDesc[i + 3] === r0 - 3 &&
      uniqueRanksDesc[i + 4] === r0 - 4
    ) {
      return r0;
    }
  }
  // Wheel straight: A-5-4-3-2
  if (
    uniqueRanksDesc.includes(14) &&
    uniqueRanksDesc.includes(5) &&
    uniqueRanksDesc.includes(4) &&
    uniqueRanksDesc.includes(3) &&
    uniqueRanksDesc.includes(2)
  ) {
    return 5;
  }
  return 0;
}

export function evaluateFiveCards(cardsInput) {
  const cards = cardsInput.map(normalizeCard);
  if (cards.length !== 5) {
    throw new Error(`evaluateFiveCards requires 5 cards, got ${cards.length}`);
  }

  const ranksDesc = cards.map(c => c.rank).sort((a, b) => b - a);
  const uniqueRanksDesc = [...new Set(ranksDesc)];
  const isFlush = cards.every(c => c.suit === cards[0].suit);
  const straightHigh = uniqueRanksDesc.length === 5 ? getStraightHighRank(uniqueRanksDesc) : 0;

  // Count frequencies of each rank
  const counts = new Map();
  for (const r of ranksDesc) {
    counts.set(r, (counts.get(r) || 0) + 1);
  }
  // Sort groups by (count DESC, rank DESC)
  const groups = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  let category = 0;
  let tiebreakers = [];
  let descriptionZh = '';

  if (isFlush && straightHigh > 0) {
    if (straightHigh === 14) {
      category = 9;
      tiebreakers = [14];
      descriptionZh = '皇家同花顺';
    } else {
      category = 8;
      tiebreakers = [straightHigh];
      descriptionZh = `${RANK_LABELS[straightHigh]}高同花顺`;
    }
  } else if (groups[0][1] === 4) {
    category = 7;
    tiebreakers = [groups[0][0], groups[1][0]];
    descriptionZh = `四条 ${RANK_LABELS[groups[0][0]]}`;
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    category = 6;
    tiebreakers = [groups[0][0], groups[1][0]];
    descriptionZh = `葫芦 (${RANK_LABELS[groups[0][0]]}满${RANK_LABELS[groups[1][0]]})`;
  } else if (isFlush) {
    category = 5;
    tiebreakers = ranksDesc;
    descriptionZh = `${RANK_LABELS[ranksDesc[0]]}高同花`;
  } else if (straightHigh > 0) {
    category = 4;
    tiebreakers = [straightHigh];
    descriptionZh = `${RANK_LABELS[straightHigh]}高顺子`;
  } else if (groups[0][1] === 3) {
    category = 3;
    tiebreakers = [groups[0][0], groups[1][0], groups[2][0]];
    descriptionZh = `三条 ${RANK_LABELS[groups[0][0]]}`;
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    category = 2;
    tiebreakers = [groups[0][0], groups[1][0], groups[2][0]];
    descriptionZh = `两对 (${RANK_LABELS[groups[0][0]]} 与 ${RANK_LABELS[groups[1][0]]})`;
  } else if (groups[0][1] === 2) {
    category = 1;
    tiebreakers = [groups[0][0], groups[1][0], groups[2][0], groups[3][0]];
    descriptionZh = `一对 ${RANK_LABELS[groups[0][0]]}`;
  } else {
    category = 0;
    tiebreakers = ranksDesc;
    descriptionZh = `${RANK_LABELS[ranksDesc[0]]}高牌`;
  }

  // Compute deterministic numeric score in base-15 so any two hands compare cleanly
  let score = category;
  for (let i = 0; i < 5; i++) {
    score = score * 15 + (tiebreakers[i] || 0);
  }

  // Sort the 5 cards in presentation order (grouped by frequency, or straight order)
  let orderedCards = [...cards];
  if (straightHigh === 5) {
    const rankOrder = [5, 4, 3, 2, 14];
    orderedCards.sort((a, b) => rankOrder.indexOf(a.rank) - rankOrder.indexOf(b.rank));
  } else {
    orderedCards.sort((a, b) => {
      const ca = counts.get(a.rank);
      const cb = counts.get(b.rank);
      if (cb !== ca) return cb - ca;
      return b.rank - a.rank;
    });
  }

  return {
    category,
    categoryNameZh: HAND_CATEGORIES[category].zh,
    categoryNameEn: HAND_CATEGORIES[category].en,
    tiebreakers,
    score,
    descriptionZh,
    bestFiveCards: orderedCards,
    bestFiveCodes: orderedCards.map(c => c.code)
  };
}

export function compareHandEvaluations(evalA, evalB) {
  if (evalA.category !== evalB.category) {
    return evalA.category - evalB.category;
  }
  const len = Math.max(evalA.tiebreakers.length, evalB.tiebreakers.length);
  for (let i = 0; i < len; i++) {
    const va = evalA.tiebreakers[i] || 0;
    const vb = evalB.tiebreakers[i] || 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

export function evaluateSevenCards(cardsInput) {
  const cards = cardsInput.map(normalizeCard);
  if (cards.length < 5) {
    return evaluatePartialHand(cards);
  }
  if (cards.length === 5) {
    return evaluateFiveCards(cards);
  }

  let bestEval = null;
  const n = cards.length;
  for (let i = 0; i < n - 4; i++) {
    for (let j = i + 1; j < n - 3; j++) {
      for (let k = j + 1; k < n - 2; k++) {
        for (let l = k + 1; l < n - 1; l++) {
          for (let m = l + 1; m < n; m++) {
            const candidate = evaluateFiveCards([cards[i], cards[j], cards[k], cards[l], cards[m]]);
            if (!bestEval || compareHandEvaluations(candidate, bestEval) > 0) {
              bestEval = candidate;
            }
          }
        }
      }
    }
  }
  return bestEval;
}

export function evaluatePartialHand(cardsInput) {
  const cards = (cardsInput || []).map(normalizeCard);
  if (cards.length === 0) {
    return {
      category: -1,
      categoryNameZh: '等待发牌',
      categoryNameEn: 'Waiting',
      tiebreakers: [],
      score: 0,
      descriptionZh: '等待发牌',
      bestFiveCards: [],
      bestFiveCodes: []
    };
  }
  if (cards.length === 2) {
    const [c1, c2] = [...cards].sort((a, b) => b.rank - a.rank);
    const suited = c1.suit === c2.suit;
    const pair = c1.rank === c2.rank;
    const gap = Math.abs(c1.rank - c2.rank);
    let tier = '普通起手牌';
    if (pair && c1.rank >= 10) tier = '顶级口袋对子';
    else if (pair) tier = '口袋对子';
    else if (c1.rank === 14 && c2.rank >= 11 && suited) tier = '顶级同花大牌';
    else if (c1.rank === 14 && c2.rank >= 12) tier = '强力大高牌';
    else if (suited && gap === 1 && c2.rank >= 6) tier = '同花连张';
    else if (suited) tier = '同花起手牌';

    const desc = pair
      ? `口袋对子 ${RANK_LABELS[c1.rank]}${RANK_LABELS[c2.rank]} (${tier})`
      : `${RANK_LABELS[c1.rank]}${RANK_LABELS[c2.rank]}${suited ? '同花' : '杂色'} (${tier})`;

    return {
      category: pair ? 1 : 0,
      categoryNameZh: pair ? '口袋对子' : (suited ? '同花高牌' : '起手高牌'),
      categoryNameEn: pair ? 'Pocket Pair' : 'Hole Cards',
      tiebreakers: [c1.rank, c2.rank],
      score: (pair ? 1 : 0) * 1000 + c1.rank * 15 + c2.rank,
      descriptionZh: desc,
      bestFiveCards: [c1, c2],
      bestFiveCodes: [c1.code, c2.code]
    };
  }

  return {
    category: 0,
    categoryNameZh: '高牌',
    categoryNameEn: 'High Card',
    tiebreakers: cards.map(c => c.rank).sort((a, b) => b - a),
    score: 0,
    descriptionZh: '牌局进行中',
    bestFiveCards: cards,
    bestFiveCodes: cards.map(c => c.code)
  };
}
