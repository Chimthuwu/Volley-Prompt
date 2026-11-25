// Sync-engine loop checks (todo A4): the pull-on-open / push-debounced-after-change
// wiring, LWW adoption into local state, and the restamp-only-what-changed rule that
// keeps a whole-state push from stomping a newer remote section.
const { test } = require('node:test');
const assert = require('node:assert');

const engine = require('../lib/sync-engine.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeHarness({ remote = null, pushOk = true, pullThrows = null, debounceMs = 5 } = {}) {
  const applied = [];
  const pushed = [];
  let state = { settings: { hue: 0 }, presets: [{ name: 'a' }] };
  const harness = {
    applied, pushed,
    state,
    setRemote: (p) => { remote = p; },
    getRemote: () => remote,
    engine: engine.createSyncEngine({
      collect: () => JSON.parse(JSON.stringify(state)),
      apply: (patch) => { applied.push(patch); for (const [k, v] of Object.entries(patch)) state[k] = v; },
      transport: {
        pull: async () => { if (pullThrows) throw pullThrows; return remote; },
        push: async (p) => { if (!pushOk) return false; pushed.push(p); remote = p; return true; },
      },
      debounceMs,
      minPullGapMs: 0,
      log: () => {},
    }),
  };
  return harness;
}

test('start on an empty account seeds the server with this device state', async () => {
  const h = makeHarness();
  await h.engine.start();
  assert.equal(h.pushed.length, 1);
  assert.deepEqual(h.pushed[0].sections.settings.data, { hue: 0 });
});

test('pull adopts newer remote sections and applies them locally', async () => {
  const h = makeHarness({
    remote: { sections: { presets: { updatedAt: '2026-11-26T01:00:00.000Z', data: [{ name: 'from web' }] } } },
  });
  await h.engine.start();
  assert.deepEqual(h.state.presets, [{ name: 'from web' }], 'apply() ran with the adopted section');
  assert.deepEqual(h.applied, [{ presets: [{ name: 'from web' }] }]);
  assert.equal(h.state.settings, h.state.settings, 'untouched section kept');
});

test('pull does not adopt an older remote section on a non-first pull (LWW keeps local)', async () => {
  // First pull adopts remote wholesale (fresh device). A LATER pull must compare
  // stamps: a remote section stamped before this device's own change stays behind.
  const h = makeHarness(); // remote = null → start() seeds; profile now has real stamps
  await h.engine.start();
  h.setRemote({ sections: { settings: { updatedAt: '2020-01-01T00:00:00.000Z', data: { hue: 99 } } } });
  await h.engine.pullNowForced();
  assert.deepEqual(h.state.settings, { hue: 0 }, 'stale remote lost');
  assert.deepEqual(h.applied, [], 'nothing applied');
});

test('push restamps ONLY sections whose data changed', async () => {
  const h = makeHarness();
  await h.engine.start();
  const first = h.pushed[0];
  h.state.settings = { hue: 300 };
  await h.engine.pushNow();
  const second = h.pushed[1];
  assert.equal(second.sections.settings.data.hue, 300);
  assert.equal(
    second.sections.presets.updatedAt,
    first.sections.presets.updatedAt,
    'unchanged section keeps its original stamp',
  );
});

test('markChanged debounces into one push', async () => {
  const h = makeHarness({ debounceMs: 10 });
  await h.engine.start();
  h.state.settings = { hue: 1 };
  h.engine.markChanged();
  h.state.settings = { hue: 2 };
  h.engine.markChanged();
  h.state.settings = { hue: 3 };
  h.engine.markChanged();
  assert.equal(h.pushed.length, 1, 'nothing pushed while debouncing');
  await sleep(40);
  assert.equal(h.pushed.length, 2);
  assert.deepEqual(h.pushed[1].sections.settings.data, { hue: 3 }, 'last value wins');
});

test('an idempotent markChanged (same bytes) does not re-push', async () => {
  const h = makeHarness({ debounceMs: 5 });
  await h.engine.start();
  h.engine.markChanged(); // collect() unchanged
  await sleep(20);
  assert.equal(h.pushed.length, 1);
});

test('apply() feedback is suppressed: adopting remote data does not re-push it', async () => {
  const h = makeHarness({
    remote: { sections: { presets: { updatedAt: '2026-11-26T02:00:00.000Z', data: [{ name: 'x' }] } } },
  });
  await h.engine.start();
  assert.deepEqual(h.state.presets, [{ name: 'x' }]);
  assert.equal(h.pushed.length, 0, 'adoption applies locally, no echo push');
});

test('offline pull fails soft (no throw, no apply)', async () => {
  const h = makeHarness({ pullThrows: new Error('offline') });
  await h.engine.start();
  assert.deepEqual(h.state.presets, [{ name: 'a' }]);
  assert.deepEqual(h.applied, []);
});

test('failed push resolves false and is retried on the next markChanged', async () => {
  const h = makeHarness({ pushOk: false, debounceMs: 5 });
  await h.engine.start();
  h.state.settings = { hue: 9 };
  h.engine.markChanged();
  await sleep(20);
  assert.equal(h.pushed.length, 0);
});

test('stop() cancels a pending debounce and blocks further pushes', async () => {
  const h = makeHarness({ debounceMs: 10 });
  await h.engine.start();
  h.engine.stop();
  h.state.settings = { hue: 5 };
  h.engine.markChanged();
  await sleep(30);
  assert.equal(h.pushed.length, 1, 'only the start() seed');
});

test('two engines converging on the same server reach identical state', async () => {
  // Device A seeds; device B pulls it, changes settings, pushes; A pulls again —
  // both end with B's settings and A's presets (per-section LWW, per todo A4).
  const server = { profile: null };
  const mk = (initial) => {
    let state = initial;
    return {
      state,
      applied: [],
      engine: engine.createSyncEngine({
        collect: () => JSON.parse(JSON.stringify(state)),
        apply: (patch) => { for (const [k, v] of Object.entries(patch)) state[k] = v; },
        transport: {
          pull: async () => (server.profile ? JSON.parse(JSON.stringify(server.profile)) : null),
          push: async (p) => { server.profile = JSON.parse(JSON.stringify(p)); return true; },
        },
        debounceMs: 1,
        minPullGapMs: 0,
      }),
    };
  };
  const a = mk({ settings: { hue: 1 }, presets: ['A1'] });
  const b = mk({ settings: { hue: 9 }, presets: ['B1'] });
  await a.engine.start();               // A seeds
  await b.engine.start();               // B adopts A's sections
  assert.deepEqual(b.state.settings, { hue: 1 });
  assert.deepEqual(b.state.presets, ['A1']);
  b.state.settings = { hue: 2 };
  b.engine.markChanged();
  await b.engine.pushNow();             // B pushes its change
  await a.engine.start();               // A re-pulls
  assert.deepEqual(a.state.settings, { hue: 2 }, 'A adopts B');
  assert.deepEqual(a.state.presets, ['A1']);
  assert.deepEqual(JSON.parse(JSON.stringify(a.state)), JSON.parse(JSON.stringify(b.state)), 'identical converged state');
});
