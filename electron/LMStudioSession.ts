import { ipcMain, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { execSync, spawn } from 'child_process';
import * as os from 'os';
import { pathToFileURL } from 'url';

type LLMProvider = 'lmstudio' | 'codex' | 'claude';

interface ImageAttachment {
  mimeType: string;
  data: string; // base64
}

interface LLMInput {
  text: string;
  images?: ImageAttachment[];
  deepThinking?: boolean;
}

type ChatInputItem =
  | { type: 'text'; content: string }
  | { type: 'image'; data_url: string };

interface SessionState {
  previousResponseId: string | null;
  systemPrompt: string;
  selectedPrompt: string | null;
  currentModel: string | null;
  abort: AbortController | null;
  startedAt: number;
  provider: LLMProvider;
  messages: Array<{ role: string; content: string }>;
  codexThreadId: string | null;
  claudeSessionId: string | null;
}

const LM_STUDIO_BASE_URL = 'http://127.0.0.1:1234';
const DEFAULT_MODEL = 'google/gemma-4-12b';

let cachedModel: string | null = null;
let cachedModelAt = 0;
const MODEL_CACHE_TTL_MS = 5000;

const modelsWithoutReasoning = new Set<string>();

async function getCurrentModel(): Promise<string> {
  const now = Date.now();
  if (cachedModel && now - cachedModelAt < MODEL_CACHE_TTL_MS) return cachedModel;
  try {
    const data = await new Promise<string>((resolve, reject) => {
      const req = http.get(
        `${LM_STUDIO_BASE_URL}/v1/models`,
        { headers: { Accept: 'application/json' } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve(body));
        }
      );
      req.on('error', reject);
      req.setTimeout(2000, () => { req.destroy(new Error('timeout')); });
    });
    const json = JSON.parse(data);
    const first = json?.data?.[0]?.id;
    if (first) {
      cachedModel = first;
      cachedModelAt = now;
      return first;
    }
  } catch {
    // 忽略
  }
  return DEFAULT_MODEL;
}

const MAX_SESSIONS = 2;
const sessions = new Map<string, SessionState>();

function findPromptsDir(sessionId: string): string | null {
  const candidates: string[] = [];
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'personas', sessionId, 'prompts'));
  }
  candidates.push(path.join(process.cwd(), 'personas', sessionId, 'prompts'));
  candidates.push(path.join(app.getAppPath(), 'personas', sessionId, 'prompts'));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function listPrompts(sessionId: string): string[] {
  const dir = findPromptsDir(sessionId);
  if (!dir) return [];
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.md'))
      .map((f) => f.replace(/\.md$/i, ''))
      .sort();
  } catch {
    return [];
  }
}

function findLegacyPersonaFile(sessionId: string): string | null {
  const candidates: string[] = [];
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'personas', sessionId, 'persona.md'));
  }
  candidates.push(path.join(process.cwd(), 'personas', sessionId, 'persona.md'));
  candidates.push(path.join(app.getAppPath(), 'personas', sessionId, 'persona.md'));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function loadSystemPrompt(sessionId: string, promptName?: string | null): string {
  const dir = findPromptsDir(sessionId);
  if (dir) {
    const available = listPrompts(sessionId);
    const name = promptName && available.includes(promptName) ? promptName : available[0];
    if (name) {
      try {
        return fs.readFileSync(path.join(dir, `${name}.md`), 'utf-8');
      } catch (e) {
        console.error(`[LMStudioSession] Failed to read prompt "${name}" for ${sessionId}:`, e);
      }
    }
  }
  const legacy = findLegacyPersonaFile(sessionId);
  if (legacy) {
    try {
      return fs.readFileSync(legacy, 'utf-8');
    } catch (e) {
      console.error(`[LMStudioSession] Failed to read legacy persona for ${sessionId}:`, e);
    }
  }
  return `You are ${sessionId}, a helpful desktop companion. Reply concisely.`;
}

function defaultPromptName(sessionId: string): string | null {
  const available = listPrompts(sessionId);
  const casual = available.find((p) => p.includes('闲聊'));
  return casual ?? available[0] ?? null;
}

function ensureSession(sessionId: string): SessionState {
  let state = sessions.get(sessionId);
  if (state) return state;

  if (sessions.size >= MAX_SESSIONS) {
    let oldestId = '';
    let oldestTime = Infinity;
    sessions.forEach((s, id) => {
      if (s.startedAt < oldestTime) {
        oldestTime = s.startedAt;
        oldestId = id;
      }
    });
    if (oldestId) {
      const old = sessions.get(oldestId);
      old?.abort?.abort();
      sessions.delete(oldestId);
    }
  }

  const selectedPrompt = defaultPromptName(sessionId);
  state = {
    previousResponseId: null,
    systemPrompt: loadSystemPrompt(sessionId, selectedPrompt),
    selectedPrompt,
    currentModel: 'Codex',
    abort: null,
    startedAt: Date.now(),
    provider: 'codex',
    messages: [],
    codexThreadId: null,
    claudeSessionId: null,
  };
  sessions.set(sessionId, state);
  return state;
}

function buildInput(input: LLMInput): ChatInputItem[] {
  const items: ChatInputItem[] = [];
  if (input.images && input.images.length > 0) {
    for (const img of input.images) {
      items.push({ type: 'image', data_url: `data:${img.mimeType};base64,${img.data}` });
    }
  }
  if (input.text) {
    items.push({ type: 'text', content: input.text });
  }
  if (items.length === 0) {
    items.push({ type: 'text', content: '' });
  }
  return items;
}

