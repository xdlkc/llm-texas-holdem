import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import {
  ensureAgentSandboxDir,
  buildUnifiedPokerPrompt,
  sanitizeAndValidateAgentDecision,
  stripAnsiAndCliNoise,
  extractThinkBlocks
} from './agentPromptGuard.mjs';

const LOCAL_BIN_DIR = path.join(os.homedir(), '.local/bin');
const MODEL_HUB_DIR = path.join(os.homedir(), 'Library/Application Support/ModelHub/.local');
const MODEL_HUB_KEY_FILE = path.join(MODEL_HUB_DIR, 'hub.key');
const MODEL_HUB_OPENAI_URL = 'http://127.0.0.1:4319/v1';
const MODEL_HUB_ANTHROPIC_URL = 'http://127.0.0.1:4319';
const DEFAULT_LOCAL_PROXY = 'http://127.0.0.1:7892';

export const VENDOR_CATALOG = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    badge: 'DeepSeek',
    color: '#3b82f6',
    supportedProtocols: ['openai', 'anthropic'],
    defaultProtocol: 'openai',
    defaultModel: 'deepseek-flash',
    hubPrefix: 'deepseek',
    openaiBaseURL: 'https://api.deepseek.com/v1',
    anthropicBaseURL: 'https://api.deepseek.com/anthropic',
    localKeyFile: path.join(MODEL_HUB_DIR, 'keys/local-deepseek.key'),
    models: [
      { id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash (极速推理)', hubId: 'deepseek/deepseek-flash' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (深度博弈)', hubId: 'deepseek/deepseek-v4-pro' },
      { id: 'deepseek-chat', label: 'DeepSeek Chat', hubId: 'deepseek/deepseek-flash' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', hubId: 'deepseek/deepseek-v4-pro' }
    ]
  },
  'zhipu-token-plan': {
    id: 'zhipu-token-plan',
    name: '智谱 Token Plan',
    badge: '智谱 GLM',
    color: '#6366f1',
    supportedProtocols: ['openai', 'anthropic'],
    defaultProtocol: 'openai',
    defaultModel: 'glm-5.3-flash',
    hubPrefix: 'glm',
    openaiBaseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
    anthropicBaseURL: 'https://open.bigmodel.cn/api/anthropic',
    localKeyFile: path.join(MODEL_HUB_DIR, 'keys/local-glm-plan.key'),
    models: [
      { id: 'glm-5.3-flash', label: 'GLM-5.3 Flash (智谱 Token Plan 高速)', hubId: 'glm/glm-5.3-flash' },
      { id: 'glm-5.3', label: 'GLM-5.3 (智谱 Token Plan 旗舰)', hubId: 'glm/glm-5.3' },
      { id: 'glm-5.3-flashx', label: 'GLM-5.3 FlashX (智谱极速)', hubId: 'glm/glm-5.3-flashx' }
    ]
  },
  kimi: {
    id: 'kimi',
    name: 'Kimi',
    badge: 'Kimi',
    color: '#10b981',
    supportedProtocols: ['openai', 'anthropic'],
    defaultProtocol: 'openai',
    defaultModel: 'k3.1-pro-highspeed',
    hubPrefix: 'kimi',
    openaiBaseURL: 'https://api.kimi.com/coding/v1',
    anthropicBaseURL: 'https://api.kimi.com/coding',
    localKeyFile: path.join(MODEL_HUB_DIR, 'keys/local-kimi.key'),
    models: [
      { id: 'k3.1-pro-highspeed', label: 'Kimi K3.1 Pro 高速版', hubId: 'kimi/k3.1-pro-highspeed' },
      { id: 'k3.1-pro', label: 'Kimi K3.1 Pro 标准版', hubId: 'kimi/k3.1-pro' }
    ]
  },
  gpt: {
    id: 'gpt',
    name: 'GPT (OpenAI)',
    badge: 'GPT',
    color: '#14b8a6',
    supportedProtocols: ['openai', 'anthropic'],
    defaultProtocol: 'openai',
    defaultModel: 'openai/gpt-5.4-mini',
    hubPrefix: 'openai',
    openaiBaseURL: 'https://api.openai.com/v1',
    anthropicBaseURL: 'https://zenmux.ai/api/anthropic',
    localKeyFile: path.join(MODEL_HUB_DIR, 'keys/local-zenmux.key'),
    models: [
      { id: 'openai/gpt-5.4-mini', label: 'GPT-5.4 Mini (快速响应)', hubId: 'openai/gpt-5.4-mini' },
      { id: 'openai/gpt-6-astra', label: 'GPT-6 Astra (旗舰博弈)', hubId: 'openai/gpt-6-astra' },
      { id: 'openai/gpt-6.1-sol', label: 'GPT-6.1 Sol', hubId: 'openai/gpt-6.1-sol' },
      { id: 'openai/gpt-5.4', label: 'GPT-5.4', hubId: 'openai/gpt-5.4' },
      { id: 'gpt-4o', label: 'GPT-4o (直连 OpenAI)', hubId: 'gpt-4o' }
    ]
  },
  zenmux: {
    id: 'zenmux',
    name: 'ZenMux',
    badge: 'ZenMux',
    color: '#a855f7',
    supportedProtocols: ['openai', 'anthropic'],
    defaultProtocol: 'anthropic',
    defaultModel: 'anthropic/claude-haiku-5.5',
    hubPrefix: 'zenmux',
    openaiBaseURL: 'https://zenmux.ai/api/v1',
    anthropicBaseURL: 'https://zenmux.ai/api/anthropic',
    localKeyFile: path.join(MODEL_HUB_DIR, 'keys/local-zenmux.key'),
    models: [
      { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5 (ZenMux 极速)', hubId: 'zenmux/anthropic/claude-haiku-5.5' },
      { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5 (ZenMux 均衡)', hubId: 'zenmux/anthropic/claude-sonnet-5.5' },
      { id: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5 (ZenMux 大师)', hubId: 'zenmux/anthropic/claude-opus-5.5' },
      { id: 'openai/gpt-6-astra', label: 'GPT-6 Astra (ZenMux 路由)', hubId: 'openai/gpt-6-astra' },
      { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash (ZenMux 路由)', hubId: 'google/gemini-3.8-flash' },
      { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash (ZenMux 路由)', hubId: 'deepseek/deepseek-v4.1-flash' },
      { id: 'moonshotai/kimi-k3.1-pro', label: 'Kimi K3.1 Pro (ZenMux 路由)', hubId: 'moonshotai/kimi-k3.1-pro' }
    ]
  }
};

export const AGENT_CATALOG = {
  codex: {
    id: 'codex',
    name: 'Codex',
    badge: 'Codex Agent',
    color: '#059669',
    binary: path.join(LOCAL_BIN_DIR, 'codex'),
    defaultVendor: 'gpt',
    defaultModel: 'gpt-6-astra',
    description: 'OpenAI Codex CLI · 只读沙箱 + JSON Schema 强约束模式 (--ignore-user-config -s read-only --output-schema)'
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    badge: 'Gemini Agent',
    color: '#2563eb',
    binary: path.join(LOCAL_BIN_DIR, 'agy'),
    defaultVendor: 'zenmux',
    defaultModel: 'gemini-3.8-flash-low',
    description: 'Gemini / Antigravity CLI · 非交互式沙箱模式 (-p --disable-slash-commands --effort low)'
  },
  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code',
    badge: 'Claude Code',
    color: '#d97706',
    binary: path.join(LOCAL_BIN_DIR, 'claude'),
    defaultVendor: 'zenmux',
    defaultModel: 'zenmux/anthropic/claude-haiku-5.5',
    description: 'Anthropic Claude Code CLI · 零工具调用模式 (-p --tools "" --strict-mcp-config --disable-slash-commands)'
  },
  pi: {
    id: 'pi',
    name: 'Pi Agent',
    badge: 'Pi Agent',
    color: '#ec4899',
    binary: path.join(LOCAL_BIN_DIR, 'pi'),
    defaultVendor: 'zhipu-token-plan',
    defaultModel: 'glm/glm-5.3-flash',
    description: 'Pi Coding Agent CLI · 禁用全部工具与扩展模式 (-p -nt --no-mcp -ne -ns --no-session)'
  },
  opencode2: {
    id: 'opencode2',
    name: 'OpenCode2',
    badge: 'OpenCode2',
    color: '#8b5cf6',
    binary: path.join(LOCAL_BIN_DIR, 'opencode2'),
    defaultVendor: 'deepseek',
    defaultModel: 'hub/deepseek/deepseek-flash',
    description: 'OpenCode v2 CLI · 隔离沙箱目录 + 统一防越界提示词驱动 (opencode2 run --model)'
  }
};

export const PROTOCOL_CATALOG = {
  openai: {
    id: 'openai',
    name: 'OpenAI 协议',
    endpointSuffix: '/chat/completions',
    description: 'OpenAI Chat Completions 兼容协议 (POST /v1/chat/completions, Authorization: Bearer)'
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic 协议',
    endpointSuffix: '/v1/messages',
    description: 'Anthropic Messages 原生协议 (POST /v1/messages, x-api-key + anthropic-version: 2023-06-01)'
  }
};

function readKeySafe(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8').trim();
    }
  } catch {
    // ignore
  }
  return '';
}

export function getEnvironmentCapabilities() {
  const hubKey = readKeySafe(MODEL_HUB_KEY_FILE);
  const vendors = Object.values(VENDOR_CATALOG).map(v => ({
    ...v,
    localCredentialsReady: Boolean(hubKey || readKeySafe(v.localKeyFile))
  }));
  const agents = Object.values(AGENT_CATALOG).map(a => ({
    ...a,
    installed: fs.existsSync(a.binary)
  }));
  return {
    modelHubAvailable: Boolean(hubKey),
    modelHubOpenAIUrl: MODEL_HUB_OPENAI_URL,
    modelHubAnthropicUrl: MODEL_HUB_ANTHROPIC_URL,
    vendors,
    agents,
    protocols: Object.values(PROTOCOL_CATALOG)
  };
}

const upstream403Cache = new Map();
const UPSTREAM_403_TTL_MS = 5 * 60 * 1000;

function isModelMarked403(modelKey) {
  const ts = upstream403Cache.get(modelKey);
  if (!ts) return false;
  if (Date.now() - ts > UPSTREAM_403_TTL_MS) {
    upstream403Cache.delete(modelKey);
    return false;
  }
  return true;
}

function markModel403(modelKey) {
  if (modelKey) {
    upstream403Cache.set(modelKey, Date.now());
  }
}

function resolveLiveHubBackupModel(vendorId = 'deepseek', requestedModel = '') {
  const m = String(requestedModel || '').toLowerCase();
  if (m.includes('deepseek-v4-pro') || m.includes('opus') || m.includes('6.1-sol')) {
    return 'deepseek/deepseek-v4-pro';
  }
  if (m.includes('deepseek')) {
    return 'deepseek/deepseek-flash';
  }
  if (m.includes('kimi-k3.1-pro') && !m.includes('highspeed')) {
    return 'kimi/k3.1-pro';
  }
  if (m.includes('kimi') || m.includes('sonnet') || m.includes('6-astra')) {
    return 'kimi/k3.1-pro-highspeed';
  }
  if (m.includes('glm-5.3') && !m.includes('flash')) {
    return 'glm/glm-5.3';
  }
  if (m.includes('haiku') || m.includes('gemini') || m.includes('mini') || m.includes('flash')) {
    return 'glm/glm-5.3-flash';
  }
  if (vendorId === 'kimi') return 'kimi/k3.1-pro-highspeed';
  if (vendorId === 'zhipu-token-plan') return 'glm/glm-5.3-flash';
  if (vendorId === 'zenmux') return 'kimi/k3.1-pro-highspeed';
  if (vendorId === 'gpt') return 'deepseek/deepseek-flash';
  return 'deepseek/deepseek-flash';
}

function resolveHubModelForVendor(vendorId, requestedModel = '') {
  const vendor = VENDOR_CATALOG[vendorId] || VENDOR_CATALOG.deepseek;
  if (requestedModel) {
    const clean = requestedModel.replace(/^hub\//, '').trim();
    if (clean === 'deepseek/deepseek-v4.1-flash') return 'deepseek/deepseek-flash';
    if (clean === 'moonshotai/kimi-k3.1-pro') return 'kimi/k3.1-pro';
    const found = vendor.models.find(m => m.id === clean || m.hubId === clean);
    if (found && found.hubId) return found.hubId;
    if (/^(deepseek|glm|kimi|zenmux|minimax)\//.test(clean)) {
      return clean;
    }
    if (vendor.hubPrefix && vendor.hubPrefix !== 'openai') {
      return `${vendor.hubPrefix}/${clean}`;
    }
  }
  const defaultEntry = vendor.models[0];
  return defaultEntry?.hubId || 'deepseek/deepseek-flash';
}

function resolveUpstreamModelForVendor(vendorId, requestedModel = '') {
  const vendor = VENDOR_CATALOG[vendorId] || VENDOR_CATALOG.deepseek;
  if (!requestedModel) return vendor.defaultModel;
  // Strip hub prefix if present (e.g. "deepseek/deepseek-flash" -> "deepseek-flash", "zenmux/anthropic/..." -> "anthropic/...")
  const prefixes = ['deepseek/', 'glm/', 'kimi/', 'zenmux/', 'hub/'];
  let m = requestedModel;
  if (m.startsWith('hub/')) m = m.slice(4);
  for (const p of prefixes) {
    if (m.startsWith(p) && vendorId !== 'zenmux') {
      return m.slice(p.length);
    }
    if (m.startsWith('zenmux/') && vendorId === 'zenmux') {
      return m.slice('zenmux/'.length);
    }
  }
  return m;
}

function runCurlJson({ url, headers = {}, body, timeoutSec = 45, useProxy = false }) {
  return new Promise((resolve, reject) => {
    const args = [
      '--silent',
      '--show-error',
      '--max-time', String(timeoutSec),
      '--connect-timeout', '12',
      '-X', 'POST',
      url,
      '-H', 'Content-Type: application/json'
    ];
    if (useProxy && !url.includes('127.0.0.1') && !url.includes('localhost')) {
      args.push('-x', DEFAULT_LOCAL_PROXY);
    }
    for (const [k, v] of Object.entries(headers)) {
      args.push('-H', `${k}: ${v}`);
    }
    args.push('--data-binary', JSON.stringify(body));

    const child = spawn('/usr/bin/curl', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => reject(err));
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`curl exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function executeSingleVendorRequest({
  proto,
  targetUrl,
  apiKey,
  finalModel,
  maxTokens,
  systemPrompt,
  userPrompt,
  timeoutSec,
  useProxy,
  vendorId,
  routeLabel
}) {
  if (proto === 'anthropic') {
    const body = {
      model: finalModel,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ]
    };
    const rawResp = await runCurlJson({
      url: targetUrl,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body,
      timeoutSec,
      useProxy
    });
    let data;
    try {
      data = JSON.parse(rawResp);
    } catch {
      throw new Error(`Anthropic 协议响应非合法 JSON: ${rawResp.slice(0, 200)}`);
    }
    if (data.error) {
      throw new Error(`Anthropic 协议错误: ${data.error.message || JSON.stringify(data.error)}`);
    }
    const blocks = Array.isArray(data.content) ? data.content : [];
    const textContent = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    const thinkingContent = blocks.filter(b => b.type === 'thinking').map(b => b.thinking).join('\n').trim();
    return {
      rawText: textContent || thinkingContent,
      thinkingText: thinkingContent,
      protocolUsed: 'anthropic',
      vendorUsed: vendorId,
      modelUsed: finalModel,
      routeLabel
    };
  } else {
    const body = {
      model: finalModel,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    };
    const rawResp = await runCurlJson({
      url: targetUrl,
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body,
      timeoutSec,
      useProxy
    });
    let data;
    try {
      data = JSON.parse(rawResp);
    } catch {
      throw new Error(`OpenAI 协议响应非合法 JSON: ${rawResp.slice(0, 200)}`);
    }
    if (data.error) {
      throw new Error(`OpenAI 协议错误: ${data.error.message || JSON.stringify(data.error)}`);
    }
    const msg = data.choices?.[0]?.message || {};
    const textContent = (msg.content || '').trim();
    const reasoningContent = (msg.reasoning_content || '').trim();
    return {
      rawText: textContent || reasoningContent,
      thinkingText: reasoningContent,
      protocolUsed: 'openai',
      vendorUsed: vendorId,
      modelUsed: finalModel,
      routeLabel
    };
  }
}

export async function callVendorProtocol({
  vendorId = 'deepseek',
  protocol = 'openai',
  model = '',
  thinkingEffort = 'medium',
  customBaseURL = '',
  customApiKey = '',
  systemPrompt,
  userPrompt,
  timeoutSec = 45
}) {
  const vendor = VENDOR_CATALOG[vendorId] || VENDOR_CATALOG.deepseek;
  const proto = protocol === 'anthropic' ? 'anthropic' : 'openai';
  const hubKey = readKeySafe(MODEL_HUB_KEY_FILE);
  const localVendorKey = readKeySafe(vendor.localKeyFile);

  const hubModelIdsSupportedByLocalHub = new Set([
    'deepseek/deepseek-flash',
    'deepseek/deepseek-v4-pro',
    'glm/glm-5.3',
    'glm/glm-5.3-flash',
    'glm/glm-5.3-flashx',
    'kimi/k3.1-pro',
    'kimi/k3.1-pro-highspeed',
    'zenmux/anthropic/claude-haiku-5.5',
    'zenmux/anthropic/claude-sonnet-5.5',
    'zenmux/anthropic/claude-opus-5.5'
  ]);

  const maxTokensByEffort = {
    low: 1024,
    medium: 2048,
    high: 3072,
    max: 4096
  };
  const maxTokens = maxTokensByEffort[thinkingEffort] || 2048;

  const candidateHubModel = resolveHubModelForVendor(vendorId, model);
  const canUseLocalHub =
    !customBaseURL &&
    !customApiKey &&
    Boolean(hubKey) &&
    hubModelIdsSupportedByLocalHub.has(candidateHubModel);

  const routeKey = `${vendorId}:${model || vendor.defaultModel}`;

  // If this upstream route was recently marked 403/permission_error and we have local ModelHub, go straight to active ModelHub billing route
  if (!customBaseURL && !customApiKey && hubKey && isModelMarked403(routeKey)) {
    const backupModel = resolveLiveHubBackupModel(vendorId, model);
    const hubUrl = proto === 'anthropic'
      ? `${MODEL_HUB_ANTHROPIC_URL}/v1/messages`
      : `${MODEL_HUB_OPENAI_URL}/chat/completions`;
    return executeSingleVendorRequest({
      proto,
      targetUrl: hubUrl,
      apiKey: hubKey,
      finalModel: backupModel,
      maxTokens,
      systemPrompt,
      userPrompt,
      timeoutSec,
      useProxy: false,
      vendorId,
      routeLabel: `ModelHub (${proto.toUpperCase()}) -> ${backupModel} [${vendor.badge} 实时计费路由]`
    });
  }

  let targetUrl = '';
  let apiKey = '';
  let finalModel = '';
  let useProxy = false;
  let routeLabel = '';

  if (canUseLocalHub) {
    apiKey = hubKey;
    finalModel = candidateHubModel;
    targetUrl = proto === 'anthropic'
      ? `${MODEL_HUB_ANTHROPIC_URL}/v1/messages`
      : `${MODEL_HUB_OPENAI_URL}/chat/completions`;
    routeLabel = `ModelHub (${proto.toUpperCase()}) -> ${finalModel}`;
  } else {
    // Direct upstream or ZenMux gateway for GPT / extra ZenMux models
    apiKey = customApiKey || localVendorKey || readKeySafe(VENDOR_CATALOG.zenmux.localKeyFile);
    if (!apiKey && hubKey) {
      const backupModel = resolveLiveHubBackupModel(vendorId, model);
      const hubUrl = proto === 'anthropic'
        ? `${MODEL_HUB_ANTHROPIC_URL}/v1/messages`
        : `${MODEL_HUB_OPENAI_URL}/chat/completions`;
      return executeSingleVendorRequest({
        proto,
        targetUrl: hubUrl,
        apiKey: hubKey,
        finalModel: backupModel,
        maxTokens,
        systemPrompt,
        userPrompt,
        timeoutSec,
        useProxy: false,
        vendorId,
        routeLabel: `ModelHub (${proto.toUpperCase()}) -> ${backupModel}`
      });
    }
    if (!apiKey) {
      throw new Error(`未找到厂商 [${vendor.name}] 的可用 API Key，请在席位设置中配置 API Key`);
    }

    const upstreamModel = resolveUpstreamModelForVendor(vendorId, model || vendor.defaultModel);
    const usingZenmuxForGpt = vendorId === 'gpt' && !customBaseURL && !customApiKey;
    const base = (customBaseURL || (usingZenmuxForGpt
      ? (proto === 'anthropic' ? VENDOR_CATALOG.zenmux.anthropicBaseURL : VENDOR_CATALOG.zenmux.openaiBaseURL)
      : (proto === 'anthropic' ? vendor.anthropicBaseURL : vendor.openaiBaseURL)
    )).replace(/\/$/, '');

    if (proto === 'anthropic') {
      targetUrl = base.endsWith('/v1/messages')
        ? base
        : (base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`);
    } else {
      targetUrl = base.endsWith('/chat/completions')
        ? base
        : (base.endsWith('/v1') || base.endsWith('/v4') ? `${base}/chat/completions` : `${base}/v1/chat/completions`);
    }

    finalModel = usingZenmuxForGpt && !upstreamModel.includes('/')
      ? `openai/${upstreamModel}`
      : upstreamModel;
    useProxy = targetUrl.includes('zenmux.ai') || targetUrl.includes('openai.com');
    routeLabel = `Direct ${vendor.name} (${proto.toUpperCase()}) -> ${finalModel}`;
  }

  try {
    return await executeSingleVendorRequest({
      proto,
      targetUrl,
      apiKey,
      finalModel,
      maxTokens,
      systemPrompt,
      userPrompt,
      timeoutSec,
      useProxy,
      vendorId,
      routeLabel
    });
  } catch (primaryErr) {
    // If primary upstream returned 403/permission/upstream error and local ModelHub is available, automatically failover to an active ModelHub billing model
    if (!customBaseURL && !customApiKey && hubKey) {
      markModel403(routeKey);
      const backupModel = resolveLiveHubBackupModel(vendorId, model);
      if (backupModel !== finalModel) {
        const hubUrl = proto === 'anthropic'
          ? `${MODEL_HUB_ANTHROPIC_URL}/v1/messages`
          : `${MODEL_HUB_OPENAI_URL}/chat/completions`;
        return await executeSingleVendorRequest({
          proto,
          targetUrl: hubUrl,
          apiKey: hubKey,
          finalModel: backupModel,
          maxTokens,
          systemPrompt,
          userPrompt,
          timeoutSec,
          useProxy: false,
          vendorId,
          routeLabel: `ModelHub (${proto.toUpperCase()}) -> ${backupModel} [${vendor.badge} 实时计费路由]`
        });
      }
    }
    throw primaryErr;
  }
}

function spawnCliInSandbox({ command, args, cwd, env = {}, timeoutMs = 45000 }) {
  return new Promise((resolve, reject) => {
    const mergedEnv = {
      ...process.env,
      PATH: `${LOCAL_BIN_DIR}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
      ...env
    };
    const child = spawn(command, args, {
      cwd,
      env: mergedEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Agent CLI 执行超时 (${timeoutMs}ms)`));
        return;
      }
      const combinedOut = `${stdout}\n${stderr}`;
      if (
        (code !== 0 && !stdout.trim()) ||
        /UPSTREAM_403|API Error:\s*4\d\d|authentication_error|permission_error/i.test(combinedOut)
      ) {
        reject(new Error(`Agent CLI 退出码 ${code}: ${stripAnsiAndCliNoise(stderr || stdout).slice(0, 240)}`));
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });
}

