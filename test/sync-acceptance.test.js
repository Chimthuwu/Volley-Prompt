// Acceptance (todo A3/A4): one pairing code, two "devices" (desktop renderer + web page),
// ONE change on one device → the other picks it up. Uses the REAL crypto (lib/pairing.js
// WebCrypto in node) against the REAL Pages Function with a mock KV — only the network
// hop and the browsers themselves are faked.
const { test } = require('node:test');
const assert = require('node:assert');

const pairing = require('../lib/pairing.js');
const syncEngineLib = require('../lib/sync-engine.js');
const fn = require('../functions/api/sync/[[path]].js');

// A tiny in-memory fetch that routes to the Pages Function exactly like the site does.
function makeServer() {
  const map = new Map();
  const kv = {
    async get(key, type) {
      const v = map.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) { map.set(key, value); },
    async delete(key) { map.delete(key); },
  };
  const env = { SYNC_KV: kv };
  const fetch = async (path, { method = 'GET', body } = {}) => {
    const url = `https://volley-prompt.pages.dev${path}`;
    const res = await (method === 'GET' ? fn.onRequestGet : method === 'PUT' ? fn.onRequestPut : fn.onRequestDelete)(
      { env, request: new Request(url, { method, body }), url: new URL(url) },
    );
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
  return { fetch, map };
}

// One "device": local state object + the sync engine + the platform transport.
function makeDevice(server, label) {
  const state = { settings: { hue: 0 }, presets: [{ name: 'default' }], composer: { author: 'a', critic: 'b', rounds: '3', idea: '', auto: '0' } };
  const applied = [];
  const secretHolder = { secret: '' };
  let keyPromise = null;
  const getKey = () => {
    if (!secretHolder.secret) return null;
    if (!keyPromise) keyPromise = pairing.deriveProfileKey(secretHolder.secret);
    return keyPromise;
  };
  const transport = {
    pull: async () => {
      const key = await getKey();
      if (!key) throw new Error('not paired');
      const blobId = await pairing.blobIdFor(secretHolder.secret);
      const res = await server.fetch(`/api/sync/${blobId}`);
      if (res.status === 404) return null;
      if (res.status !== 200) throw new Error(`http ${res.status}`);
      return pairing.decryptProfile(key, res.json.blob);
    },
    push: async (profile) => {
      const key = await getKey();
      if (!key) return false;
      const blobId = await pairing.blobIdFor(secretHolder.secret);
      const blob = await pairing.encryptProfile(key, profile);
      const res = await server.fetch(`/api/sync/${blobId}`, { method: 'PUT', body: JSON.stringify(blob) });
      return res.status === 200;
    },
  };
  const engine = syncEngineLib.createSyncEngine({
    collect: () => JSON.parse(JSON.stringify(state)),
    apply: (patch) => {
      applied.push(patch);
      for (const [k, v] of Object.entries(patch)) state[k] = JSON.parse(JSON.stringify(v));
    },
    transport,
    debounceMs: 1,
    minPullGapMs: 0,
    log: (m) => console.info(`[sync ${label}] ${m}`),
  });
  return {
    state, applied, engine,
    pair: (secret) => { secretHolder.secret = secret; keyPromise = null; },
    unpair: () => { secretHolder.secret = ''; keyPromise = null; },
  };
}

test('one code, two devices: a preset changed on one appears on the other', async () => {
  const server = makeServer();
  const desktop = makeDevice(server, 'desktop');
  const web = makeDevice(server, 'web');

  // Desktop pairs (generates the code) and seeds its profile.
  const secret = pairing.generatePairSecret();
  desktop.pair(secret);
  await desktop.engine.start();

  // Web pastes the SAME code → adopts the desktop profile.
  web.pair(secret);
  await web.engine.start();
  assert.deepEqual(web.state.presets, [{ name: 'default' }], 'web adopted the desktop presets');
  assert.deepEqual(web.state.composer, { author: 'a', critic: 'b', rounds: '3', idea: '', auto: '0' });

  // Desktop saves a new preset → debounced push.
  desktop.state.presets = [...desktop.state.presets, { name: 'cite-first' }];
  desktop.engine.markChanged();
  await desktop.engine.pushNow();

  // Web reloads (fresh engine, same secret) → the new preset is there.
  const webReload = makeDevice(server, 'web-reload');
  webReload.pair(secret);
  await webReload.engine.start();
  assert.deepEqual(
    webReload.state.presets,
    [{ name: 'default' }, { name: 'cite-first' }],
    'reload sees the preset saved on the other device',
  );
});

test('the server cannot read the profile: the stored blob is not plaintext', async () => {
  const server = makeServer();
  const device = makeDevice(server, 'desktop');
  device.pair(pairing.generatePairSecret());
  await device.engine.start();
  const stored = [...server.map.entries()].find(([k]) => k.startsWith('blob:'));
  assert.ok(stored, 'a blob was stored');
  const text = stored[1];
  assert.ok(!text.includes('default'), 'presets are NOT readable in the stored blob');
  assert.ok(!text.includes('critic'), 'composer data is NOT readable in the stored blob');
  const blob = JSON.parse(text);
  assert.ok(blob.blob && typeof blob.blob.text === 'string' && /^[0-9a-f]{24}$/.test(blob.blob.nonce), 'ciphertext+nonce shape');
});

test('unpairing stops syncing: further local changes never reach the server', async () => {
  const server = makeServer();
  const device = makeDevice(server, 'desktop');
  const secret = pairing.generatePairSecret();
  device.pair(secret);
  await device.engine.start();
  device.unpair(); // renderer calls engine.stop() + transport can no longer derive a key
  device.engine.stop();
  device.state.settings = { hue: 999 };
  await device.engine.pushNow();
  const blobs = [...server.map.keys()].filter((k) => k.startsWith('blob:'));
  assert.equal(blobs.length, 1, 'only the pre-unpair seed exists');
});