interface CleanState {
  inUserBlock: boolean;
  inSystemBlock: boolean;
  inAssistantBlock: boolean;
  buffer: string;
}

function createCleanState(): CleanState {
  return { inUserBlock: false, inSystemBlock: false, inAssistantBlock: true, buffer: '' };
}

function cleanChatMLIncremental(state: CleanState, chunk: string): string {
  if (!chunk) return '';
  state.buffer += chunk;

  let result = '';
  let searchFrom = 0;

  while (true) {
    const remaining = state.buffer.slice(searchFrom);
    if (!remaining) break;

    const imStart = remaining.indexOf('<|im_start|>');
    const imEnd = remaining.indexOf('<|im_end|>');

    if (imStart === -1 && imEnd === -1) {
      const lastNewline = remaining.lastIndexOf('\n');
      const keepStart = lastNewline >= 0 ? searchFrom + lastNewline + 1 : searchFrom;
      const candidate = state.buffer.slice(searchFrom, keepStart);
      const rest = state.buffer.slice(keepStart);
      if (state.inAssistantBlock && candidate) {
        result += candidate;
      }
      state.buffer = rest;
      break;
    }

    if (imStart !== -1 && (imEnd === -1 || imStart < imEnd)) {
      const before = remaining.slice(0, imStart);
      if (state.inAssistantBlock && before) {
        result += before;
      }
      const after = remaining.slice(imStart + '<|im_start|>'.length);
      const roleMatch = after.match(/^(user|assistant|system)\s*\n?/);
      if (roleMatch) {
        const role = roleMatch[1];
        state.inUserBlock = role === 'user';
        state.inSystemBlock = role === 'system';
        state.inAssistantBlock = role === 'assistant';
        searchFrom += imStart + '<|im_start|>'.length + roleMatch[0].length;
      } else {
        state.buffer = remaining;
        break;
      }
    } else {
      const before = remaining.slice(0, imEnd);
      if (state.inAssistantBlock && before) {
        result += before;
      }
      state.inUserBlock = false;
      state.inSystemBlock = false;
      state.inAssistantBlock = true;
      searchFrom += imEnd + '<|im_end|>'.length;
    }
  }

  return result;
}

function finalizeClean(state: CleanState): string {
  let result = '';
  if (state.inAssistantBlock && state.buffer) {
    result = state.buffer;
  }
  state.buffer = '';
  return result;
}

async function streamCompletion(
  sessionId: string,
  input: ChatInputItem[],
  broadcast: (channel: string, ...args: any[]) => void,
  deepThinking: boolean
) {
  const state = sessions.get(sessionId);
  if (!state) return;

  const abort = new AbortController();
  state.abort = abort;

  const cleanContent = createCleanState();
  const cleanReasoning = createCleanState();

  try {
    const model = await getCurrentModel();
    if (state.currentModel && state.currentModel !== model) {
      state.previousResponseId = null;
      state.systemPrompt = loadSystemPrompt(sessionId, state.selectedPrompt);
    }
    state.currentModel = model;

    const url = new URL(`${LM_STUDIO_BASE_URL}/api/v1/chat`);
    let useReasoning = deepThinking || !modelsWithoutReasoning.has(model);
    let res!: http.IncomingMessage;

    for (let attempt = 0; attempt < 2; attempt++) {
      const payload: Record<string, any> = {
        model,
        input,
        stream: true,
        store: true,
      };
      if (useReasoning) {
        payload.reasoning = deepThinking ? 'on' : 'off';
      }
      if (state.previousResponseId) {
        payload.previous_response_id = state.previousResponseId;
      } else {
        payload.system_prompt = state.systemPrompt;
      }
      const body = JSON.stringify(payload);

      res = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: url.hostname,
            port: url.port || 80,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              'Accept': 'text/event-stream',
              'Connection': 'keep-alive',
            },
          },
          (response) => {
            response.socket?.setNoDelay(true);
            resolve(response);
          }
        );
        req.on('socket', (socket) => {
          socket.setNoDelay(true);
        });
        req.on('error', reject);
        abort.signal.addEventListener('abort', () => req.destroy(new Error('AbortError')));
        req.write(body);
        req.end();
      });

      if (res.statusCode && res.statusCode >= 400) {
        const errText: string = await new Promise((resolve) => {
          let s = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (s += c));
          res.on('end', () => resolve(s || `HTTP ${res.statusCode}`));
        });
        if (
          useReasoning &&
          res.statusCode === 400 &&
          /reasoning/i.test(errText) &&
          attempt === 0
        ) {
          modelsWithoutReasoning.add(model);
          useReasoning = false;
          continue;
        }
        throw new Error(`LM Studio error (${res.statusCode}): ${errText}`);
      }
      break;
    }

    res.setEncoding('utf8');
    let buffer = '';

    const IPC_FLUSH_INTERVAL_MS = 30;
    let pendingDelta = '';
    let pendingReasoning = '';
    let lastFlush = 0;
    let firstIpcSent = false;

    const flushDelta = () => {
      if (pendingReasoning) {
        broadcast('llm-reasoning', sessionId, pendingReasoning);
        pendingReasoning = '';
      }
      if (pendingDelta) {
        broadcast('llm-data', sessionId, pendingDelta);
        pendingDelta = '';
      }
      firstIpcSent = true;
      lastFlush = Date.now();
    };

    const maybeFlush = () => {
      const now = Date.now();
      if (!firstIpcSent || now - lastFlush >= IPC_FLUSH_INTERVAL_MS) {
        flushDelta();
      }
    };

    const handleEvent = (eventType: string, data: any): Error | null => {
      switch (eventType) {
        case 'reasoning.delta': {
          const delta: string = data?.content ?? '';
          if (delta) {
            const cleaned = cleanChatMLIncremental(cleanReasoning, delta);
            if (cleaned) {
              pendingReasoning += cleaned;
              maybeFlush();
            }
          }
          break;
        }
        case 'message.delta': {
          const delta: string = data?.content ?? '';
          if (delta) {
            const cleaned = cleanChatMLIncremental(cleanContent, delta);
            if (cleaned) {
              pendingDelta += cleaned;
              maybeFlush();
            }
          }
          break;
        }
        case 'reasoning.end': {
          const tail = finalizeClean(cleanReasoning);
          if (tail) pendingReasoning += tail;
          flushDelta();
          broadcast('llm-reasoning-end', sessionId);
          break;
        }
        case 'chat.end': {
          const tail = finalizeClean(cleanContent);
          if (tail) pendingDelta += tail;
          flushDelta();
          const rid = data?.result?.response_id;
          if (rid) state.previousResponseId = rid;
          break;
        }
        case 'error':
          return new Error(data?.error?.message || 'LM Studio stream error');
        default:
          break;
      }
      return null;
    };

    await new Promise<void>((resolve, reject) => {
      let currentEvent = '';
      res.on('data', (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, '');
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            const payloadStr = line.slice(5).trim();
            if (!payloadStr || payloadStr === '[DONE]') continue;
            try {
              const json = JSON.parse(payloadStr);
              const err = handleEvent(currentEvent || json?.type, json);
              if (err) { reject(err); return; }
            } catch {
              // 忽略非 JSON 行
            }
          }
          else if (line.trim() === '') {
            currentEvent = '';
          }
        }
      });
      res.on('end', () => {
        const tail = finalizeClean(cleanContent);
        if (tail) pendingDelta += tail;
        const rtail = finalizeClean(cleanReasoning);
        if (rtail) pendingReasoning += rtail;
        flushDelta();
        resolve();
      });
      res.on('error', reject);
      abort.signal.addEventListener('abort', () => {
        res.destroy(new Error('AbortError'));
        resolve();
      });
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      // Cancelled by user
    } else {
      console.error(`[LMStudioSession ${sessionId}] error:`, e);
      broadcast('llm-error', sessionId, e?.message || String(e));
    }
  } finally {
    state.abort = null;
    broadcast('llm-turn-complete', sessionId);
  }
}

