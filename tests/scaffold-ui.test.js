// jsdom test of Scaffold mode (todo B2): the cycle loop, the preview/confirm guardrails
// (L91), and the injected PROMPT.md/todo.md deliverables (L87) — with the model calls faked
// but every other layer (renderer logic, manifest validation, write contract) real.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('renderer/index.html').replace(/<script[\s\S]*?<\/script>/g, '');
const scaffold = require('../lib/scaffold.js');

const MANIFEST = [
  { path: 'README.md', content: '# Daily Planner\nkeyboard-first' },
  { path: 'package.json', content: '{"name":"planner"}' },
  { path: 'src/app.js', content: 'console.log(1)' },
];
const PROMPT = 'Build a keyboard-first daily planner. Constraints: local persistence only.';
const AUTHOR_REPLY = JSON.stringify(MANIFEST);
const CRITIC_APPROVE = 'No HIGH issues remain.\nFITNESS SCORE: 90/100\nVERDICT: APPROVE';
const CRITIC_REVISE = '1. HIGH — no README.\nFITNESS SCORE: 40/100\nVERDICT: REVISE';

const windows = [];
async function boot({ criticReply = CRITIC_APPROVE, authorReply = AUTHOR_REPLY, writeResult = { ok: true, written: 4 } } = {}) {
  const calls = [];
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  const pv = new Proxy({}, { get: (t, name) => {
    // Test-visible overrides win first (a plain `w.pv.x = fn` must take effect).
    if (Object.prototype.hasOwnProperty.call(t, name)) return t[name];
    return (...a) => {
    calls.push([name, ...a]);
    switch (name) {
      case 'hasKey': return Promise.resolve(true);
      case 'models': return Promise.resolve([{ id: 'deepseek/a', perM: 1, inPerM: 0.5, outPerM: 1.5, isFree: false }]);
      case 'runs': return Promise.resolve([]);
      case 'providersList': return Promise.resolve([{ id: 'openrouter', name: 'OpenRouter', authType: 'api_key' }]);
      case 'providersStatus': return Promise.resolve({});
      case 'providerModels': return Promise.resolve([]);
      case 'scaffoldCall': {
        const cfg = a[0] || {};
        if (cfg.role === 'critic') return Promise.resolve({ text: criticReply });
        return Promise.resolve({ text: authorReply });
      }
      case 'scaffoldPickDir': return Promise.resolve({ ok: true, dir: 'C:/tmp/planner' });
      case 'scaffoldWrite': return Promise.resolve(writeResult);
      default: return Promise.resolve({ ok: true });
    }
    };
  } });
  w.pv = pv; w.scrollTo = () => {}; w.requestAnimationFrame = () => 0;
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true });
  w.eval(read('renderer/helpers.js'));
  w.eval(read('lib/scaffold.js'));
  w.eval(read('renderer/app.js') + '\n' + read('renderer/compare.js'));
  await new Promise((r) => setTimeout(r, 60));
  windows.push(w);
  return { w, calls, doc: w.document };
}

test.afterEach(() => { for (const w of windows.splice(0)) w.close(); });