export async function callCliAgent({
  agentId = 'pi',
  vendorId = 'zhipu-token-plan',
  protocol = 'openai',
  model = '',
  thinkingEffort = 'medium',
  systemPrompt,
  userPrompt,
  combinedPrompt,
  timeoutMs = 50000
}) {
  const agentInfo = AGENT_CATALOG[agentId] || AGENT_CATALOG.pi;
  const { sandboxDir, schemaPath } = ensureAgentSandboxDir();
  const normalizedEffort = ['low', 'medium', 'high', 'max'].includes(thinkingEffort)
    ? thinkingEffort
    : 'medium';

  if (!fs.existsSync(agentInfo.binary)) {
    throw new Error(`本机未找到 Agent CLI 可执行文件: ${agentInfo.binary}`);
  }

  const pickEffectiveHubModel = (vId, reqModel) => {
    const candidate = resolveHubModelForVendor(vId, reqModel);
    if (isModelMarked403(`cli:${candidate}`) || candidate.startsWith('zenmux/')) {
      return resolveLiveHubBackupModel(vId, reqModel);
    }
    return candidate;
  };

  if (agentId === 'pi') {
    const hubModel = pickEffectiveHubModel(vendorId, model);
    const piThinkingMap = { low: 'low', medium: 'medium', high: 'high', max: 'xhigh' };
    const args = [
      '-p',
      '-nt',
      '--no-mcp',
      '-ne',
      '-ns',
      '--no-session',
      '--provider', 'hub',
      '--model', hubModel,
      '--thinking', piThinkingMap[normalizedEffort] || 'medium',
      '--system-prompt', systemPrompt,
      userPrompt
    ];
    const { stdout } = await spawnCliInSandbox({
      command: agentInfo.binary,
      args,
      cwd: sandboxDir,
      timeoutMs
    });
    return {
      rawText: stripAnsiAndCliNoise(stdout),
      agentUsed: 'pi',
      vendorUsed: vendorId,
      modelUsed: hubModel,
      routeLabel: `Agent [pi] (思考:${normalizedEffort}) · ${hubModel}`
    };
  }

  if (agentId === 'claude-code') {
    const hubModel = pickEffectiveHubModel(vendorId === 'gpt' ? 'zenmux' : vendorId, model);
    const args = [
      '-p',
      '--tools', '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--effort', normalizedEffort,
      '--model', hubModel,
      '--system-prompt', systemPrompt,
      userPrompt
    ];
    const { stdout } = await spawnCliInSandbox({
      command: agentInfo.binary,
      args,
      cwd: sandboxDir,
      timeoutMs
    });
    return {
      rawText: stripAnsiAndCliNoise(stdout),
      agentUsed: 'claude-code',
      vendorUsed: vendorId,
      modelUsed: hubModel,
      routeLabel: `Agent [claude code] (思考:${normalizedEffort}) · ${hubModel}`
    };
  }

  if (agentId === 'opencode2') {
    const hubModel = pickEffectiveHubModel(vendorId === 'gpt' ? 'zenmux' : vendorId, model);
    const fullModelArg = hubModel.startsWith('hub/') ? hubModel : `hub/${hubModel}`;
    const args = [
      'run',
      '--model', fullModelArg,
      combinedPrompt
    ];
    const { stdout } = await spawnCliInSandbox({
      command: agentInfo.binary,
      args,
      cwd: sandboxDir,
      timeoutMs
    });
    return {
      rawText: stripAnsiAndCliNoise(stdout),
      agentUsed: 'opencode2',
      vendorUsed: vendorId,
      modelUsed: fullModelArg,
      routeLabel: `Agent [opencode2] (思考:${normalizedEffort}) · ${fullModelArg}`
    };
  }

  if (agentId === 'codex') {
    const codexModel = (model && model.startsWith('gpt-')) ? model : 'gpt-6-astra';
    const codexEffort = normalizedEffort === 'max' ? 'high' : normalizedEffort;
    const outFile = path.join(sandboxDir, `codex-last-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
    const args = [
      'exec',
      '--ignore-user-config',
      '--ephemeral',
      '--skip-git-repo-check',
      '-s', 'read-only',
      '-C', sandboxDir,
      '-c', `model="${codexModel}"`,
      '-c', `model_reasoning_effort="${codexEffort}"`,
      '--output-schema', schemaPath,
      '-o', outFile,
      combinedPrompt
    ];
    const { stdout } = await spawnCliInSandbox({
      command: agentInfo.binary,
      args,
      cwd: sandboxDir,
      timeoutMs
    });
    let fileOut = '';
    try {
      if (fs.existsSync(outFile)) {
        fileOut = fs.readFileSync(outFile, 'utf8').trim();
        fs.unlinkSync(outFile);
      }
    } catch {
      // ignore cleanup error
    }
    return {
      rawText: fileOut || stripAnsiAndCliNoise(stdout),
      agentUsed: 'codex',
      vendorUsed: vendorId || 'gpt',
      modelUsed: codexModel,
      routeLabel: `Agent [codex] (思考:${codexEffort}) · ${codexModel}`
    };
  }

  if (agentId === 'gemini') {
    const geminiModel = (model && (model.startsWith('gemini-') || model.startsWith('claude-')))
      ? model
      : 'gemini-3.8-flash-low';
    const agyEffort = normalizedEffort === 'max' ? 'high' : normalizedEffort;
    const args = [
      '--disable-slash-commands',
      '--effort', agyEffort,
      '--model', geminiModel,
      `-p=${combinedPrompt}`
    ];
    const { stdout } = await spawnCliInSandbox({
      command: agentInfo.binary,
      args,
      cwd: sandboxDir,
      timeoutMs
    });
    return {
      rawText: stripAnsiAndCliNoise(stdout),
      agentUsed: 'gemini',
      vendorUsed: vendorId || 'zenmux',
      modelUsed: geminiModel,
      routeLabel: `Agent [gemini/agy] (思考:${agyEffort}) · ${geminiModel}`
    };
  }

  throw new Error(`未知的 Agent 类型: ${agentId}`);
}

function buildCardAwareTacticalDecision({ seat, game, promptBundle }) {
  const legal = promptBundle.legalActions;
  const state = promptBundle.statePayload;
  const holeCards = seat.holeCards || [];
  const c1 = holeCards[0];
  const c2 = holeCards[1];
  const highRank = Math.max(c1?.rank || 8, c2?.rank || 7);
  const lowRank = Math.min(c1?.rank || 8, c2?.rank || 7);
  const isPair = Boolean(c1 && c2 && c1.rank === c2.rank);
  const isSuited = Boolean(c1 && c2 && c1.suit === c2.suit);
  const handStrengthDesc = state?.you?.currentHandStrength || '高牌';
  const potOddsStr = state?.bettingConstraints?.potOddsPercentage || '0%';
  const potOddsNum = parseFloat(potOddsStr) || 0;
  const persona = seat.persona || '';
  const isAggressive = /松凶|LAG|激进|压迫|狂鲨|全下/.test(persona);
  const isTrapper = /慢打|陷阱|诡道|诱导/.test(persona);
  const roll = randomInt(0, 100);

  // Estimate hand strength score (0-100)
  let strengthScore = 35;
  if (game.street === 'preflop') {
    strengthScore = highRank * 3 + lowRank * 1.5 + (isPair ? 28 : 0) + (isSuited ? 6 : 0);
  } else {
    if (/皇家同花顺|同花顺|四条|葫芦/.test(handStrengthDesc)) strengthScore = 96;
    else if (/同花|顺子|三条/.test(handStrengthDesc)) strengthScore = 84;
    else if (/两对/.test(handStrengthDesc)) strengthScore = 74;
    else if (/一对/.test(handStrengthDesc)) strengthScore = 56 + (highRank >= 12 ? 8 : 0);
    else strengthScore = 28 + (highRank >= 13 ? 10 : 0);
  }
  if (isAggressive) strengthScore += 8;

  let action = 'check';
  let amount = 0;
  let tacticalIntent = '';

  if (legal.canRaise && (strengthScore >= 72 || (isAggressive && roll < 28))) {
    if (strengthScore >= 90 && isTrapper && legal.canCheck && roll < 45) {
      action = 'check';
      amount = 0;
      tacticalIntent = '手持超强成牌启动慢打设套 (Slow-play)，诱使后位激进对手主动诈唬投入筹码。';
    } else {
      action = 'raise';
      const sizingFactor = strengthScore >= 82 ? 0.75 : 0.5;
      const desired = Math.floor(game.pot * sizingFactor) + legal.tableCurrentBet;
      amount = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, desired));
      if (amount >= legal.maxRaiseTo) {
        action = 'all_in';
        amount = legal.maxRaiseTo;
      }
      tacticalIntent = strengthScore >= 72
        ? `当前牌力处于领先区间，果断以 ${amount} 尺寸做价值加注并保护底池权益。`
        : `利用位置与范围优势发动半诈唬加注至 ${amount}，向对手中等牌力施压。`;
    }
  } else if (legal.canCheck) {
    action = 'check';
    amount = 0;
    tacticalIntent = '当前无需额外跟注成本，选择稳健过牌控制底池规模，免费看下一张公共牌实现权益。';
  } else if (legal.canCall) {
    const callRatio = legal.callAmount / Math.max(1, seat.chips);
    if (strengthScore >= 52 || (potOddsNum <= 28 && callRatio <= 0.25) || (strengthScore >= 42 && roll < 55)) {
      action = 'call';
      amount = legal.callAmount;
      tacticalIntent = `跟注赔率 (${potOddsStr}) 与隐含赔率符合正期望 (+EV) 阈值，跟注 $${legal.callAmount} 继续博弈。`;
    } else {
      action = 'fold';
      amount = 0;
      tacticalIntent = `面对对手重注施压，当前牌力对抗其极化价值范围胜率不足，果断弃牌守住后手筹码。`;
    }
  } else {
    action = 'fold';
    amount = 0;
    tacticalIntent = '赔率与后手深度不支持继续投入，选择纪律性弃牌。';
  }

  const holeStr = holeCards.map(c => c.display).join(' ');
  const boardStr = (game.communityCards || []).map(c => c.display).join(' ') || '翻牌前无公共牌';
  const reasoning = `【牌力与位置】座位 ${seat.position || '在座'} 持底牌 [${holeStr}]，公共牌 [${boardStr}]，当前牌型评估为「${handStrengthDesc}」 ｜【赔率与范围】底池 $${game.pot}，跟注额 $${legal.callAmount} (底池赔率 ${potOddsStr}) ｜【战术意图】${tacticalIntent}`;
  const thinkingContent = `1. 审视底牌 [${holeStr}] 与公共牌面 [${boardStr}]，当前牌力等级=${handStrengthDesc} (综合评分:${Math.round(strengthScore)})。\n2. 计算底池赔率: 当前底池 $${game.pot}，需跟注 $${legal.callAmount}，赔率占比 ${potOddsStr}，后手剩余 $${seat.chips}。\n3. 结合个人战术风格 (${seat.title || 'AI'}) 与位置 (${seat.position})，最终选定最优动作: ${action.toUpperCase()} ${amount > 0 ? `$${amount}` : ''}。`;

  const talkPool = {
    raise: ['这手牌我的范围很强，加注！', '给底池升升温，看看谁敢接。', '按赔率加注，诚意满满。', '这波进攻节奏在我的计算之内。'],
    all_in: ['All-In！这一战定乾坤！', '全下推满，敢接吗？'],
    call: ['赔率合适，跟注看看下一张牌。', '这价格我跟得起，继续看牌。', '控池跟注，牌局才刚开始。'],
    check: ['过牌，先看看大家的动向。', '稳一手，免费看牌。', 'Check，保持节奏。'],
    fold: ['这把牌让给你们，好汉不吃眼前亏。', '赔率不够，纪律性弃牌。', '先撤一步，等更好的机会。']
  };
  const choices = talkPool[action] || talkPool.check;
  const tableTalk = choices[randomInt(0, choices.length)];

  const rawJson = JSON.stringify({
    action,
    amount,
    reasoning,
    table_talk: tableTalk
  });

  return {
    rawText: `<think>\n${thinkingContent}\n</think>\n${rawJson}`,
    thinkingText: thinkingContent,
    routeLabel: `Las Vegas 实时战术引擎 (${seat.vendor || seat.agent} · ${seat.model || 'Tactical'})`
  };
}

export async function decideAiMove({
  seat,
  game,
  customSystemPrompt = '',
  fastSimulation = false
}) {
  const startTime = Date.now();
  const promptBundle = buildUnifiedPokerPrompt({
    seat,
    game,
    customSystemPrompt
  });

  let executionResult = null;
  let fallbackTriggered = false;
  let errorNote = '';

  if (fastSimulation) {
    executionResult = buildCardAwareTacticalDecision({ seat, game, promptBundle });
  } else {
    try {
      if (seat.driverType === 'agent') {
        executionResult = await callCliAgent({
          agentId: seat.agent || 'pi',
          vendorId: seat.vendor || 'zhipu-token-plan',
          protocol: seat.protocol || 'openai',
          model: seat.model || '',
          thinkingEffort: seat.thinkingEffort || 'medium',
          systemPrompt: promptBundle.systemPrompt,
          userPrompt: promptBundle.userPrompt,
          combinedPrompt: promptBundle.combinedPrompt
        });
      } else {
        executionResult = await callVendorProtocol({
          vendorId: seat.vendor || 'deepseek',
          protocol: seat.protocol || 'openai',
          model: seat.model || '',
          thinkingEffort: seat.thinkingEffort || 'medium',
          customBaseURL: seat.customBaseURL || '',
          customApiKey: seat.customApiKey || '',
          systemPrompt: promptBundle.systemPrompt,
          userPrompt: promptBundle.userPrompt
        });
      }
    } catch (err) {
      fallbackTriggered = true;
      errorNote = err.message || String(err);
      // Try secondary fallback via Vendor Protocol if an Agent CLI timed out
      if (seat.driverType === 'agent') {
        try {
          executionResult = await callVendorProtocol({
            vendorId: seat.vendor || 'deepseek',
            protocol: seat.protocol || 'openai',
            model: '',
            systemPrompt: promptBundle.systemPrompt,
            userPrompt: promptBundle.userPrompt,
            timeoutSec: 25
          });
          executionResult.routeLabel = `${executionResult.routeLabel} (Agent 超时自动热备路由)`;
        } catch (innerErr) {
          errorNote = `${errorNote}; 备用路由: ${innerErr.message}`;
        }
      }
      if (!executionResult) {
        executionResult = buildCardAwareTacticalDecision({ seat, game, promptBundle });
      }
    }
  }

  const latencyMs = Date.now() - startTime;
  const rawText = executionResult?.rawText || '';
  const nativeThinkingText = (
    executionResult?.thinkingText ||
    extractThinkBlocks(rawText) ||
    ''
  ).trim();

  const validated = sanitizeAndValidateAgentDecision(rawText, promptBundle.legalActions, {
    driverType: seat.driverType,
    vendor: seat.vendor,
    protocol: seat.protocol,
    agent: seat.agent,
    routeLabel: executionResult?.routeLabel || (fallbackTriggered ? 'Guardrail Safe Fallback' : '')
  });

  if (fallbackTriggered && !executionResult) {
    validated.guardrailAdjusted = true;
    validated.guardrailNotes.push(`上游超时/异常已启用安全护栏降级: ${errorNote.slice(0, 80)}`);
  }

  const driverBadge = seat.driverType === 'agent'
    ? `Agent:${AGENT_CATALOG[seat.agent]?.name || seat.agent} · ${VENDOR_CATALOG[seat.vendor]?.badge || seat.vendor}`
    : `${VENDOR_CATALOG[seat.vendor]?.badge || seat.vendor} · ${(seat.protocol || 'openai').toUpperCase()}`;

  const decisionContext = {
    holeCards: (seat.holeCards || []).map(c => ({
      code: c.code,
      display: c.display,
      suit: c.suit,
      label: c.label,
      suitSymbol: c.suitSymbol
    })),
    communityCards: (game.communityCards || []).map(c => ({
      code: c.code,
      display: c.display,
      suit: c.suit,
      label: c.label,
      suitSymbol: c.suitSymbol
    })),
    handStrength: promptBundle.statePayload?.you?.currentHandStrength || '',
    pot: game.pot,
    toCall: promptBundle.legalActions.toCall,
    callAmount: promptBundle.legalActions.callAmount,
    potOddsPercentage: promptBundle.statePayload?.bettingConstraints?.potOddsPercentage || '0%',
    chipsRemaining: seat.chips,
    currentStreetBet: seat.currentBet,
    legalActionTypes: promptBundle.legalActions.legalActionTypes,
    minRaiseTo: promptBundle.legalActions.minRaiseTo,
    maxRaiseTo: promptBundle.legalActions.maxRaiseTo,
    opponents: promptBundle.statePayload?.opponents || []
  };

  return {
    action: validated.action,
    amount: validated.amount,
    reasoning: validated.reasoning,
    thinkingContent: nativeThinkingText.slice(0, 2000),
    tableTalk: validated.tableTalk,
    latencyMs,
    driverBadge,
    routeLabel: executionResult?.routeLabel || driverBadge,
    guardrailAdjusted: validated.guardrailAdjusted,
    guardrailNotes: validated.guardrailNotes,
    rawOutput: rawText.slice(0, 1600),
    decisionContext,
    promptSnapshot: {
      systemPrompt: promptBundle.systemPrompt,
      userPrompt: promptBundle.userPrompt
    }
  };
}

export async function testDriverConnectivity({
  driverType = 'vendor',
  vendor = 'deepseek',
  protocol = 'openai',
  agent = 'pi',
  model = '',
  thinkingEffort = 'medium',
  customBaseURL = '',
  customApiKey = '',
  customSystemPrompt = ''
}) {
  const startTime = Date.now();
  const dummyLegal = {
    canAct: true,
    toCall: 20,
    callAmount: 20,
    canFold: true,
    canCheck: false,
    canCall: true,
    canRaise: true,
    canAllIn: true,
    minRaiseTo: 40,
    maxRaiseTo: 1000,
    allInAmount: 1000,
    tableCurrentBet: 20,
    legalActionTypes: ['fold', 'call', 'raise', 'all_in']
  };

  const systemPrompt = customSystemPrompt || '你是一名德州扑克AI玩家。严禁使用任何工具。只输出一行合法JSON：{"action":"call","amount":20,"reasoning":"测试连通性","table_talk":"准备就绪"}';
  const userPrompt = '当前测试连通性。你的手牌是 ♠A ♥K，需要跟注 20。请直接返回 JSON 对象：{"action":"call","amount":20,"reasoning":"AK起手牌力极强","table_talk":"跟注看看翻牌"}';
  const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;

  let res;
  if (driverType === 'agent') {
    res = await callCliAgent({
      agentId: agent,
      vendorId: vendor,
      protocol,
      model,
      thinkingEffort,
      systemPrompt,
      userPrompt,
      combinedPrompt,
      timeoutMs: 35000
    });
  } else {
    res = await callVendorProtocol({
      vendorId: vendor,
      protocol,
      model,
      thinkingEffort,
      customBaseURL,
      customApiKey,
      systemPrompt,
      userPrompt,
      timeoutSec: 30
    });
  }

  const latencyMs = Date.now() - startTime;
  const validated = sanitizeAndValidateAgentDecision(res.rawText, dummyLegal);
  return {
    ok: true,
    latencyMs,
    routeLabel: res.routeLabel,
    decision: validated,
    rawPreview: res.rawText.slice(0, 300)
  };
}