export function setupLMStudioSession(broadcast: (channel: string, ...args: any[]) => void) {
  ipcMain.on('start-llm', (_event, sessionId: string) => {
    ensureSession(sessionId);
  });

  ipcMain.on('send-llm-input', (_event, sessionId: string, input: string | LLMInput) => {
    const state = ensureSession(sessionId);
    const normalized: LLMInput = typeof input === 'string' ? { text: input } : input;
    state.abort?.abort();
    if (state.provider === 'codex') {
      streamCodexCompletion(sessionId, normalized, broadcast);
    } else if (state.provider === 'claude') {
      streamClaudeCompletion(sessionId, normalized, broadcast);
    } else {
      const items = buildInput(normalized);
      streamCompletion(sessionId, items, broadcast, normalized.deepThinking === true);
    }
  });

  ipcMain.on('kill-llm', (_event, sessionId: string) => {
    const state = sessions.get(sessionId);
    if (state) {
      state.abort?.abort();
      sessions.delete(sessionId);
    }
  });

  ipcMain.on('stop-llm', (_event, sessionId: string) => {
    const state = sessions.get(sessionId);
    if (state) {
      state.abort?.abort();
      state.abort = null;
    }
  });

  ipcMain.on('clear-llm', (_event, sessionId: string) => {
    const state = sessions.get(sessionId);
    if (state) {
      state.abort?.abort();
      state.previousResponseId = null;
      state.systemPrompt = loadSystemPrompt(sessionId, state.selectedPrompt);
      state.messages = [];
      state.codexThreadId = null;
      state.claudeSessionId = null;
      state.abort = null;
    }
  });

  ipcMain.handle('list-prompts', (_event, sessionId: string) => {
    const state = ensureSession(sessionId);
    return { prompts: listPrompts(sessionId), selected: state.selectedPrompt };
  });

  ipcMain.on('set-prompt', (_event, sessionId: string, promptName: string) => {
    const state = ensureSession(sessionId);
    state.abort?.abort();
    state.selectedPrompt = promptName;
    state.systemPrompt = loadSystemPrompt(sessionId, promptName);
    state.previousResponseId = null;
    state.messages = [];
    state.codexThreadId = null;
    state.claudeSessionId = null;
    state.abort = null;
  });

  ipcMain.on('set-provider', (_event, sessionId: string, provider: LLMProvider, modelName?: string) => {
    const state = ensureSession(sessionId);
    if (state.provider === provider && (!modelName || state.currentModel === modelName)) return;
    state.abort?.abort();
    state.provider = provider;
    state.previousResponseId = null;
    state.messages = [];
    state.codexThreadId = null;
    state.claudeSessionId = null;
    state.systemPrompt = loadSystemPrompt(sessionId, state.selectedPrompt);
    state.abort = null;
    if (modelName) {
      state.currentModel = modelName;
    } else {
      if (provider === 'codex') state.currentModel = 'Codex';
      else if (provider === 'claude') state.currentModel = 'Claude';
      else state.currentModel = null;
    }
  });
}

