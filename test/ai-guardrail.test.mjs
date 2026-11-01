import test from 'node:test';
import assert from 'node:assert/strict';
import { TexasHoldemGame } from '../src/poker/engine.mjs';
import {
  buildUnifiedPokerPrompt,
  sanitizeAndValidateAgentDecision,
  extractDecisionJsonObject
} from '../src/ai/agentPromptGuard.mjs';
import { VENDOR_CATALOG, AGENT_CATALOG, PROTOCOL_CATALOG } from '../src/ai/providers.mjs';

test('Catalog contains all 5 Model Vendors (supporting OpenAI & Anthropic) and all 5 Agents', () => {
  const vendorIds = Object.keys(VENDOR_CATALOG);
  assert.deepEqual(vendorIds, ['deepseek', 'zhipu-token-plan', 'kimi', 'gpt', 'zenmux']);
  for (const v of Object.values(VENDOR_CATALOG)) {
    assert.ok(v.supportedProtocols.includes('openai'));
    assert.ok(v.supportedProtocols.includes('anthropic'));
  }

  const agentIds = Object.keys(AGENT_CATALOG);
  assert.deepEqual(agentIds, ['codex', 'gemini', 'claude-code', 'pi', 'opencode2']);

  const protocolIds = Object.keys(PROTOCOL_CATALOG);
  assert.deepEqual(protocolIds, ['openai', 'anthropic']);
});

test('Agent Unified Prompt Guardrail sanitizes CLI noise, blocks illegal moves, and clamps raise sizing', () => {
  const legal = {
    canAct: true,
    toCall: 20,
    callAmount: 20,
    canFold: true,
    canCheck: false,
    canCall: true,
    canRaise: true,
    canAllIn: true,
    minRaiseTo: 60,
    maxRaiseTo: 500,
    allInAmount: 500,
    tableCurrentBet: 20,
    legalActionTypes: ['fold', 'call', 'raise', 'all_in']
  };

  // Case 1: CLI output with pi/opencode headers and thinking tags
  const noisyOutput = `Warning: No models match pattern "kimi-coding/k3.1-pro"
> build · glm/glm-5.3
<think>I have AK suited, I should raise.</think>
\`\`\`json
{"action":"raise","amount":80,"reasoning":"同花AK起手牌极强，加注隔离对手。","table_talk":"加点注热热身！"}
\`\`\``;

  const res1 = sanitizeAndValidateAgentDecision(noisyOutput, legal);
  assert.equal(res1.action, 'raise');
  assert.equal(res1.amount, 80);
  assert.equal(res1.guardrailAdjusted, false);

  // Case 2: Illegal check when toCall > 0 -> Guardrail auto-corrects to call(20)
  const illegalCheckOutput = `{"action":"check","amount":0,"reasoning":"try free card","table_talk":"过牌"}`;
  const res2 = sanitizeAndValidateAgentDecision(illegalCheckOutput, legal);
  assert.equal(res2.action, 'call');
  assert.equal(res2.amount, 20);
  assert.equal(res2.guardrailAdjusted, true);

  // Case 3: Under-minimum raise -> Guardrail clamps to minRaiseTo (60)
  const underRaiseOutput = `{"action":"raise","amount":30,"reasoning":"small raise","table_talk":"小加"}`;
  const res3 = sanitizeAndValidateAgentDecision(underRaiseOutput, legal);
  assert.equal(res3.action, 'raise');
  assert.equal(res3.amount, 60);
  assert.equal(res3.guardrailAdjusted, true);

  // Case 4: Over-maximum raise -> Guardrail converts to all_in (500)
  const overRaiseOutput = `{"action":"raise","amount":9999,"reasoning":"huge jam","table_talk":"全推了"}`;
  const res4 = sanitizeAndValidateAgentDecision(overRaiseOutput, legal);
  assert.equal(res4.action, 'all_in');
  assert.equal(res4.amount, 500);
  assert.equal(res4.guardrailAdjusted, true);
});

test('buildUnifiedPokerPrompt includes strict anti-deviation instructions and complete table JSON', () => {
  const game = new TexasHoldemGame({ smallBlind: 10, bigBlind: 20 });
  game.setSeats([
    { name: 'Human', isHuman: true, chips: 1000 },
    { name: 'Claude Code Agent', isHuman: false, driverType: 'agent', agent: 'claude-code', vendor: 'zenmux', chips: 1000 }
  ]);
  game.startNewHand();
  const promptBundle = buildUnifiedPokerPrompt({
    seat: game.seats[1],
    game
  });
  assert.ok(promptBundle.systemPrompt.includes('严禁调用任何工具'));
  assert.ok(promptBundle.userPrompt.includes('legalActionTypes'));
  assert.equal(promptBundle.statePayload.you.name, 'Claude Code Agent');
});
