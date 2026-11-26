// VolleyPrompt — multi-provider support.
//
// Each provider implements a consistent interface so the rest of the app (run:start,
// the settings UI) never needs to know which provider is in use:
//   getStatus()            -> { connected, authMethod?, user?, cli?, installed? }
//   getModels()            -> Promise<[{ id, name, isFree, supportsVision, billing }]>
//   getCapabilities(model) -> { supportsVision, streaming }
//   chat({ model, system, messages, signal, onDelta, onUsage, onCtl })
//                          -> Promise<{ text, usage? }>
//   meta()                 -> { id, name, authType, requiresExternalCli, cliBinaries,
//                               installHint, billingNote, paid }
//
// Three auth models are supported, matching what each vendor legitimately permits a
// third-party desktop app to use:
//
//   kind 'api'   — provider API key (paid: OpenAI/OpenRouter). Stored encrypted locally.
//   kind 'cli'   — the vendor's OFFICIAL desktop CLI (Claude Code CLI, Google Antigravity/
//                  Gemini CLI). VolleyPrompt shells out to the unmodified binary; the user
//                  authenticates via the vendor's own login flow (a browser). Credentials
//                  never touch VolleyPrompt. This is the legitimate way to use an existing
//                  Claude Pro/Max/Ultra subscription or a free Google account — no API key,
//                  no extra charge. (Anthropic explicitly permits an end user to sign into
//                  the unmodified Claude Code binary with their own subscription; Google's
//                  consumer free tier now runs through the `agy`/`gemini` CLI.)
//   kind 'local' — Ollama, no auth.
//
// OpenRouter reuses the application's existing stream()/loadKey()/modelsRawCache so its
// battle-tested behaviour is preserved exactly.

const { spawn, spawnSync } = require('child_process');
const { killTree, treeOptions } = require('./kill-tree.js');

let deps = {};
function init(d) { deps = d; }

// ---- shared SSE/stream parser (OpenAI-compatible, Anthropic, Gemini all stream JSON lines) ----
let RETRY_BASE_MS = 1500;
// A retry pause that Stop cuts short.
const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal && signal.aborted) return resolve();
  const done = () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms);
  if (signal) signal.addEventListener('abort', done, { once: true });
});

async function streamSSE({ url, method = 'POST', headers, body, signal, onDelta, onUsage, onCtl, idleMs, label = 'the provider' }) {
  const ctl = new AbortController();
  let idle = null;
  let stalled = false;
  const arm = () => { clearTimeout(idle); idle = setTimeout(() => { stalled = true; ctl.abort(); }, idleMs || 30000); };
  const onStop = () => ctl.abort();
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', onStop, { once: true }); }
  if (onCtl) onCtl(() => ctl.abort());
  const startedAt = Date.now();
  let promptTokens = 0;
  let completionTokens = 0;
  let text = '';
  try {
    // Same resilience OpenRouter calls have: two retries with backoff on rate limits,
    // server errors and dropped connections, never on a user Stop.
    let res;
    for (let attempt = 0; ; attempt++) {
      arm();
      try {
        res = await fetch(url, { method, headers, body: JSON.stringify(body), signal: ctl.signal });
      } catch (e) {
        if (stalled || ctl.signal.aborted) throw e;
        if (attempt < 2) { await sleep(RETRY_BASE_MS * (attempt + 1), ctl.signal); continue; }
        throw new Error(`Can't reach ${label}. ${label === 'Ollama' ? 'Is Ollama running?' : 'Check your internet.'}`);
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await res.text().catch(() => '');
        await sleep(RETRY_BASE_MS * (attempt + 1), ctl.signal);
        if (ctl.signal.aborted) throw new Error('Stopped.');
        continue;
      }
      break;
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      const hint = res.status === 401 ? ' The API key was rejected - re-enter it in Settings.'
        : res.status === 429 ? ' Rate limited or out of quota - wait a minute, or switch model/provider.'
        : res.status === 404 ? ' That model was not found for this provider.' : '';
      throw new Error(`Provider returned HTTP ${res.status}.${hint} ${t.slice(0, 200)}`);
    }
    const dec = new TextDecoder();
    let buf = '';
    arm();
    for await (const chunk of res.body) {
      arm();
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let j;
        try { j = JSON.parse(data); } catch { continue; }
        const out = deps.parse ? deps.parse(j) : parseOpenAI(j);
        if (typeof out === 'string') { text += out; onDelta(out); }
        else if (out && out.usage) {
          promptTokens += out.usage.prompt_tokens || 0;
          completionTokens += out.usage.completion_tokens || 0;
        }
      }
    }
    if (!text.trim()) throw new Error('The model returned nothing. Try a different model.');
    if (onUsage) onUsage({ prompt_tokens: promptTokens, completion_tokens: completionTokens, elapsedMs: Date.now() - startedAt });
    return { text };
  } catch (e) {
    if (stalled) throw new Error(`The model stopped responding (nothing for ${((idleMs || 30000) / 1000)}s). Try again or pick a different model.`);
    throw e;
  } finally {
    clearTimeout(idle);
    if (signal) signal.removeEventListener('abort', onStop);
  }
}