// ============ Codex Session (reads codex config.toml) ============

interface CodexProviderConfig {
  name: string;
  baseUrl: string;
  wireApi: string;
  authCommand?: string;
  authArgs?: string[];
  httpHeaders?: Record<string, string>;
}

interface CodexConfig {
  model: string;
  modelProvider: string;
  reasoningEffort?: string;
  providers: Record<string, CodexProviderConfig>;
}

let cachedCodexConfig: CodexConfig | null = null;
let codexConfigMtime: number = 0;

function getCodexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function parseSimpleToml(text: string): any {
  const result: any = {};
  let currentSection: string | null = null;
  const lines = text.split('\n');

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    const tableMatch = line.match(/^\[([^\]]+)\]$/);
    if (tableMatch) {
      currentSection = tableMatch[1].trim();
      continue;
    }

    const eqMatch = line.match(/^([^=]+)=(.*)$/);
    if (!eqMatch) continue;

    let key = eqMatch[1].trim();
    let value: any = eqMatch[2].trim();

    // Parse arrays
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      if (inner === '') {
        value = [];
      } else {
        const items: string[] = [];
        let current = '';
        let inQuote = false;
        let quoteChar = '';
        for (let i = 0; i < inner.length; i++) {
          const ch = inner[i];
          if (inQuote) {
            if (ch === quoteChar) {
              inQuote = false;
            } else {
              current += ch;
            }
          } else if (ch === '"' || ch === "'") {
            inQuote = true;
            quoteChar = ch;
          } else if (ch === ',') {
            items.push(current.trim());
            current = '';
          } else {
            current += ch;
          }
        }
        if (current.trim()) items.push(current.trim());
        value = items;
      }
    }
    // Remove quotes from string values
    else if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    const target = currentSection ? resolvePath(result, currentSection) : result;
    if (target) {
      target[key] = value;
    }
  }

  return result;
}

function resolvePath(obj: any, pathStr: string): any {
  const parts = pathStr.split('.');
  let current = obj;
  for (const part of parts) {
    if (!current[part]) {
      current[part] = {};
    }
    current = current[part];
  }
  return current;
}

function loadCodexConfig(): CodexConfig {
  const configPath = path.join(getCodexHome(), 'config.toml');
  let mtime = 0;
  try {
    mtime = fs.statSync(configPath).mtimeMs;
  } catch {
    // Config file not found
  }

  if (cachedCodexConfig && mtime === codexConfigMtime) {
    return cachedCodexConfig;
  }

  const defaultConfig: CodexConfig = {
    model: 'gpt-5.5-paygo',
    modelProvider: 'aiden_gw',
    providers: {
      aiden_gw: {
        name: 'aiden_gw',
        baseUrl: 'https://aiden-aiproxy.bytedance.net/v2',
        wireApi: 'responses',
        authCommand: 'cmd',
        authArgs: ['/c', 'aiden', 'auth', 'get-sso-token'],
      },
    },
  };

  try {
    const text = fs.readFileSync(configPath, 'utf-8');
    const parsed = parseSimpleToml(text);

    const config: CodexConfig = {
      model: parsed.model || defaultConfig.model,
      modelProvider: parsed.model_provider || defaultConfig.modelProvider,
      reasoningEffort: parsed.model_reasoning_effort,
      providers: {},
    };

    if (parsed.model_providers) {
      for (const [name, prov] of Object.entries(parsed.model_providers) as [string, any][]) {
        const provider: CodexProviderConfig = {
          name: prov.name || name,
          baseUrl: prov.base_url || '',
          wireApi: prov.wire_api || 'chat',
        };
        if (prov.auth?.command) {
          provider.authCommand = prov.auth.command;
          if (prov.auth.args && Array.isArray(prov.auth.args)) {
            provider.authArgs = prov.auth.args;
          }
        }
        if (prov.http_headers && typeof prov.http_headers === 'object') {
          provider.httpHeaders = prov.http_headers as Record<string, string>;
        }
        config.providers[name] = provider;
      }
    }

    // Merge defaults for missing providers
    for (const [name, prov] of Object.entries(defaultConfig.providers)) {
      if (!config.providers[name]) {
        config.providers[name] = prov;
      }
    }

    cachedCodexConfig = config;
    codexConfigMtime = mtime;
    return config;
  } catch (e) {
    console.warn('[CodexSession] Failed to load codex config, using defaults:', e);
    return defaultConfig;
  }
}

let cachedAuthToken: string | null = null;
let cachedTokenExpiry: number = 0;
let cachedPatchScriptPath: string | null = null;

