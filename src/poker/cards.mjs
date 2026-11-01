import { randomInt, randomBytes, createHash } from 'node:crypto';

export const SUITS = ['s', 'h', 'd', 'c']; // Spades ♠, Hearts ♥, Diamonds ♦, Clubs ♣
export const SUIT_SYMBOLS = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣'
};
export const SUIT_NAMES_ZH = {
  s: '黑桃',
  h: '红桃',
  d: '方片',
  c: '梅花'
};

export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
export const RANK_LABELS = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A'
};
export const SHORT_RANK_LABELS = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: 'T',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A'
};

export function createCard(rank, suit) {
  const code = `${SHORT_RANK_LABELS[rank]}${suit}`;
  const display = `${SUIT_SYMBOLS[suit]}${RANK_LABELS[rank]}`;
  return {
    rank,
    suit,
    code,
    display,
    label: RANK_LABELS[rank],
    suitSymbol: SUIT_SYMBOLS[suit],
    suitNameZh: SUIT_NAMES_ZH[suit]
  };
}

export function parseCard(code) {
  if (!code || typeof code !== 'string') throw new Error(`Invalid card code: ${code}`);
  const trimmed = code.trim();
  const suit = trimmed.slice(-1).toLowerCase();
  const rankPart = trimmed.slice(0, -1).toUpperCase();
  const rankMap = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    '10': 10, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
  };
  const rank = rankMap[rankPart];
  if (!rank || !SUITS.includes(suit)) {
    throw new Error(`Invalid card code: ${code}`);
  }
  return createCard(rank, suit);
}

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(createCard(rank, suit));
    }
  }
  return deck;
}

export function shuffleDeck(deck = createDeck()) {
  const copy = [...deck];
  // Pass 1: Cryptographic Fisher-Yates shuffle
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  // Pass 2: Las Vegas casino random cut (between card 12 and 40)
  if (copy.length >= 52) {
    const cutPoint = randomInt(12, 41);
    const topHalf = copy.slice(0, cutPoint);
    const bottomHalf = copy.slice(cutPoint);
    copy.splice(0, copy.length, ...bottomHalf, ...topHalf);
  }
  // Pass 3: Second independent CSPRNG Fisher-Yates pass
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

export function createVerifiableShuffledShoe(context = {}) {
  const tableId = context.tableId || 'table';
  const handNumber = context.handNumber || 1;
  const entropyHex = randomBytes(16).toString('hex');
  const hrNano = process.hrtime.bigint().toString();
  const deck = shuffleDeck(createDeck());
  const cardOrderCodes = deck.map(c => c.code).join('-');
  const deckHash = createHash('sha256')
    .update(`${tableId}:${handNumber}:${hrNano}:${entropyHex}:${cardOrderCodes}`)
    .digest('hex');
  const shoeId = `shoe-${entropyHex.slice(0, 8)}`;
  return {
    deck,
    shoeId,
    deckHash
  };
}

export function formatCards(cards) {
  if (!Array.isArray(cards) || !cards.length) return '无';
  return cards.map(c => (typeof c === 'string' ? parseCard(c).display : c.display)).join(' ');
}
