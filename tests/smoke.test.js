// Smoke test for the renderer (runs in Node via jsdom — no Electron GUI required).
// Verifies that app.js parses, attaches handlers, and the provider UI behaves
// correctly when the Electron `pv` bridge is mocked. This is the canonical
// `npm test` for VolleyPrompt; it stands in for `hermes verify`, which cannot
// run against an Electron desktop app (no HTTP server to poll).
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf-8');
const APP = fs.readFileSync(path.join(ROOT, 'renderer', 'app.js'), 'utf-8');

function makeDom() {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
  const { window } = dom;
  window.requestAnimationFrame = () => 0;
  window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {}, beginPath() {}, arc() {}, fill() {},
    set fillStyle(v) {}, get fillStyle() { return ''; },
  });
  window.FileReader = class {
    readAsDataURL() { this.onload && this.onload({ target: { result: 'data:' } }); }
    readAsText() { this.onload && this.onload({ target: { result: 'text' } }); }
  };
  return dom;
}

const PROVIDERS = [
  { id: 'openrouter', name: 'OpenRouter', authType: 'api_key', requiresExternalCli: false },
  { id: 'openai', name: 'OpenAI (Codex CLI)', authType: 'oauth', requiresExternalCli: true },
  { id: 'anthropic', name: 'Anthropic', authType: 'api_key', requiresExternalCli: false },
  { id: 'google', name: 'Google Gemini (CLI)', authType: 'oauth', requiresExternalCli: true },
  { id: 'ollama', name: 'Ollama (Local)', authType: 'local', requiresExternalCli: false },
];
const MODELS = {
  anthropic: [
    { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', isFree: false, supportsVision: true },
    { id: 'claude-haiku-4', name: 'Claude Haiku 4', isFree: true, supportsVision: false },
  ],
};

function run(connectedStatus) {
  return new Promise((resolve) => {
    const dom = makeDom();
    const { window } = dom;
    const { document } = window;
    const errors = [];
    window.addEventListener('error', (e) => errors.push('win: ' + (e.error ? e.error.stack : e.message)));
    const STATUS = {
      openrouter: { connected: false }, openai: { connected: false },
      anthropic: { connected: false }, google: { connected: false }, ollama: { connected: false },
      ...connectedStatus,
    };
    let saveCalls = [];
    window.pv = {
      providersList: async () => PROVIDERS,
      providersStatus: async () => STATUS,
      providerConnect: async () => ({ success: true, message: 'ok' }),
      providerDisconnect: async () => ({ success: true }),
      providerSaveCreds: async (id, c) => { saveCalls.push({ id, c }); return { success: true }; },
      providerLoadCreds: () => null,
      providerModels: async (id) => MODELS[id] || [],
      providerTestKey: async () => ({ ok: true, message: 'valid' }),
      models: async () => ['openai/gpt-4'],
      runs: async () => [],
      copy: async () => {}, openFolder: async () => {}, openUrl: async () => {},
      start: () => {}, sendNotes: () => {}, stop: () => {},
      winMin: () => {}, winMax: () => {}, winClose: () => {},
      hasKey: async () => false, saveKey: async () => {}, testKey: async () => ({ ok: false }),
      onEvent: () => {},
    };
    const s = document.createElement('script');
    s.textContent = APP;
    try { document.body.appendChild(s); } catch (e) { errors.push('inject: ' + e.stack); }

    setTimeout(() => {
      const r = { errors: errors.length };
      r.cards = document.querySelectorAll('.provider-card').length;
      const a = document.getElementById('authorProvider');
      const c = document.getElementById('criticProvider');
      r.authorOpts = a ? a.options.length : 'NO';
      r.criticOpts = c ? c.options.length : 'NO';
      const modal = document.getElementById('modal');
      r.modalHidden = modal.classList.contains('hidden');
      r.connectedCards = document.querySelectorAll('.provider-card.connected').length;
      if (Object.keys(connectedStatus).length === 0) {
        const card = [...document.querySelectorAll('.provider-card')].find((x) => x.textContent.includes('Anthropic'));
        card.querySelector('.btn-connect').click();
        const ki = document.getElementById('key-anthropic');
        ki.value = 'sk-x';
        card.querySelector('.btn-save-creds').click();
        setTimeout(() => { r.saveCalls = saveCalls.length; resolve(r); }, 250);
      } else {
        resolve(r);
      }
    }, 600);
  });
}

(async () => {
  const connected = await run({ anthropic: { connected: true, authMethod: 'API Key', user: 'sk-...1234' } });
  const firstRun = await run({});

  const ok =
    connected.errors === 0 && firstRun.errors === 0 &&
    connected.cards === 5 && firstRun.cards === 5 &&
    connected.authorOpts >= 1 && firstRun.authorOpts === 5 &&
    firstRun.saveCalls === 1 && firstRun.modalHidden === false;

  console.log('TEST 1 (provider connected):', JSON.stringify(connected));
  console.log('TEST 2 (first run, none connected):', JSON.stringify(firstRun));
  console.log(ok ? 'VERDICT: PASS' : 'VERDICT: FAIL');
  process.exit(ok ? 0 : 1);
})();