function getPatchScriptPath(): string {
  if (cachedPatchScriptPath && fs.existsSync(cachedPatchScriptPath)) {
    return cachedPatchScriptPath;
  }

  const tmpDir = path.join(os.tmpdir(), 'lvyy-aiden-patch');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}

  const patchPath = path.join(tmpDir, 'aiden-log-patch.cjs');
  const patchContent = `
const fs = require('fs');
const path = require('path');
const os = require('os');

const originalMkdirSync = fs.mkdirSync.bind(fs);
const originalMkdir = fs.mkdir.bind(fs);

const tmpLogDir = path.join(os.tmpdir(), 'lvyy-aiden-logs');
try { originalMkdirSync(tmpLogDir, { recursive: true }); } catch {}

function shouldRedirect(logPath) {
  if (!logPath) return false;
  const normalized = path.normalize(logPath);
  const aidenLog = path.join(os.homedir(), '.aiden', 'log');
  return normalized.startsWith(path.normalize(aidenLog));
}

function getRedirectedPath(logPath) {
  const normalized = path.normalize(logPath);
  const aidenLog = path.normalize(path.join(os.homedir(), '.aiden', 'log'));
  const relative = normalized.substring(aidenLog.length);
  return path.join(tmpLogDir, relative);
}

fs.mkdirSync = function(dirPath, options) {
  if (shouldRedirect(dirPath)) {
    const newPath = getRedirectedPath(dirPath);
    try {
      return originalMkdirSync(newPath, options);
    } catch (e) {
      if (e.code === 'EEXIST') return newPath;
      throw e;
    }
  }
  return originalMkdirSync(dirPath, options);
};

fs.mkdir = function(dirPath, options, callback) {
  if (shouldRedirect(dirPath)) {
    const newPath = getRedirectedPath(dirPath);
    return originalMkdir(newPath, options, callback);
  }
  return originalMkdir(dirPath, options, callback);
};

module.exports = fs;
`.trim();

  try {
    fs.writeFileSync(patchPath, patchContent, 'utf8');
    cachedPatchScriptPath = patchPath;
    return patchPath;
  } catch (e) {
    console.warn('[CodexSession] Failed to write patch script:', e);
    return '';
  }
}

async function getAuthTokenFromSDK(provider: CodexProviderConfig): Promise<string | null> {
  try {
    const aidenCorePath = path.join(
      os.homedir(),
      'AppData',
      'Roaming',
      'npm',
      'node_modules',
      '@aiden-cli',
      'core',
      'node_modules',
      '@bytedance-dev',
      'bytecloud-auth-sdk',
      'dist',
      'index.js'
    );

    if (!fs.existsSync(aidenCorePath)) {
      return null;
    }

    const sdk: any = await import(pathToFileURL(aidenCorePath).href);
    const createClient = sdk.createByteCloudAuthClient || sdk.default?.createByteCloudAuthClient;
    if (!createClient) {
      return null;
    }

    const client = createClient({
      appName: 'aiden-cli',
    });

    await client.ready();

    const creds = await client.auth.getCredentials({ site: 'cn' });
    await client.close();

    if (creds?.jwtToken) {
      return creds.jwtToken;
    }

    return null;
  } catch (e: any) {
    console.warn('[CodexSession] SDK auth failed, falling back to command:', e?.message || e);
    return null;
  }
}

async function getAuthToken(provider: CodexProviderConfig): Promise<string> {
  if (provider.httpHeaders) {
    const bearer = provider.httpHeaders['Authorization'] || provider.httpHeaders['Byted-Authorization'];
    if (bearer) {
      const token = bearer.replace(/^Bearer\s+/i, '');
      return token;
    }
  }

  const now = Date.now();
  if (cachedAuthToken && now < cachedTokenExpiry - 60000) {
    return cachedAuthToken;
  }

  if (provider.authCommand) {
    try {
      const args = provider.authArgs || [];

      const extraPaths = [
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'),
        path.join(process.env.ProgramFilesx86 || 'C:\\Program Files (x86)', 'nodejs'),
      ];
      const existingPath = process.env.PATH || '';
      const envPath = [...extraPaths, existingPath].filter(Boolean).join(path.delimiter);

      const patchPath = getPatchScriptPath();
      const nodeOptions = patchPath
        ? `${process.env.NODE_OPTIONS || ''} --require "${patchPath.replace(/\\/g, '/')}"`.trim()
        : process.env.NODE_OPTIONS || '';

      const baseEnv = {
        ...process.env,
        PATH: envPath,
        PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.CPL',
        HOME: os.homedir(),
        USERPROFILE: os.homedir(),
        NODE_OPTIONS: nodeOptions,
      };

      const cmd = `"${provider.authCommand}" ${args.map(a => `"${a}"`).join(' ')}`;
      let token = '';
      let lastErr: any = null;

      const commands = [
        cmd,
        `powershell.exe -NoProfile -NonInteractive -Command "${provider.authCommand} ${args.join(' ')}"`,
      ];

      for (const fullCmd of commands) {
        try {
          token = execSync(fullCmd, {
            encoding: 'utf8',
            timeout: 15000,
            cwd: os.homedir(),
            env: baseEnv,
            windowsHide: true,
          }).trim();
          if (token && token.length > 10) {
            lastErr = null;
            break;
          }
        } catch (e: any) {
          lastErr = e;
          console.warn(`[CodexSession] Auth cmd failed:`, e?.message || e);
        }
      }

      if (token && token.length > 10) {
        cachedAuthToken = token;
        cachedTokenExpiry = now + 8 * 60 * 60 * 1000;
        console.log('[CodexSession] Got token from auth command, length:', token.length);
        return token;
      }

      if (lastErr) {
        console.warn('[CodexSession] Auth command failed, falling back to SDK:', lastErr?.message || lastErr);
      }
    } catch (e: any) {
      console.warn('[CodexSession] Auth command error, trying SDK:', e?.message || e);
    }
  }

  const sdkToken = await getAuthTokenFromSDK(provider);
  if (sdkToken && sdkToken.length > 10) {
    cachedAuthToken = sdkToken;
    cachedTokenExpiry = now + 8 * 60 * 60 * 1000;
    console.log('[CodexSession] Got token from SDK, length:', sdkToken.length);
    return sdkToken;
  }

  throw new Error(`Failed to get auth token for provider ${provider.name}`);
}