function parseOpenAI(j) {
  if (j.usage) return { usage: { prompt_tokens: j.usage.prompt_tokens || 0, completion_tokens: j.usage.completion_tokens || 0 } };
  const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
  return d || null;
}

function toAnthropicMessage(m) {
  const role = m.role === 'assistant' ? 'assistant' : 'user';
  const content = typeof m.content === 'string'
    ? m.content
    : m.content.map((c) => {
        if (c.type === 'image_url') {
          const comma = c.image_url.url.indexOf(',');
          const b64 = comma >= 0 ? c.image_url.url.slice(comma + 1) : '';
          return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } };
        }
        return { type: 'text', text: c.text };
      }).filter(Boolean);
  return { role, content };
}

function toGeminiContent(m) {
  const role = m.role === 'assistant' ? 'model' : 'user';
  const parts = typeof m.content === 'string'
    ? [{ text: m.content }]
    : m.content.map((c) => {
        if (c.type === 'image_url') {
          const comma = c.image_url.url.indexOf(',');
          const b64 = comma >= 0 ? c.image_url.url.slice(comma + 1) : '';
          return { inline_data: { mime_type: 'image/png', data: b64 } };
        }
        return { text: c.text };
      }).filter(Boolean);
  return { role, parts };
}

function contentOf(m) {
  if (typeof m.content === 'string') return m.content;
  return (m.content || []).map((c) => (c && c.text) || '').join('');
}

// The picture parts of a conversation, in order.
function imageUrlsOf(messages) {
  return (messages || []).flatMap((m) => (Array.isArray(m.content)
    ? m.content.filter((c) => c && c.type === 'image_url').map((c) => (c.image_url && c.image_url.url) || '')
    : []));
}

// One user turn for `--input-format stream-json`: the pictures, then the text.
function streamJsonInput(prompt, imageUrls) {
  const images = imageUrls.map((url) => {
    const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
    if (!m) throw new Error('One of the attached pictures is in a format Claude cannot read. Use PNG, JPEG, GIF or WebP.');
    return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
  });
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [...images, { type: 'text', text: prompt }] } }) + '\n';
}

class BaseProvider {
  constructor(id, name, meta = {}) {
    this.id = id;
    this.name = name;
    this.authType = meta.authType || 'api_key';
    this.requiresExternalCli = !!meta.requiresExternalCli;
    this.cliBinaries = meta.cliBinaries || null;
    this.installHint = meta.installHint || '';
    this.billingNote = meta.billingNote || '';
    this.paid = !!meta.paid;
  }
  async getStatus() { return { connected: false }; }
  async getModels() { return []; }
  getCapabilities() { return { supportsVision: false, streaming: true }; }
  async chat() { throw new Error('Not implemented'); }
  meta() {
    return {
      id: this.id, name: this.name, authType: this.authType,
      requiresExternalCli: this.requiresExternalCli, cliBinaries: this.cliBinaries,
      installHint: this.installHint, billingNote: this.billingNote, paid: this.paid,
    };
  }
}

