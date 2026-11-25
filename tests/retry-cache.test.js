const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const providerModule = require('../lib/providers.js');
const runsStore = require('../test/../lib/runs-store.js');

const sse = (lines) => new Response(new ReadableStream({
  start(c) { const enc = new TextEncoder(); for (const l of lines) c.enqueue(enc.encode(l + '\n')); c.close(); },
}), { status: 200 });
const okBody = () => sse([
  'data: ' + JSON.stringify({ choices: [{ delta: { content: 'hi there' } }] }),
  'data: ' + JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 2 } }),
  'data: [DONE]',
]);

test('Ollama/OpenAI streams retry on 429 and 5xx, then succeed', async () => {
  providerModule._setRetryBase(5);
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return calls === 1 ? new Response('slow down', { status: 429 }) : calls === 2 ? new Response('oops', { status: 503 }) : okBody(); };
  try {
    let got = '';
    const res = await providerModule.getProvider('ollama').chat({ model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }], onDelta: (d) => { got += d; } });
    assert.strictEqual(calls, 3);
    assert.strictEqual(res.text, 'hi there');
    assert.strictEqual(got, 'hi there');
  } finally { global.fetch = realFetch; }
});

test('retries stop after two attempts and surface a friendly error', async () => {
  providerModule._setRetryBase(5);
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return new Response('no', { status: 429 }); };
  try {
    await assert.rejects(
      providerModule.getProvider('ollama').chat({ model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }], onDelta: () => {} }),
      /HTTP 429.*Rate limited/s,
    );
    assert.strictEqual(calls, 3);
  } finally { global.fetch = realFetch; }
});

test('a dead Ollama gives an actionable error after retrying', async () => {
  providerModule._setRetryBase(5);
  const realFetch = global.fetch;
  global.fetch = async () => { throw new TypeError('fetch failed'); };
  try {
    await assert.rejects(
      providerModule.getProvider('ollama').chat({ model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }], onDelta: () => {} }),
      /Is Ollama running/,
    );
  } finally { global.fetch = realFetch; }
});

test('listRuns is slim (no snapshots), cached, and sees changes made through the store', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-list-'));
  const stamp = '2026-01-02-03-04-05';
  fs.writeFileSync(path.join(dir, `${stamp}-final.md`), 'final');
  fs.writeFileSync(path.join(dir, `${stamp}.title`), 'First title');
  fs.writeFileSync(path.join(dir, `${stamp}.meta.json`), JSON.stringify({ project: 'P', snapshots: [{ round: 1 }, { round: 2 }], metrics: [{}], modelPair: { author: 'a', critic: 'b' } }));
  let list = runsStore.listRuns(dir);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].meta.snapshots, undefined, 'snapshots stay out of the list payload');
  assert.strictEqual(list[0].meta.rounds, 2, 'round count is preserved');
  assert.strictEqual(list[0].meta.project, 'P');
  assert.strictEqual(runsStore.readRun(dir, `${stamp}-final.md`).meta.snapshots.length, 2, 'readRun still returns snapshots');

  assert.ok(runsStore.renameRun(dir, `${stamp}-final.md`, 'Second title'));
  assert.strictEqual(runsStore.listRuns(dir)[0].title, 'Second title');
  assert.ok(runsStore.moveRun(dir, `${stamp}-final.md`, 'Other'));
  assert.strictEqual(runsStore.listRuns(dir)[0].meta.project, 'Other');
  assert.ok(runsStore.deleteRun(dir, `${stamp}-final.md`));
  assert.strictEqual(runsStore.listRuns(dir).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