function getActiveProvider(): { model: string; provider: CodexProviderConfig; reasoningEffort?: string } {
  const config = loadCodexConfig();
  const provider = config.providers[config.modelProvider];
  if (!provider) {
    throw new Error(`Unknown codex provider: ${config.modelProvider}`);
  }
  return {
    model: config.model,
    provider,
    reasoningEffort: config.reasoningEffort,
  };
}

function buildCodexMessages(state: SessionState, userText: string): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: state.systemPrompt },
    ...state.messages,
    { role: 'user', content: userText },
  ];
  return messages;
}

function getCodexEntry(): { cmd: string; args: string[] } {
  const npmPath = path.join(os.homedir(), 'AppData', 'Roaming', 'npm');
  const codexJs = path.join(npmPath, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');

  if (fs.existsSync(codexJs)) {
    const nodeCandidates = [
      path.join(npmPath, 'node.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
    ];
    let nodeCmd = 'node';
    for (const candidate of nodeCandidates) {
      if (fs.existsSync(candidate)) {
        nodeCmd = candidate;
        break;
      }
    }
    return { cmd: nodeCmd, args: [codexJs] };
  }

  const codexCmd = path.join(npmPath, 'codex.cmd');
  if (fs.existsSync(codexCmd)) {
    return { cmd: codexCmd, args: [] };
  }

  return { cmd: 'codex', args: [] };
}

async function streamCodexCompletion(
  sessionId: string,
  input: LLMInput,
  broadcast: (channel: string, ...args: any[]) => void,
) {
  const state = sessions.get(sessionId);
  if (!state) return;

  const abort = new AbortController();
  state.abort = abort;

  const userText = input.text || '';
  state.messages.push({ role: 'user', content: userText });

  let fullResponse = '';
  const tempImageFiles: string[] = [];

  try {
    const args: string[] = [];
    const { model, provider, reasoningEffort } = getActiveProvider();
    const authToken = await getAuthToken(provider);

    if (state.codexThreadId) {
      args.push(
        'exec', 'resume',
        '--json',
        '--skip-git-repo-check',
        '--dangerously-bypass-approvals-and-sandbox',
        '-c', 'sandbox="danger-full-access"'
      );
    } else {
      args.push(
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--dangerously-bypass-approvals-and-sandbox',
        '-s', 'danger-full-access'
      );
    }

    args.push('-m', model);
    if (reasoningEffort) {
      args.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
    }

    const codexProviderName = 'lvyy_gw';
    args.push('-c', `model_provider="${codexProviderName}"`);
    args.push('-c', `model_providers.${codexProviderName}.name="${codexProviderName}"`);
    args.push('-c', `model_providers.${codexProviderName}.base_url="${provider.baseUrl}"`);
    args.push('-c', `model_providers.${codexProviderName}.wire_api="${provider.wireApi}"`);
    args.push('-c', `model_providers.${codexProviderName}.api_key_env="CODEX_API_KEY"`);

    if (input.images && input.images.length > 0) {
      const tmpDir = path.join(os.tmpdir(), 'lvyy-codex-images');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      for (let i = 0; i < input.images.length; i++) {
        const img = input.images[i];
        const ext = img.mimeType?.split('/')[1] || 'png';
        const tmpFile = path.join(tmpDir, `img-${Date.now()}-${i}.${ext}`);
        const buffer = Buffer.from(img.data, 'base64');
        fs.writeFileSync(tmpFile, buffer);
        tempImageFiles.push(tmpFile);
        args.push('-i', tmpFile);
      }
    }

    if (state.codexThreadId) {
      args.push(state.codexThreadId);
    }

    args.push(userText);

    const extraPaths = [
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs'),
    ];
    const existingPath = process.env.PATH || '';
    const envPath = [...extraPaths, existingPath].filter(Boolean).join(path.delimiter);

    const patchPath = getPatchScriptPath();
    const nodeOptions = patchPath
      ? `${process.env.NODE_OPTIONS || ''} --require "${patchPath.replace(/\\/g, '/')}"`.trim()
      : process.env.NODE_OPTIONS || '';

    const homeDir = os.homedir();
    const env = {
      ...process.env,
      PATH: envPath,
      PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.CPL',
      HOME: homeDir,
      USERPROFILE: homeDir,
      APPDATA: process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'),
      LOCALAPPDATA: process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'),
      TEMP: process.env.TEMP || path.join(homeDir, 'AppData', 'Local', 'Temp'),
      TMP: process.env.TMP || path.join(homeDir, 'AppData', 'Local', 'Temp'),
      NODE_OPTIONS: nodeOptions,
      RUST_LOG: 'warn',
      CODEX_SKIP_PATH_ALIASES: 'true',
      CODEX_API_KEY: authToken,
    };

    const codexEntry = getCodexEntry();
    const spawnArgs = [...codexEntry.args, ...args];

    console.log('[CodexSession] cmd:', codexEntry.cmd);
    console.log('[CodexSession] args:', spawnArgs.join(' '));
    console.log('[CodexSession] authToken length:', authToken?.length || 0);
    console.log('[CodexSession] userText:', userText);

    const child = spawn(codexEntry.cmd, spawnArgs, {
      cwd: homeDir,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';

    const IPC_FLUSH_INTERVAL_MS = 30;
    let pendingDelta = '';
    let lastFlush = 0;
    let firstIpcSent = false;

    const flushDelta = () => {
      if (pendingDelta) {
        broadcast('llm-data', sessionId, pendingDelta);
        pendingDelta = '';
      }
      firstIpcSent = true;
      lastFlush = Date.now();
    };

    const maybeFlush = () => {
      const now = Date.now();
      if (!firstIpcSent || now - lastFlush >= IPC_FLUSH_INTERVAL_MS) {
        flushDelta();
      }
    };

    const handleJsonlLine = (line: string) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        const type = event.type;

        if (type === 'thread.started') {
          if (event.thread_id) {
            state.codexThreadId = event.thread_id;
          }
        } else if (type === 'item.started') {
          const item = event.item;
          if (!item) return;
          if (item.type === 'command_execution') {
            const command = item.command || '';
            broadcast('llm-tool-call', sessionId, {
              tool: 'command_execution',
              command,
              output: '',
              exitCode: -1,
              isRunning: true,
            });
          }
        } else if (type === 'item.completed') {
          const item = event.item;
          if (!item) return;

          if (item.type === 'agent_message') {
            const text = item.text || item.content?.text || '';
            if (text) {
              fullResponse = fullResponse ? `${fullResponse}\n\n${text}` : text;
              pendingDelta += (pendingDelta ? '\n\n' : '') + text;
              flushDelta();
            }
          } else if (item.type === 'command_execution') {
            const command = item.command || '';
            const output = item.aggregated_output || '';
            const exitCode = item.exit_code ?? 0;
            broadcast('llm-tool-call', sessionId, {
              tool: 'command_execution',
              command,
              output,
              exitCode,
              isRunning: false,
            });
          } else if (item.type === 'reasoning') {
            const text = item.text || item.content?.text || '';
            if (text) {
              broadcast('llm-reasoning-item', sessionId, text);
            }
          }
        } else if (type === 'turn.completed') {
          if (event.usage) {
            console.debug('[CodexSession] Usage:', event.usage);
          }
        }
      } catch {
        // Ignore parse errors
      }
    };

    await new Promise<void>((resolve, reject) => {
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          handleJsonlLine(line.trim());
        }
      });

      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        stderrBuffer += chunk;
        console.warn('[CodexSession] stderr:', chunk);
      });

      child.on('close', (code) => {
        if (stdoutBuffer.trim()) {
          handleJsonlLine(stdoutBuffer.trim());
        }
        flushDelta();
        if (fullResponse) {
          state.messages.push({ role: 'assistant', content: fullResponse });
        }
        if (code !== 0 && code !== null) {
          console.error('[CodexSession] codex exited with code', code);
          console.error('[CodexSession] stderr:', stderrBuffer);
          if (!fullResponse) {
            reject(new Error(`codex exited with code ${code}: ${stderrBuffer || 'unknown error'}`));
            return;
          }
        }
        resolve();
      });

      child.on('error', (err) => {
        console.error('[CodexSession] spawn error:', err);
        reject(err);
      });

      abort.signal.addEventListener('abort', () => {
        try {
          child.kill('SIGTERM');
        } catch {
          try { child.kill(); } catch {}
        }
        resolve();
      });
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      // Cancelled by user
    } else {
      console.error(`[CodexSession ${sessionId}] error:`, e);
      broadcast('llm-error', sessionId, e?.message || String(e));
    }
  } finally {
    state.abort = null;
    for (const tmpFile of tempImageFiles) {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
    broadcast('llm-turn-complete', sessionId);
  }
}