// OpenRouter — reuses the app's existing stream() so behaviour is identical to before.
class OpenRouterProvider extends BaseProvider {
  constructor() {
    super('openrouter', 'OpenRouter', {
      authType: 'api_key', paid: true,
      billingNote: 'Paid API (OpenRouter). Billed per token through your OpenRouter key.',
    });
  }
  async getStatus() { return { connected: !!deps.loadKey(), authMethod: 'API Key' }; }
  async getModels() {
    const data = await deps.getModelsRaw();
    return data.map((m) => ({
      id: m.id,
      name: m.id,
      isFree: /:free$/i.test(m.id) || ((parseFloat(m.pricing?.prompt || '0') + parseFloat(m.pricing?.completion || '0')) * 1e6) === 0,
      supportsVision: !!m.architecture?.input_modalities?.includes('image'),
      billing: 'api',
    }));
  }
  getCapabilities(model) {
    const m = deps.getModelsCache().data.find((x) => x.id === model);
    return { supportsVision: m ? !!m.architecture?.input_modalities?.includes('image') : null, streaming: true };
  }
  async chat(opts) {
    // stream() resolves to the plain text; the provider interface promises { text }.
    const out = await deps.stream(deps.loadKey(), opts.model, opts.system, opts.messages, opts.signal, opts.onDelta, opts.onUsage, opts.onCtl);
    return typeof out === 'string' ? { text: out } : out;
  }
}

