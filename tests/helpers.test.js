const test = require('node:test');
const assert = require('node:assert');
const H = require('../renderer/helpers.js');

test('escapeHtml escapes every HTML-significant character (regression: old regex escaped none)', () => {
  assert.strictEqual(H.escapeHtml(`<div class="a">Tom & 'Jerry'</div>`), '&lt;div class=&quot;a&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/div&gt;');
  assert.strictEqual(H.escapeHtml('plain'), 'plain');
  assert.strictEqual(H.escapeHtml(42), '42');
});

test('extOf / formatSize', () => {
  assert.strictEqual(H.extOf('A/b/Main.JS'), '.js');
  assert.strictEqual(H.extOf('Makefile'), '');
  assert.strictEqual(H.formatSize(512), '512 B');
  assert.strictEqual(H.formatSize(2048), '2.0 KB');
  assert.strictEqual(H.formatSize(3 * 1024 * 1024), '3.0 MB');
});

test('diffOps marks inserted, deleted and unchanged lines', () => {
  const ops = H.diffOps(['a', 'b', 'c'], ['a', 'x', 'c']);
  assert.deepStrictEqual(ops.map((o) => o.type + ':' + o.text), ['same:a', 'del:b', 'ins:x', 'same:c']);
  assert.strictEqual(H.diffOps(new Array(500).fill('a'), new Array(500).fill('b')), null, 'huge inputs bail out');
});

test('rankContextFiles puts entry points and configs before deep helpers', () => {
  const ranked = H.rankContextFiles([
    { path: 'src/deep/util/helper.js' }, { path: 'notes.txt' }, { path: 'main.js' }, { path: 'package.json' },
  ]).map((e) => e.path);
  assert.deepStrictEqual(ranked.slice(0, 2).sort(), ['main.js', 'package.json']);
  assert.strictEqual(ranked[ranked.length - 1], 'notes.txt');
});

test('parseStamp reads run stamps as UTC', () => {
  const d = H.parseStamp('2026-01-02-03-04-05-final.md');
  assert.strictEqual(d.toISOString(), '2026-01-02T03:04:05.000Z');
  assert.strictEqual(H.parseStamp('2026-01-02-03-04-05-draft.md').getTime(), d.getTime());
  assert.strictEqual(H.parseStamp('nonsense-final.md'), null);
});

test('filterRuns matches every word across title, project, models and outcome', () => {
  const items = [
    { name: 'a-final.md', title: 'Cat platformer', meta: { project: 'Games', modelPair: { author: 'deepseek/x', critic: 'llama/y' }, outcome: 'used' } },
    { name: 'b-draft.md', title: 'Landing page', incomplete: true, meta: { project: 'Web' } },
  ];
  assert.strictEqual(H.filterRuns(items, '').length, 2);
  assert.deepStrictEqual(H.filterRuns(items, 'cat games').map((r) => r.name), ['a-final.md']);
  assert.deepStrictEqual(H.filterRuns(items, 'deepseek').map((r) => r.name), ['a-final.md']);
  assert.deepStrictEqual(H.filterRuns(items, 'stopped').map((r) => r.name), ['b-draft.md']);
  assert.strictEqual(H.filterRuns(items, 'zzz').length, 0);
});

test('estimateRunCost: free is $0, unknown is null, more rounds cost more', () => {
  const free = { free: true }, paid = { inPerM: 1, outPerM: 3 };
  assert.deepStrictEqual(H.estimateRunCost({ rounds: 3, writer: free, reviewer: free }), { low: 0, high: 0 });
  assert.strictEqual(H.estimateRunCost({ rounds: 3, writer: null, reviewer: paid }), null);
  const e = H.estimateRunCost({ ideaChars: 400, rounds: 4, writer: paid, reviewer: paid });
  assert.ok(e.low > 0 && e.high > e.low * 3, 'high covers all rounds');
  const big = H.estimateRunCost({ ideaChars: 400, attachChars: 400000, rounds: 4, writer: paid, reviewer: paid });
  assert.ok(big.high > e.high * 10, 'attachments dominate cost');
});

test('formatMoney', () => {
  assert.strictEqual(H.formatMoney(0), '$0');
  assert.strictEqual(H.formatMoney(0.004), '<$0.01');
  assert.strictEqual(H.formatMoney(0.0234), '$0.023');
  assert.strictEqual(H.formatMoney(1.5), '$1.5');
});
