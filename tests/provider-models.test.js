// Regression: choosing a non-OpenRouter provider must list THAT provider's models (and never the
// OpenRouter catalogue or its "show all" button) in the Writer/Reviewer pickers.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'renderer', f), 'utf8');
const html = read('index.html').replace(/<script[\s\S]*?<\/script>/g, '');
const windows = [];
test.after(() => { for (const w of windows) w.close(); });

test('opencode-go selected -> its own models, no OpenRouter list, stale model replaced', async () => {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window; windows.push(w);
  const OC = [{ id: 'hy4-flash-free', isFree: true }, { id: 'mimo-v2.6-flash', isFree: false }];
  w.pv = new Proxy({}, { get: (_t, name) => (...a) => {
    switch (name) {
      case 'hasKey': return Promise.resolve(true);
      case 'models': return Promise.resolve([{ id: 'deepseek/openrouter-only', isFree: false, perM: 1 }]);
      case 'runs': return Promise.resolve([]);
      case 'providersList': return Promise.resolve([{ id: 'openrouter', name: 'OpenRouter', authType: 'api_key' }, { id: 'opencode-go', name: 'OpenCode Go', authType: 'api_key' }]);
      case 'providersStatus': return Promise.resolve({});
      case 'providerModels': return Promise.resolve(a[0] === 'opencode-go' ? OC : []);
      default: return Promise.resolve({ ok: true });
    }
  } });
  w.scrollTo = () => {}; w.requestAnimationFrame = () => 0;
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true });
  w.eval(read('helpers.js'));
  w.eval(read('app.js') + '\n' + read('compare.js'));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(80);
  const doc = w.document;
  const sel = doc.getElementById('authorProvider');
  sel.value = 'opencode-go';
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  await wait(80);
  const author = doc.getElementById('author');
  assert.ok(OC.some((m) => m.id === author.value), `stale OpenRouter model replaced by an OpenCode Go one (got ${author.value})`);
  author.dispatchEvent(new w.Event('focus'));
  await wait(20);
  const menu = [...doc.querySelectorAll('.model-ac')].find((el) => !el.classList.contains('hidden'));
  assert.ok(menu, 'picker opened');
  const ids = [...menu.querySelectorAll('.model-ac-id')].map((e) => e.textContent);
  assert.deepStrictEqual(ids, ['hy4-flash-free', 'mimo-v2.6-flash']);
  assert.ok(!menu.querySelector('.model-ac-more'), 'no OpenRouter "show all" button for other providers');
  // the run-screen swap fields follow the same provider
  const runIds = (() => { doc.getElementById('runAuthor').dispatchEvent(new w.Event('focus')); const open = [...doc.querySelectorAll('.model-ac:not(.hidden)')]; return [...open[open.length - 1].querySelectorAll('.model-ac-id')].map((e) => e.textContent); })();
  assert.deepStrictEqual(runIds, ['hy4-flash-free', 'mimo-v2.6-flash']);
});