// OpenAI — official Chat Completions API, API key (paid). Vision-capable.
class OpenAIProvider extends BaseProvider {
  constructor() {
    super('openai', 'OpenAI', {
      authType: 'api_key', paid: true,
      billingNote: 'Paid API key (OpenAI). You are billed per token by OpenAI — separate from any ChatGPT subscription.',
    });
  }
  async getStatus() {
    const k = deps.loadProvCred('openai');
    return { connected: !!k, authMethod: 'API Key', user: k ? 'sk-…' + k.slice(-4) : '' };
  }
  async getModels() {
    return [
      { id: 'gpt-5', name: 'GPT-5 (API, paid)', isFree: false, supportsVision: true, billing: 'api' },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini (API, paid)', isFree: false, supportsVision: true, billing: 'api' },
      { id: 'gpt-4.1', name: 'GPT-4.1 (API, paid)', isFree: false, supportsVision: true, billing: 'api' },
      { id: 'gpt-4o', name: 'GPT-4o (API, paid)', isFree: false, supportsVision: true, billing: 'api' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (API, paid)', isFree: false, supportsVision: true, billing: 'api' },
    ];
  }
  getCapabilities() { return { supportsVision: true, streaming: true }; }
  async chat({ model, system, messages, signal, onDelta, onUsage, onCtl }) {
    const apiKey = deps.loadProvCred('openai');
    if (!apiKey) throw new Error('No OpenAI API key. Open Settings and add one (this is a paid API key, separate from ChatGPT).');
    const full = system ? [{ role: 'system', content: system }, ...messages] : messages;
    return streamSSE({
      url: 'https://api.openai.com/v1/chat/completions',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: { model, stream: true, stream_options: { include_usage: true }, messages: full },
      signal, onDelta, onUsage, onCtl, idleMs: deps.IDLE_MS, label: 'OpenAI',
    });
  }
}

// OpenCode Go — the OpenCode Go subscription (opencode.ai). OpenAI-compatible chat completions with a Go API key.
// This is the Go relay (/zen/go/v1), NOT OpenCode Zen (/zen/v1): the two have different catalogs and keys.
// The relay wants an `x-opencode-session` header that stays the same for one conversation, so requests that belong
// together are routed to the same backend.
const OPENCODE_GO_BASE = 'https://opencode.ai/zen/go/v1';
const OPENCODE_GO_FALLBACK_MODELS = [
  'hy4-flash-free', 'beam-free', 'iceman-contributor-free', 'hungerg-free',
  'mimo-v2.6-flash', 'claude-haiku-5-5', 'gpt-6-luna', 'glm-5.3-flash', 'qwen3.8-flash',
];

class OpenCodeGoProvider extends BaseProvider {
  constructor() {
    super('opencode-go', 'OpenCode Go', {
      authType: 'api_key', paid: false,
      billingNote: 'Your OpenCode Go subscription (API key from opencode.ai). Models ending in -free cost nothing extra.',
    });
    this.sessionId = null;
  }
  async getStatus() {
    const k = deps.loadProvCred('opencode-go');
    return { connected: !!k, authMethod: 'API Key', user: k ? '…' + k.slice(-4) : '' };
  }
  async getModels() {
    const apiKey = deps.loadProvCred('opencode-go');
    let ids = [];
    if (apiKey) {
      try {
        const r = await fetch(`${OPENCODE_GO_BASE}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
        if (r.ok) ids = ((await r.json()).data || []).map((m) => m && m.id).filter(Boolean);
        else if (r.status === 401 || r.status === 403) throw new Error('OpenCode Go rejected the API key. Re-enter it in Settings.');
      } catch (e) {
        if (/rejected the API key/.test(e.message)) throw e;
      }
    }
    if (!ids.length) ids = OPENCODE_GO_FALLBACK_MODELS;
    return ids.map((id) => {
      const free = /-free$/i.test(id);
      return { id, name: free ? `${id} (free)` : id, isFree: free, supportsVision: false, billing: 'subscription' };
    });
  }
  getCapabilities() { return { supportsVision: false, streaming: true }; }
  async chat({ model, system, messages, signal, onDelta, onUsage, onCtl }) {
    const apiKey = deps.loadProvCred('opencode-go');
    if (!apiKey) throw new Error('No OpenCode Go API key. Open Settings and add one (from your OpenCode Go account).');
    if (!this.sessionId) this.sessionId = `volleyprompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    // The Go catalog is text-only here, so flatten any image parts rather than sending an unsupported content type.
    const flat = messages.map((m) => (typeof m.content === 'string' ? m : { ...m, content: contentOf(m) }));
    const full = system ? [{ role: 'system', content: system }, ...flat] : flat;
    return streamSSE({
      url: `${OPENCODE_GO_BASE}/chat/completions`,
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'x-opencode-session': this.sessionId },
      body: { model, stream: true, stream_options: { include_usage: true }, messages: full },
      signal, onDelta, onUsage, onCtl, idleMs: deps.IDLE_MS, label: 'OpenCode Go',
    });
  }
}

// Ollama — local HTTP, no auth. OpenAI-compatible chat completions endpoint.
class OllamaProvider extends BaseProvider {
  constructor() {
    super('ollama', 'Ollama (Local)', {
      authType: 'local',
      billingNote: 'Free — runs entirely on your machine. No account, no network, no billing.',
    });
  }
  async getStatus() {
    try {
      const r = await fetch('http://localhost:11434/api/tags');
      if (!r.ok) return { connected: false };
      return { connected: true, authMethod: 'Local (no auth)' };
    } catch { return { connected: false }; }
  }
  async getModels() {
    try {
      const r = await fetch('http://localhost:11434/api/tags');
      if (!r.ok) return [];
      const j = await r.json();
      return (j.models || []).map((m) => ({ id: m.name, name: m.name, isFree: true, supportsVision: true, billing: 'local' }));
    } catch { return []; }
  }
  getCapabilities() { return { supportsVision: true, streaming: true }; }
  async chat({ model, system, messages, signal, onDelta, onUsage, onCtl }) {
    const full = system ? [{ role: 'system', content: system }, ...messages] : messages;
    return streamSSE({
      url: 'http://localhost:11434/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      body: { model, stream: true, stream_options: { include_usage: true }, messages: full },
      signal, onDelta, onUsage, onCtl, idleMs: deps.IDLE_MS, label: 'Ollama',
    });
  }
}

// ---- CLI providers: shell out to the vendor's OFFICIAL desktop CLI ----
// The user installs the CLI and logs in via the vendor's own browser flow. VolleyPrompt
// never sees the credentials. We spawn the binary, pipe the prompt to stdin, and parse
// its newline-delimited JSON (`--output-format stream-json`) output into text deltas.
class CliProvider extends BaseProvider {
  // options: { binaries:[...], installHint, billingNote, models, systemFlag:[...]|null }
  constructor(id, name, opts) {
    super(id, name, {
      authType: 'cli', requiresExternalCli: true,
      cliBinaries: opts.binaries, installHint: opts.installHint,
      billingNote: opts.billingNote, paid: false,
    });
    this.binaries = opts.binaries;
    this.modelsList = opts.models;
    this.printFlags = opts.printFlags || [];
    this.systemFlag = opts.systemFlag || null; // e.g. ['--append-system-prompt']; null => prepend to prompt text
    // 'stream-json' when the CLI can take pictures that way; null => this app can't send it any.
    this.imageInput = opts.imageInput || null;
  }

  // Find the first binary on PATH that responds to `--version`. On Windows npm-global
  // CLIs install as `<name>.cmd`, so we also try that.
  // Node >= 20.12 refuses to spawn .cmd/.bat files without a shell (EINVAL), and npm-global
  // CLIs on Windows are exactly that - so those need shell:true or they look "not installed".
  static needsShell(bin) { return /\.(cmd|bat)$/i.test(bin || ''); }

  resolveBinary() {
    // spawnSync blocks the main process; cache the answer so status polling stays cheap.
    if (this._binCache && Date.now() - this._binCache.at < 60000) return this._binCache.bin;
    let found = null;
    outer: for (const b of this.binaries) {
      for (const cand of [b, `${b}.exe`, `${b}.cmd`]) {
        try {
          const r = spawnSync(cand, ['--version'], { timeout: 5000, windowsHide: true, shell: CliProvider.needsShell(cand) });
          if (!r.error && r.status === 0) { found = cand; break outer; }
        } catch { /* keep trying */ }
      }
    }
    this._binCache = { at: Date.now(), bin: found };
    return found;
  }

  async getStatus() {
    const bin = this.resolveBinary();
    if (!bin) return { connected: false, cli: true, installed: false, authMethod: 'CLI (your account)' };
    return { connected: true, cli: true, installed: true, authMethod: 'CLI (your account)', binary: bin };
  }

  async getModels() { return this.modelsList; }
  getCapabilities() { return { supportsVision: this.imageInput === 'stream-json', streaming: true }; }

  // Join system + conversation into a single prompt. When the CLI takes the system prompt
  // as a flag (Claude), we exclude it here so it isn't doubled.
  buildPrompt(system, messages, excludeSystem) {
    const parts = [];
    if (system && !excludeSystem) parts.push(system);
    for (const m of messages) parts.push(contentOf(m));
    return parts.join('\n\n');
  }

  // Parse one NDJSON line from a CLI stream into either a text delta (string) or a signal
  // object ({ result } or { usage }). Handles both Claude Code and Antigravity/Gemini shapes.
  parseCliLine(j) {
    if (!j || typeof j !== 'object') return null;
    if (j.type === 'result' && j.result !== undefined) return { result: j.result };
    if (j.usageMetadata || j.usage) {
      const u = j.usageMetadata || j.usage;
      return { usage: { prompt_tokens: u.promptTokenCount || u.input_tokens || 0, completion_tokens: u.candidatesTokenCount || u.output_tokens || 0 } };
    }
    let d = null;
    if (j.type === 'stream_event' && j.data) d = j.data;
    else if (j.type === 'content_block_delta') d = j;
    if (d) {
      if (d.type === 'content_block_delta' && d.delta && d.delta.type === 'text_delta') return d.delta.text;
      if (d.type === 'text' && typeof d.text === 'string') return d.text;
    }
    if (j.type === 'assistant' && j.message && j.message.content) {
      const c = j.message.content;
      if (typeof c === 'string') return c;
      if (Array.isArray(c)) return c.map((x) => (x && x.text) || '').join('');
    }
    if (typeof j.text === 'string') return j.text;
    return null;
  }

  async chat({ model, system, messages, signal, onDelta, onUsage, onCtl }) {
    const bin = this.resolveBinary();
    if (!bin) {
      throw new Error(`${this.name} CLI not found. ${this.installHint || 'Install it and log in first.'}`);
    }
    // Through a Windows shell, a multi-line system prompt can't be passed safely as an argument,
    // so it is prepended to the prompt text instead.
    const viaShell = CliProvider.needsShell(bin);
    const excludeSystem = !!(this.systemFlag && system) && !viaShell;
    const prompt = this.buildPrompt(system, messages, excludeSystem);
    // Text-only calls go in as plain text. Pictures need the structured input; if this CLI
    // can't take them, say so - never drop them without a word.
    const imageUrls = imageUrlsOf(messages);
    if (imageUrls.length && this.imageInput !== 'stream-json') {
      throw new Error(`VolleyPrompt can't send pictures to ${this.name}. Remove the image attachments, or pick a model that can see them.`);
    }
    const inputFormat = imageUrls.length ? 'stream-json' : 'text';
    const stdinText = imageUrls.length ? streamJsonInput(prompt, imageUrls) : prompt;
    // -p/--print is what makes the CLI non-interactive; without it, --input/--output-format are
    // ignored or rejected and the CLI waits on a terminal UI. stream-json also needs --verbose.
    const args = (this.printFlags || []).concat(['--input-format', inputFormat, '--output-format', 'stream-json']);
    if (model && /^[\w.:\/-]+$/.test(String(model))) args.push('--model', String(model));
    if (excludeSystem) args.push(...this.systemFlag, system);
    // Test hook: prepend a script so we can exercise spawn+parse without the real CLI.
    const finalArgs = this.script ? [this.script, ...args] : args;

    const stopped = () => Object.assign(new Error(`${this.name} was stopped.`), { cancelled: true });
    // Already stopped: don't launch anything.
    if (signal && signal.aborted) throw stopped();

    return new Promise((resolve, reject) => {
      const child = spawn(bin, finalArgs, treeOptions({ windowsHide: true, shell: viaShell }));
      let buf = '';
      let stderr = '';
      let text = '';
      let idle = null;
      let settled = false;
      const finish = (fn, val) => {
        if (settled) return;
        settled = true;
        clearTimeout(idle);
        if (signal) signal.removeEventListener('abort', cancel);
        fn(val);
      };
      // End the program and everything it started, then report straight away.
      const end = (error) => { if (!settled) { killTree(child); finish(reject, error); } };
      const cancel = () => end(stopped());
      if (signal) signal.addEventListener('abort', cancel, { once: true });
      if (onCtl) onCtl(cancel);
      const idleMs = deps.IDLE_MS || 30000;
      const arm = () => {
        clearTimeout(idle);
        if (!settled) idle = setTimeout(() => end(new Error(`${this.name} stopped responding (no output for ${idleMs / 1000}s).`)), idleMs);
      };

      child.on('error', (e) => finish(reject, new Error(`${this.name} CLI failed to start: ${e.message}`)));
      child.stdin.on('error', () => {});
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      const handleLine = (line) => {
        let j;
        try { j = JSON.parse(line); } catch { return; }
        const out = this.parseCliLine(j);
        if (typeof out === 'string') { text += out; if (onDelta) onDelta(out); }
        else if (out && out.result !== undefined) { text = out.result; }
        else if (out && out.usage && onUsage) { onUsage(out.usage); }
      };

      child.stdout.on('data', (d) => {
        if (settled) return; // nothing from a stopped call may reach the screen
        arm();
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) handleLine(line);
        }
      });

      child.on('close', (code) => {
        if (settled) return;
        // Flush any trailing buffered line.
        const tail = buf.trim();
        if (tail) handleLine(tail);
        if (code !== 0) {
          const s = stderr.trim();
          if (/not\s*logged|login|unauthor|auth|401|403/i.test(s)) {
            return finish(reject, new Error(`${this.name} CLI (${bin}) is not authenticated. Run "${bin} login" in a terminal first (it opens your browser), then try again.`));
          }
          return finish(reject, new Error(`${this.name} CLI (${bin}) failed: ${s.slice(0, 300) || 'exit code ' + code}`));
        }
        if (!text.trim()) return finish(reject, new Error('The model returned nothing. Try a different model.'));
        return finish(resolve, { text });
      });

      // Write the prompt to stdin and close it so the CLI begins processing.
      try { child.stdin.write(stdinText); child.stdin.end(); } catch (e) { end(e); }
      arm();
    });
  }
}

// Claude — the official Claude Code CLI. Uses YOUR Claude Pro/Max/Ultra subscription.
// No API key, no extra charge. You install `claude` and run `claude login` once.
class ClaudeCliProvider extends CliProvider {
  constructor() {
    super('anthropic', 'Claude (Claude Code CLI)', {
      binaries: ['claude'],
      installHint: 'Install the Claude Code CLI (npm i -g @anthropic-ai/claude-code), then run "claude login" in a terminal (opens your browser). Uses your Claude Pro/Max/Ultra subscription — no API key.',
      billingNote: 'Your Claude Pro/Max/Ultra subscription. No API key, no extra charge.',
      printFlags: ['-p', '--verbose'],
      systemFlag: ['--append-system-prompt'],
      imageInput: 'stream-json',
      models: [
        { id: 'sonnet', name: 'Claude Sonnet (your subscription)', isFree: false, supportsVision: true, billing: 'subscription' },
        { id: 'opus', name: 'Claude Opus (your subscription)', isFree: false, supportsVision: true, billing: 'subscription' },
        { id: 'haiku', name: 'Claude Haiku (your subscription)', isFree: false, supportsVision: true, billing: 'subscription' },
        { id: 'claude-opus-4-5', name: 'Claude Opus 4.5 (your subscription)', isFree: false, supportsVision: true, billing: 'subscription' },
        { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (your subscription)', isFree: false, supportsVision: true, billing: 'subscription' },
        { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (your subscription)', isFree: false, supportsVision: true, billing: 'subscription' },
      ],
    });
  }
}

// Google — the official Antigravity/Gemini CLI (`agy` or `gemini`). Uses your free Google
// account allowance, or a Gemini API key if you set one. No subscription purchase needed.
class GoogleCliProvider extends CliProvider {
  constructor() {
    super('google', 'Google Gemini (CLI)', {
      binaries: ['gemini', 'agy'],
      installHint: 'Install the Google CLI: "npm i -g @google/gemini-cli" (or the Antigravity CLI "agy"). Run it once and sign in with your Google account. Free Google-account allowance, or set a GEMINI_API_KEY for API billing.',
      billingNote: 'Free Google account allowance (or a Gemini API key). No subscription purchase needed.',
      systemFlag: null, // prepend system to the prompt text (CLI has no reliable system flag)
      models: [
        { id: 'gemini-3-pro', name: 'Gemini 3 Pro (free account / API)', isFree: true, supportsVision: false, billing: 'free-account' },
        { id: 'gemini-3-flash', name: 'Gemini 3 Flash (free account / API)', isFree: true, supportsVision: false, billing: 'free-account' },
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (free account / API)', isFree: true, supportsVision: false, billing: 'free-account' },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (free account / API)', isFree: true, supportsVision: false, billing: 'free-account' },
      ],
    });
  }
}

const providers = {
  openrouter: new OpenRouterProvider(),
  anthropic: new ClaudeCliProvider(),
  openai: new OpenAIProvider(),
  'opencode-go': new OpenCodeGoProvider(),
  google: new GoogleCliProvider(),
  ollama: new OllamaProvider(),
};

function getProvider(id) { return providers[id] || providers.openrouter; }
function getAllProviders() { return Object.values(providers); }
async function getProviderStatuses() {
  const results = {};
  for (const [id, p] of Object.entries(providers)) results[id] = await p.getStatus();
  return results;
}

module.exports = {
  init, getProvider, getAllProviders, getProviderStatuses, providers,
  _setRetryBase: (ms) => { RETRY_BASE_MS = ms; },
  // exported for tests
  CliProvider,
  parseCliLine: (j) => new CliProvider('test', 'Test', { binaries: ['node'], models: [] }).parseCliLine(j),
  buildPrompt: (system, messages, excludeSystem) => new CliProvider('test', 'Test', { binaries: ['node'], models: [] }).buildPrompt(system, messages, excludeSystem),
};
