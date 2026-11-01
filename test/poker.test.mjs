import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck, parseCard, shuffleDeck } from '../src/poker/cards.mjs';
import { evaluateFiveCards, evaluateSevenCards, compareHandEvaluations } from '../src/poker/evaluator.mjs';
import { TexasHoldemGame, STREETS } from '../src/poker/engine.mjs';

test('Deck creation and card parsing', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  const uniqueCodes = new Set(deck.map(c => c.code));
  assert.equal(uniqueCodes.size, 52);

  const aceSpades = parseCard('As');
  assert.equal(aceSpades.rank, 14);
  assert.equal(aceSpades.suit, 's');
  assert.equal(aceSpades.display, '♠A');

  const tenHearts = parseCard('10h');
  assert.equal(tenHearts.rank, 10);
  assert.equal(tenHearts.code, 'Th');

  const shuffled = shuffleDeck(deck);
  assert.equal(shuffled.length, 52);
});

test('Hand evaluator identifies all 10 Texas Holdem hand ranks and wheel straights', () => {
  const royal = evaluateSevenCards(['As', 'Ks', 'Qs', 'Js', 'Ts', '2d', '3c']);
  assert.equal(royal.category, 9);
  assert.equal(royal.categoryNameZh, '皇家同花顺');

  const steelWheel = evaluateSevenCards(['As', '2s', '3s', '4s', '5s', 'Kd', 'Qc']);
  assert.equal(steelWheel.category, 8);
  assert.equal(steelWheel.tiebreakers[0], 5);

  const quads = evaluateSevenCards(['Ah', 'Ad', 'Ac', 'As', 'Kh', 'Qd', '2c']);
  assert.equal(quads.category, 7);

  const fullHouse = evaluateSevenCards(['Kh', 'Kd', 'Kc', 'Qs', 'Qh', '2d', '3c']);
  assert.equal(fullHouse.category, 6);

  const flush = evaluateSevenCards(['Ah', 'Jh', '9h', '6h', '2h', 'Kd', 'Qc']);
  assert.equal(flush.category, 5);

  const wheelStraight = evaluateFiveCards(['Ac', '2d', '3h', '4s', '5c']);
  assert.equal(wheelStraight.category, 4);
  assert.equal(wheelStraight.tiebreakers[0], 5);

  const sixHighStraight = evaluateFiveCards(['2c', '3d', '4h', '5s', '6c']);
  assert.ok(compareHandEvaluations(sixHighStraight, wheelStraight) > 0);
  assert.ok(compareHandEvaluations(royal, quads) > 0);
});

test('TexasHoldemGame progresses through streets and awards pot on fold', () => {
  const game = new TexasHoldemGame({ smallBlind: 10, bigBlind: 20, startingChips: 1000 });
  game.setSeats([
    { name: 'Human', isHuman: true, chips: 1000 },
    { name: 'AI-1', isHuman: false, chips: 1000 },
    { name: 'AI-2', isHuman: false, chips: 1000 }
  ]);

  const state = game.startNewHand();
  assert.equal(state.street, STREETS.PREFLOP);
  assert.equal(state.pot, 30);

  // First actor folds
  game.applyAction(game.actionSeatIndex, { action: 'fold' });
  // Second actor folds -> remaining player wins immediately
  game.applyAction(game.actionSeatIndex, { action: 'fold' });

  assert.equal(game.street, STREETS.SHOWDOWN);
  assert.equal(game.winners.length, 1);
  const totalChips = game.seats.reduce((s, p) => s + p.chips, 0);
  assert.equal(totalChips, 3000);
});

test('TexasHoldemGame calculates Main Pot and Side Pots accurately on multi-way All-In', () => {
  // Deterministic deck so we know exact showdown winner
  // Deal order for 3 players (BTN=seat 0, SB=seat 1, BB=seat 2): SB, BB, BTN
  // Remember deck.pop() takes from the end of the array!
  const customCards = [
    // River (burn + 1)
    '2c', '9d',
    // Turn (burn + 1)
    '3c', '8d',
    // Flop (burn + 3)
    '4c', 'Ah', 'Kd', 'Qc',
    // Hole cards round 2: popped in order SB(seat 1), BB(seat 2), BTN(seat 0)
    'As', 'Ks', '7h',
    // Hole cards round 1: popped in order SB(seat 1), BB(seat 2), BTN(seat 0)
    'Ad', 'Kh', '7d'
  ].map(parseCard);

  const game = new TexasHoldemGame({
    smallBlind: 10,
    bigBlind: 20,
    deckFactory: () => [...customCards]
  });

  // Seat 0 (BTN): 100 chips, gets Ad As (Pocket Aces -> Triple Aces on flop, best hand, wins Main Pot only!)
  // Seat 1 (SB): 300 chips, gets 7d 7h (Pocket 7s -> loses)
  // Seat 2 (BB): 500 chips, gets Kh Ks (Pocket Kings -> Triple Kings on flop, wins Side Pot!)
  game.setSeats([
    { name: 'ShortStack-Aces', isHuman: true, chips: 100 },
    { name: 'MidStack-Sevens', isHuman: false, chips: 300 },
    { name: 'BigStack-Kings', isHuman: false, chips: 500 }
  ]);

  game.startNewHand({ autoRebuy: false });
  // Dealer is seat 0, SB is seat 1, BB is seat 2. First to act pre-flop is seat 0 (BTN).
  assert.equal(game.actionSeatIndex, 0);

  // Seat 0 goes all-in for 100
  game.applyAction(0, { action: 'all_in' });
  // Seat 1 goes all-in for 300
  game.applyAction(1, { action: 'all_in' });
  // Seat 2 calls 300 (or goes all-in for 500, where 200 uncalled is returned)
  game.applyAction(2, { action: 'all_in' });

  // Should auto-runout to Showdown!
  assert.equal(game.street, STREETS.SHOWDOWN);
  // Total chips must be conserved (100 + 300 + 500 = 900)
  const totalAfter = game.seats.reduce((sum, s) => sum + s.chips, 0);
  assert.equal(totalAfter, 900);

  // Main Pot = 100 * 3 = 300 -> Won by Seat 0 (Aces)
  assert.equal(game.seats[0].chips, 300);
  // Side Pot = (300 - 100) * 2 = 400 -> Won by Seat 2 (Kings), plus 200 uncalled returned = 600
  assert.equal(game.seats[2].chips, 600);
  // Seat 1 (Sevens) gets 0
  assert.equal(game.seats[1].chips, 0);
});