test('scaffold writes nothing until a destination is picked and confirmed', async () => {
  const { w, calls } = await boot();
  const doc = w.document;
  doc.getElementById('final').value = PROMPT;
  doc.getElementById('rounds').value = '1';
  doc.getElementById('author').value = 'deepseek/a';
  doc.getElementById('critic').value = 'meta-llama/b';
  doc.getElementById('btnScaffold').click();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(doc.getElementById('scaffoldModal').classList.contains('hidden'), false, 'preview modal is up');
  assert.match(doc.getElementById('scaffoldSummary').textContent, /About to create \d+ files/);
  assert.equal(doc.getElementById('scaffoldConfirm').disabled, true, 'confirm locked before a destination');
  assert.ok(!calls.some(([n]) => n === 'scaffoldWrite'), 'no write before confirm');
  // Pick a folder → confirm unlocks.
  doc.getElementById('scaffoldPick').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(doc.getElementById('scaffoldConfirm').disabled, false);
  assert.match(doc.getElementById('scaffoldDir').textContent, /C:\/tmp\/planner/);
  // Confirm → exactly one write with PROMPT.md and todo.md injected (L87).
  doc.getElementById('scaffoldConfirm').click();
  await new Promise((r) => setTimeout(r, 20));
  const writes = calls.filter(([n]) => n === 'scaffoldWrite');
  assert.equal(writes.length, 1);
  const written = writes[0][1].manifest;
  assert.ok(written.some((f) => f.path === 'PROMPT.md' && f.content === PROMPT), 'PROMPT.md is the approved prompt, verbatim');
  const todo = written.find((f) => f.path === 'todo.md');
  assert.ok(todo && /## Milestones/.test(todo.content), 'todo.md handoff is present');
});

test('a REVISE verdict triggers exactly one revision pass with the reviewer text', async () => {
  const { w, calls } = await boot({ criticReply: CRITIC_REVISE });
  const doc = w.document;
  doc.getElementById('final').value = PROMPT;
  doc.getElementById('rounds').value = '1';
  doc.getElementById('author').value = 'a';
  doc.getElementById('critic').value = 'b';
  doc.getElementById('btnScaffold').click();
  await new Promise((r) => setTimeout(r, 50));
  const authorCalls = calls.filter(([n, cfg]) => n === 'scaffoldCall' && cfg.role === 'author');
  assert.equal(authorCalls.length, 2, 'initial author call + one revision');
  assert.match(String(authorCalls[1][1].feedback || ''), /FITNESS SCORE: 40\/100/, 'revision carries the reviewer text');
  assert.equal(doc.getElementById('scaffoldModal').classList.contains('hidden'), false, 'the cycle still completes — preview is up');
});

test('a malformed manifest is retried once with the parse error, then fails loudly', async () => {
  const { w, calls } = await boot({ authorReply: 'I will not emit JSON today.' });
  const doc = w.document;
  doc.getElementById('final').value = PROMPT;
  doc.getElementById('rounds').value = '1';
  doc.getElementById('btnScaffold').click();
  await new Promise((r) => setTimeout(r, 60));
  const authorCalls = calls.filter(([n, cfg]) => n === 'scaffoldCall' && cfg.role === 'author');
  assert.equal(authorCalls.length, 2, 'one retry with the parse error');
  assert.match(String(authorCalls[1][1].feedback || ''), /not a valid manifest/);
  assert.ok(!calls.some(([n]) => n === 'scaffoldWrite'), 'nothing written on failure');
  assert.equal(doc.getElementById('utilityTitle').textContent, 'Scaffold · failed');
});

test('a non-empty destination needs the explicit merge confirmation before overwrite', async () => {
  const { w, calls } = await boot({ writeResult: { ok: false, needsMergePrompt: true, message: 'That folder is not empty.' } });
  const doc = w.document;
  doc.getElementById('final').value = PROMPT;
  doc.getElementById('rounds').value = '1';
  doc.getElementById('btnScaffold').click();
  await new Promise((r) => setTimeout(r, 50));
  doc.getElementById('scaffoldPick').click();
  await new Promise((r) => setTimeout(r, 20));
  doc.getElementById('scaffoldConfirm').click();
  await new Promise((r) => setTimeout(r, 30));
  const writes = calls.filter(([n]) => n === 'scaffoldWrite');
  assert.equal(writes.length, 1, 'first write refused without overwrite');
  assert.equal(writes[0][1].overwrite, undefined, 'no silent overwrite');
  // The merge confirm modal is shown (askConfirm uses #promptModal).
  assert.equal(doc.getElementById('promptModal').classList.contains('hidden'), false, 'merge prompt is up');
  assert.match(doc.getElementById('promptMessage').textContent, /already has files/);
});

test('the merge confirmation names the files that would be replaced', async () => {
  const { w } = await boot({ writeResult: { ok: false, needsMergePrompt: true, message: 'That folder is not empty.', replaces: ['src/app.js', 'README.md'] } });
  const doc = w.document;
  doc.getElementById('final').value = PROMPT;
  doc.getElementById('rounds').value = '1';
  doc.getElementById('btnScaffold').click();
  await new Promise((r) => setTimeout(r, 50));
  doc.getElementById('scaffoldPick').click();
  await new Promise((r) => setTimeout(r, 20));
  doc.getElementById('scaffoldConfirm').click();
  await new Promise((r) => setTimeout(r, 30));
  const message = doc.getElementById('promptMessage').textContent;
  assert.match(message, /2 file\(s\) will be replaced: src\/app\.js, README\.md/);
  assert.match(message, /old versions are saved/);
});

test('no folder picker → confirm becomes the .zip download and exports the manifest', async () => {
  const { w, calls } = await boot({
    // Override the pick response: jsdom has no showDirectoryPicker, so the app should
    // flip into zip mode rather than leave the user stuck.
  });
  w.pv.scaffoldPickDir = () => Promise.resolve({ ok: false, unsupported: true, message: 'This browser cannot write folders.' });
  const doc = w.document;
  doc.getElementById('final').value = PROMPT;
  doc.getElementById('rounds').value = '1';
  doc.getElementById('btnScaffold').click();
  await new Promise((r) => setTimeout(r, 50));
  doc.getElementById('scaffoldPick').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(doc.getElementById('scaffoldConfirm').disabled, false, 'zip mode unlocks confirm without a folder');
  assert.match(doc.getElementById('scaffoldConfirm').textContent, /\.zip/);
  doc.getElementById('scaffoldConfirm').click();
  await new Promise((r) => setTimeout(r, 20));
  const exports = calls.filter(([n]) => n === 'scaffoldExportZip');
  assert.equal(exports.length, 1);
  assert.ok(exports[0][1].manifest.some((f) => f.path === 'todo.md'), 'the handoff rides in the zip');
  assert.ok(!calls.some(([n]) => n === 'scaffoldWrite'), 'zip mode never touches the folder-write contract');
});
