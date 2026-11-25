// jsdom test of the sidebar history: hover actions, search filter, keyboard shortcuts,
// compare modal and re-run restore. The pv bridge is mocked and records what the UI calls.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, 'renderer', f), 'utf8');
const html = read('index.html').replace(/<script[\s\S]*?<\/script>/g, '');

const RUNS = [
  { name: '2026-01-02-03-04-05-final.md', title: 'Cat platformer', path: 'x', meta: { project: 'Games', score: 81, modelPair: { author: 'deepseek/a', critic: 'llama/b' } } },
  { name: '2026-01-01-03-04-05-final.md', title: 'Landing page', path: 'y', meta: { project: '', score: 70, modelPair: { author: 'gpt/c', critic: 'llama/b' } } },
];
const FULL = {
  [RUNS[0].name]: { final: 'Line one\nLine TWO\nLine three', idea: 'cat game', meta: { ...RUNS[0].meta, snapshots: [{}, {}], cost: 0.02, config: { rounds: 5, auto: true, authorProvider: 'openrouter', criticProvider: 'openrouter', outputMode: 'deep-plan' }, attachments: ['a.png'] } },
  [RUNS[1].name]: { final: 'Line one\nLine 2\nLine three', idea: 'cat game', meta: { ...RUNS[1].meta, snapshots: [{}], cost: 0.01 } },
};

async function boot() {
  const calls = [];
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  const pv = new Proxy({}, { get: (_t, name) => (...a) => {
    calls.push([name, ...a]);
    switch (name) {
      case 'hasKey': return Promise.resolve(true);
      case 'models': return Promise.resolve([{ id: 'deepseek/a', perM: 1, inPerM: 0.5, outPerM: 1.5, isFree: false }]);
      case 'runs': return Promise.resolve(RUNS);
      case 'openRun': return Promise.resolve(FULL[a[0]] || null);
      case 'providersList': return Promise.resolve([{ id: 'openrouter', name: 'OpenRouter', authType: 'api_key' }]);
      case 'providersStatus': return Promise.resolve({});
      case 'providerModels': return Promise.resolve([]);
      case 'deleteRun': case 'renameRun': case 'moveRun': return Promise.resolve(true);
      case 'projects': return Promise.resolve([]);
      default: return Promise.resolve({ ok: true });
    }
  } });
  w.pv = pv; w.scrollTo = () => {}; w.requestAnimationFrame = () => 0;
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true });
  w.eval(read('helpers.js'));
  w.eval(read('app.js') + '\n' + read('compare.js'));
  await new Promise((r) => setTimeout(r, 60));
  windows.push(w);
  return { w, calls, doc: w.document };
}
// The app keeps timers running (animated background, cost refresh); closing each jsdom window
// clears them so the test process can exit.
const windows = [];
test.after(() => { for (const w of windows) w.close(); });

test('history items get hover actions and open on click', async () => {
  const { doc } = await boot();
  const items = doc.querySelectorAll('.hist-item');
  assert.strictEqual(items.length, 2);
  const labels = [...items[0].querySelectorAll('.hist-actions button')].map((b) => b.getAttribute('aria-label'));
  assert.deepStrictEqual(labels, ['Rename (F2)', 'Move to folder', 'Compare with another volley', 'Delete (Del)']);
  assert.ok(items[0].querySelector('.hist-title').textContent.includes('Cat platformer'));
  assert.strictEqual(items[0].tabIndex, 0);
});

test('search filters the sidebar by title, model and project', async () => {
  const { doc, w } = await boot();
  const search = doc.getElementById('historySearch');
  const type = async (v) => { search.value = v; search.dispatchEvent(new w.Event('input')); await new Promise((r) => setTimeout(r, 20)); };
  await type('landing');
  assert.strictEqual(doc.querySelectorAll('.hist-item').length, 1);
  await type('deepseek');
  assert.strictEqual(doc.querySelectorAll('.hist-item').length, 1);
  await type('nothing-matches');
  assert.strictEqual(doc.querySelectorAll('.hist-item').length, 0);
  assert.ok(doc.querySelector('.history-empty'));
});

test('Delete key asks for confirmation, then deletes', async () => {
  const { doc, w, calls } = await boot();
  const item = doc.querySelector('.hist-item');
  item.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!doc.getElementById('promptModal').classList.contains('hidden'), 'confirm dialog shown');
  assert.ok(!calls.some((c) => c[0] === 'deleteRun'), 'nothing deleted before confirming');
  doc.getElementById('promptOk').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(calls.some((c) => c[0] === 'deleteRun' && c[1] === RUNS[0].name));
});

test('compare opens both volleys side by side with a diff', async () => {
  const { doc, w } = await boot();
  w.openCompare(RUNS[0].name, RUNS[1].name);
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(!doc.getElementById('compareModal').classList.contains('hidden'));
  assert.ok(doc.getElementById('compareTextA').textContent.includes('Line TWO'));
  assert.ok(doc.getElementById('compareTextB').innerHTML.includes('ln-ins'), 'right side highlights changes');
  assert.ok(doc.getElementById('compareMetaA').textContent.includes('81/100'));
  assert.ok(doc.getElementById('compareSummary').textContent.includes('Same original idea'));
});

test('re-run restores idea, models, rounds, mode and warns about attachments', async () => {
  const { doc, w } = await boot();
  doc.querySelector('.hist-item').click();
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(doc.getElementById('setup').classList.contains('hidden'), 'composer is hidden while a saved volley is open');
  assert.ok(!doc.getElementById('result').classList.contains('hidden'));
  assert.strictEqual(doc.getElementById('btnRerun').hidden, false);
  doc.getElementById('btnRerun').click();
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(doc.getElementById('idea').value, 'cat game');
  assert.strictEqual(doc.getElementById('author').value, 'deepseek/a');
  assert.strictEqual(doc.getElementById('rounds').value, '5');
  assert.strictEqual(doc.getElementById('auto').checked, true);
  assert.strictEqual(doc.getElementById('outputMode').value, 'deep-plan');
  assert.ok(doc.getElementById('toasts').textContent.includes('a.png'), 'toast names the files to re-attach');
});

test('cost estimate appears for priced models', async () => {
  const { doc, w } = await boot();
  doc.getElementById('author').value = 'deepseek/a'; doc.getElementById('critic').value = 'deepseek/a';
  doc.getElementById('idea').value = 'x'.repeat(2000);
  doc.getElementById('idea').dispatchEvent(new w.Event('input'));
  await new Promise((r) => setTimeout(r, 30));
  assert.match(doc.getElementById('costEstimate').textContent, /Estimated cost: typically .*\$[\d.]+/);
});
