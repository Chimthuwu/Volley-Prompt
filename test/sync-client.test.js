// Sync-client core checks (todo A4): per-section LWW merge, build/read roundtrip,
// malformed-input tolerance and history trimming.
const { test } = require('node:test');
const assert = require('node:assert');

const sc = require('../lib/sync-client.js');

const T0 = '2026-11-26T00:00:00.000Z';
const T1 = '2026-11-26T01:00:00.000Z';
const T2 = '2026-11-26T02:00:00.000Z';

test('buildProfile stamps every carried section; readProfile roundtrips', () => {
  const p = sc.buildProfile({ settings: { hue: 300 }, junk: 'not synced' }, T0);
  assert.equal(p.sections.settings.updatedAt, T0);
  assert.deepEqual(p.sections.settings.data, { hue: 300 });
  assert.equal(p.sections.junk, undefined, 'unknown top-level keys are not synced');
  assert.deepEqual(sc.readProfile(p), { settings: { hue: 300 } });
});

test('mergeProfile adopts newer sections and keeps local older ones', () => {
  const local = { sections: {
    settings: { updatedAt: T2, data: { hue: 5 } },      // local newer
    history: { updatedAt: T0, data: ['old'] },          // remote newer
  } };
  const remote = { sections: {
    settings: { updatedAt: T1, data: { hue: 1 } },
    history: { updatedAt: T1, data: ['old', 'new'] },
    presets: { updatedAt: T1, data: [{ name: 'added remotely' }] },
  } };
  const { profile, changed } = sc.mergeProfile(local, remote);
  assert.deepEqual(changed.sort(), ['history', 'presets']);
  assert.deepEqual(profile.sections.settings.data, { hue: 5 }, 'local newer section wins');
  assert.deepEqual(profile.sections.history.data, ['old', 'new']);
  assert.deepEqual(profile.sections.presets.data, [{ name: 'added remotely' }]);
});

test('the same merge on both devices converges (a push after a pull does not clobber)', () => {
  // Device A changed settings, device B changed history, both push their merges:
  // whichever blob lands last carries BOTH sections' winners, so the final pull agrees.
  const base = { sections: { settings: { updatedAt: T0, data: { hue: 0 } }, history: { updatedAt: T0, data: [] } } };
  const a = sc.mergeProfile(base, { sections: { settings: { updatedAt: T1, data: { hue: 1 } } } }).profile;
  const b = sc.mergeProfile(base, { sections: { history: { updatedAt: T1, data: ['run'] } } }).profile;
  const aAfterPull = sc.mergeProfile(a, b).profile;
  const bAfterPull = sc.mergeProfile(b, a).profile;
  assert.deepEqual(sc.readProfile(aAfterPull).settings, { hue: 1 });
  assert.deepEqual(sc.readProfile(aAfterPull).history, ['run']);
  assert.deepEqual(sc.readProfile(bAfterPull), sc.readProfile(aAfterPull));
});

test('malformed remote sections are skipped, never crash the merge', () => {
  const local = sc.buildProfile({ settings: { hue: 1 } }, T0);
  const remote = { sections: {
    broken: null,
    alsoBroken: { noData: true },
    settings: { updatedAt: 'not-a-stamp', data: { hue: 9 } },
  } };
  const { profile, changed } = sc.mergeProfile(local, remote, T1);
  // 'not-a-stamp' is not newer than local T0 -> local kept; broken entries ignored.
  assert.deepEqual(changed, []);
  assert.deepEqual(profile.sections.settings.data, { hue: 1 });
  assert.equal(profile.sections.broken, undefined);
  // A stamp-less but otherwise valid incoming section is adopted with the merge-time stamp.
  const remote2 = { sections: { theme: { data: 'dark' } } };
  const out = sc.mergeProfile(sc.buildProfile({}, T0), remote2, T1);
  assert.deepEqual(out.changed, ['theme']);
  assert.equal(out.profile.sections.theme.updatedAt, T1);
});

test('trimHistory keeps the newest N and leaves other sections alone', () => {
  let p = sc.buildProfile({ history: Array.from({ length: 300 }, (_, i) => ({ round: i })), settings: { a: 1 } }, T0);
  p = sc.trimHistory(p, 200);
  assert.equal(p.sections.history.data.length, 200);
  assert.equal(p.sections.history.data[0].round, 0);
  assert.deepEqual(p.sections.settings.data, { a: 1 });
  const short = sc.buildProfile({ history: [1, 2] }, T0);
  assert.equal(sc.trimHistory(short, 200), short, 'under the cap: same reference, untouched');
});