// ============ Claude CLI Session ============

interface ClaudeContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: any;
  content?: any;
  [key: string]: any;
}

function getClaudeEntry(): { cmd: string; args: string[]; shell?: boolean } {
  const npmPath = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'npm')
    : path.join(os.homedir(), 'AppData', 'Roaming', 'npm');
  // 直接调用 exe，避免 .cmd 在 spawn 下的问题
  const claudeExe = path.join(npmPath, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  if (fs.existsSync(claudeExe)) {
    return { cmd: claudeExe, args: [], shell: false };
  }
  const claudeCmd = path.join(npmPath, 'claude.cmd');
  if (fs.existsSync(claudeCmd)) {
    return { cmd: claudeCmd, args: [], shell: true };
  }
  return { cmd: 'claude', args: [], shell: true };
}

async function streamClaudeCompletion(
  sessionId: string,
  input: LLMInput,
  broadcast: (channel: string, ...args: any[]) => void,
) {
  const state = sessions.get(sessionId);
  if (!state) return;

  const abort = new AbortController();
  state.abort = abort;

  const userText = input.text || '';
  state.messages.push({ role: 'user', content: userText });

  let fullResponse = '';
  const tempImageFiles: string[] = [];
  const seenBlockKeys = new Set<string>();

  try {
    const args: string[] = [
      '-p',
      '--output-format=stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ];

    if (state.systemPrompt) {
      // 用文件传递系统提示词，避免命令行长度限制
      const tmpDir = path.join(os.tmpdir(), 'lvyy-claude-prompts');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      const promptFile = path.join(tmpDir, `sys_${sessionId}_${Date.now()}.md`);
      fs.writeFileSync(promptFile, state.systemPrompt, 'utf-8');
      tempImageFiles.push(promptFile); // 复用清理列表
      args.push('--system-prompt-file', promptFile);
    }

    if (state.claudeSessionId) {
      args.push('--resume', state.claudeSessionId);
    }

    if (input.images && input.images.length > 0) {
      const tmpDir = path.join(os.tmpdir(), 'lvyy-claude-images');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      for (const img of input.images) {
        const ext = img.mimeType.split('/')[1] || 'png';
        const tmpFile = path.join(tmpDir, `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`);
        fs.writeFileSync(tmpFile, Buffer.from(img.data, 'base64'));
        tempImageFiles.push(tmpFile);
        args.push('--file', `${tmpFile}:${path.basename(tmpFile)}`);
      }
    }

    args.push(userText);

    const claudeEntry = getClaudeEntry();
    const spawnArgs = [...claudeEntry.args, ...args];

    console.log(`[ClaudeSession ${sessionId}] spawning: ${claudeEntry.cmd} ${spawnArgs.slice(0, 5).join(' ')} ...`);

    const child = spawn(claudeEntry.cmd, spawnArgs, {
      signal: abort.signal,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: claudeEntry.shell,
      windowsHide: true,
    });

    let stderrBuffer = '';
    let stdoutBuffer = '';

    const parseLine = (line: string) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);

        if (event.type === 'system' && event.subtype === 'init') {
          if (event.session_id) {
            state.claudeSessionId = event.session_id;
          }
          return;
        }

        if (event.type === 'system' && event.subtype === 'thinking_tokens') {
          return;
        }

        if (event.type === 'assistant') {
          const msg = event.message;
          if (!msg?.content) return;

          for (const block of msg.content) {
            const blockKey = event.uuid + '_' + block.type + '_' + (block.id || '');
            if (seenBlockKeys.has(blockKey)) continue;
            seenBlockKeys.add(blockKey);

            if (block.type === 'text' && block.text) {
              const text = block.text;
              fullResponse += text;
              broadcast('llm-data', sessionId, text);
            } else if (block.type === 'thinking' && block.thinking) {
              broadcast('llm-reasoning-item', sessionId, block.thinking);
            } else if (block.type === 'tool_use') {
              const toolName = block.name || 'unknown';
              const toolInput = block.input || {};
              const command = typeof toolInput === 'string' ? toolInput : (toolInput.command || JSON.stringify(toolInput));
              broadcast('llm-tool-call', sessionId, {
                tool: toolName,
                command,
                output: '',
                exitCode: 0,
                isRunning: true,
              });
            } else if (block.type === 'tool_result') {
              const toolOutput = typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content);
              const toolUseId = block.tool_use_id || '';
              const isError = block.is_error === true;
              broadcast('llm-tool-call', sessionId, {
                tool: toolUseId,
                command: '',
                output: toolOutput,
                exitCode: isError ? 1 : 0,
                isRunning: false,
              });
            }
          }
          return;
        }

        if (event.type === 'result') {
          if (event.session_id) {
            state.claudeSessionId = event.session_id;
          }
          if (event.is_error && event.errors && event.errors.length > 0) {
            throw new Error(event.errors.join('; '));
          }
          return;
        }
      } catch (e) {
        // 非 JSON 行忽略
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf-8');
      let idx;
      while ((idx = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, idx).trim();
        stdoutBuffer = stdoutBuffer.slice(idx + 1);
        parseLine(line);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stderrBuffer += text;
      let idx;
      while ((idx = stderrBuffer.indexOf('\n')) !== -1) {
        const line = stderrBuffer.slice(0, idx).trim();
        stderrBuffer = stderrBuffer.slice(idx + 1);
        parseLine(line);
      }
    });

    await new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        if (stdoutBuffer.trim()) parseLine(stdoutBuffer.trim());
        if (stderrBuffer.trim()) parseLine(stderrBuffer.trim());

        console.log(`[ClaudeSession ${sessionId}] exited with code ${code}, fullResponse.length=${fullResponse.length}`);
        if (code !== 0 && !fullResponse) {
          console.error(`[ClaudeSession ${sessionId}] stderr: ${stderrBuffer.slice(0, 500)}`);
        }

        if (code === 0 || code === null) {
          resolve();
        } else if (fullResponse) {
          resolve();
        } else {
          reject(new Error(`claude exited with code ${code}: ${stderrBuffer.slice(0, 300) || 'unknown error'}`));
        }
      });

      child.on('error', (err) => {
        reject(err);
      });

      abort.signal.addEventListener('abort', () => {
        try {
          child.kill('SIGTERM');
        } catch {
          try { child.kill(); } catch {}
        }
        resolve();
      });
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      // Cancelled by user
    } else {
      console.error(`[ClaudeSession ${sessionId}] error:`, e);
      broadcast('llm-error', sessionId, e?.message || String(e));
    }
  } finally {
    state.abort = null;
    for (const tmpFile of tempImageFiles) {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
    broadcast('llm-turn-complete', sessionId);
  }
}
