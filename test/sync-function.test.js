// Unit checks for the sync Pages Function (todo A2) using a mocked KV namespace.
// The function is pure Request -> Response over `env.SYNC_KV`, so the contract is
// testable without Cloudflare: storage key shape, size caps, rate limit, 404s.
const { test } = require('node:test');
const assert = require('node:assert');

const fn = require('../functions/api/sync/[[path]].js');

const HEX = 'a'.repeat(64);

function mockKV() {
  const map = new Map();
  return {
    map,
    async get(key, type) {
      const v = map.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value, opts) { map.set(key, value); if (opts) map.set(`${key}\0opts`, opts); },
    async delete(key) { map.delete(key); },
  };
}

function ctx(env, path, { method = 'GET', body } = {}) {
  const url = `https://volley-prompt.pages.dev/api/sync/${path}`;
  return { env, request: new Request(url, { method, body }), url: new URL(url) };
}

test('PUT stores the blob under blob:<blobId> and returns an updatedAt', async () => {
  const kv = mockKV();
  const res = await fn.onRequestPut(ctx({ SYNC_KV: kv }, HEX, { method: 'PUT', body: JSON.stringify({ settings: { hue: 300 } }) }));
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(out.updatedAt));
  const stored = JSON.parse(kv.map.get(`blob:${HEX}`));
  assert.deepEqual(stored.blob, { settings: { hue: 300 } });
  assert.equal(stored.updatedAt, out.updatedAt);
});

test('GET returns the stored blob and 404s unknown ids', async () => {
  const kv = mockKV();
  const miss = await fn.onRequestGet(ctx({ SYNC_KV: kv }, HEX));
  assert.equal(miss.status, 404);
  await fn.onRequestPut(ctx({ SYNC_KV: kv }, HEX, { method: 'PUT', body: '{"x":1}' }));
  const hit = await fn.onRequestGet(ctx({ SYNC_KV: kv }, HEX));
  assert.equal(hit.status, 200);
  const out = await hit.json();
  assert.deepEqual(out.blob, { x: 1 });
});

test('invalid blobIds are rejected before they can become storage keys', async () => {
  const kv = mockKV();
  for (const bad of ['short', 'Z'.repeat(64), `${HEX}/../../evil`, '']) {
    const res = await fn.onRequestGet(ctx({ SYNC_KV: kv }, encodeURIComponent(bad)));
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
  }
});

test('oversized bodies get 413, non-JSON gets 400', async () => {
  const kv = mockKV();
  const big = JSON.stringify({ pad: 'x'.repeat(1_000_001) });
  assert.equal((await fn.onRequestPut(ctx({ SYNC_KV: kv }, HEX, { method: 'PUT', body: big }))).status, 413);
  assert.equal((await fn.onRequestPut(ctx({ SYNC_KV: kv }, HEX, { method: 'PUT', body: 'not json' }))).status, 400);
});

test('rate limit trips after 30 PUTs in a minute and only for that blobId', async () => {
  const kv = mockKV();
  const env = { SYNC_KV: kv };
  for (let i = 0; i < 30; i++) {
    const res = await fn.onRequestPut(ctx(env, HEX, { method: 'PUT', body: '{"n":' + i + '}' }));
    assert.equal(res.status, 200, `put ${i}`);
  }
  const limited = await fn.onRequestPut(ctx(env, HEX, { method: 'PUT', body: '{"n":31}' }));
  assert.equal(limited.status, 429);
  // A different blobId is untouched.
  const other = await fn.onRequestPut(ctx(env, 'b'.repeat(64), { method: 'PUT', body: '{"n":0}' }));
  assert.equal(other.status, 200);
});

test('DELETE removes the blob; missing KV binding answers 503 instead of crashing', async () => {
  const kv = mockKV();
  await fn.onRequestPut(ctx({ SYNC_KV: kv }, HEX, { method: 'PUT', body: '{"x":1}' }));
  assert.equal((await fn.onRequestDelete(ctx({ SYNC_KV: kv }, HEX, { method: 'DELETE' }))).status, 200);
  assert.equal((await fn.onRequestGet(ctx({ SYNC_KV: kv }, HEX))).status, 404);
  const noKv = await fn.onRequestGet(ctx({}, HEX));
  assert.equal(noKv.status, 503);
});
