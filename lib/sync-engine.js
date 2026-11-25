// VolleyPrompt sync engine (todo A4) — the pull/push loop that keeps two devices'
// local state converged through the encrypted profile blob (lib/sync-client.js shape).
//
// Pure orchestration, no DOM, no crypto, no HTTP: the host supplies
//   collect()  -> plain state object with the sections it knows (settings, presets, …)
//   apply(patch) -> write adopted sections into local state (patch = { section: data })
//   transport  -> { pull(): Promise<profile|null>, push(profile): Promise<boolean> }
//                 pull() resolves null when the server has no blob yet; it THROWS on
//                 real errors (offline, unpaired, 5xx). push() resolves false on
//                 retryable failure (rate limit, offline) — the engine just tries later.
//
// LWW correctness (why restamping matters): buildProfile() stamps `now` on every
// section it carries. If a device pushed its whole state after ANY local change, it
// would mark every section newest-even-when-unmodified and a later pull would stomp
// genuinely-newer remote sections. So the engine diffs section DATA against its own
// last-known copy and only restamps the sections whose bytes actually changed.
//
// Loads everywhere via the pairing.js UMD pattern: node tests require() it, the
// renderer and web get it as window.VPSyncEngine (scripts/build-web.mjs copies it).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VPSyncEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const sameData = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function profileOf(state, now) {
    const sections = {};
    for (const [name, data] of Object.entries(state || {})) {
      if (data !== undefined) sections[name] = { updatedAt: now, data: clone(data) };
    }
    return { sections };
  }

  // Creates the loop. Call start() once; markChanged() on every local save.
  function createSyncEngine(options) {
    const {
      collect,
      apply,
      transport,
      debounceMs = 2000,   // todo A4: push() debounced ~2 s after change
      minPullGapMs = 5000, // focus events fire often; don't hammer the endpoint
      log = () => {},
    } = options || {};
    if (typeof collect !== 'function' || typeof apply !== 'function' || !transport) {
      throw new Error('createSyncEngine: collect, apply and transport are required');
    }

    let profile = null;          // last-known merged profile (this device's truth)
    let lastPushedJson = null;   // exact bytes last accepted by the server
    let applying = false;        // suppress markChanged() while adopting remote data
    let pushTimer = null;
    let lastPullAt = 0;
    let pulling = false;
    let pushing = false;
    let stopped = false;

    function collectState() {
      const state = collect() || {};
      const out = {};
      for (const [k, v] of Object.entries(state)) if (v !== undefined) out[k] = v;
      return out;
    }

    // Restamps only the sections whose data changed since our last-known profile.
    // Touched sections get a stamp strictly NEWER than their previous one: two devices
    // can stamp within the same millisecond, and equal ISO stamps must not stall LWW.
    function nextStamp(nowIso, existing) {
      let ms = Date.parse(nowIso);
      const prev = existing && Date.parse(existing.updatedAt);
      if (Number.isFinite(prev) && ms <= prev) ms = prev + 1;
      return new Date(ms).toISOString();
    }

    function restampChanged(nowIso) {
      const current = collectState();
      const base = profile || { sections: {} };
      let touched = [];
      const names = new Set([...Object.keys(base.sections), ...Object.keys(current)]);
      for (const name of names) {
        const mine = base.sections[name];
        const nowData = current[name];
        if (nowData === undefined) continue; // sections are added, never dropped, by this device
        if (!mine || !sameData(mine.data, nowData)) {
          touched.push(name);
        }
      }
      if (!touched.length && profile) return profile;
      const now = new Date().toISOString();
      const next = { sections: { ...base.sections } };
      for (const name of touched) {
        next.sections[name] = { updatedAt: nextStamp(now, base.sections[name]), data: clone(current[name]) };
      }
      return next;
    }

    async function pushNow() {
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
      if (pushing || stopped) return false;
      pushing = true;
      try {
        profile = restampChanged(new Date().toISOString());
        if (!profile || !Object.keys(profile.sections).length) return true;
        const json = JSON.stringify(profile);
        if (json === lastPushedJson) return true; // nothing changed since the last accepted push
        const ok = await transport.push(clone(profile));
        if (ok) lastPushedJson = json;
        log(ok ? 'pushed' : 'push deferred');
        return ok;
      } catch (e) {
        log('push failed: ' + (e && e.message));
        return false;
      } finally {
        pushing = false;
      }
    }

    function schedulePush() {
      if (stopped) return;
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(() => { pushTimer = null; pushNow(); }, debounceMs);
    }

    async function pullNow(force = false) {
      if (pulling || stopped) return false;
      const now = Date.now();
      if (!force && now - lastPullAt < minPullGapMs) return false;
      lastPullAt = now;
      pulling = true;
      try {
        const remote = await transport.pull();
        const firstSync = !profile;
        profile = restampChanged(new Date().toISOString());
        if (remote && remote.sections) {
          const localSections = profile.sections;
          const merged = { sections: { ...localSections } };
          const patch = {};
          let adopted = 0;
          if (firstSync) {
            // Fresh device: the paired profile is the truth — adopt every remote section
            // regardless of stamps (a just-created local copy is stamped "now", which is
            // not evidence of being newer; real clocks on two devices are not comparable).
            for (const [name, incoming] of Object.entries(remote.sections)) {
              if (!incoming || typeof incoming !== 'object' || !('data' in incoming)) continue;
              if (!sameData(localSections[name] && localSections[name].data, incoming.data)) {
                merged.sections[name] = { updatedAt: incoming.updatedAt, data: clone(incoming.data) };
                patch[name] = clone(incoming.data);
                adopted++;
              }
            }
          } else {
            for (const [name, incoming] of Object.entries(remote.sections)) {
              if (!incoming || typeof incoming !== 'object' || !('data' in incoming)) continue;
              const mine = localSections[name];
              const remoteNewer = !mine
                || !/^\d{4}-\d{2}-\d{2}T/.test(mine.updatedAt || '')
                || (typeof incoming.updatedAt === 'string' && incoming.updatedAt > mine.updatedAt);
              if (remoteNewer && !sameData(mine && mine.data, incoming.data)) {
                merged.sections[name] = { updatedAt: incoming.updatedAt, data: clone(incoming.data) };
                patch[name] = clone(incoming.data);
                adopted++;
              }
            }
          }
          profile = merged;
          if (adopted) {
            applying = true;
            try { apply(patch); } finally { applying = false; }
            log('adopted sections: ' + Object.keys(patch).join(', '));
          }
        } else if (remote === null || remote === undefined) {
          // Empty account: seed it with this device's state so the other device can pull.
          if (profile && Object.keys(profile.sections).length) {
            await pushNow();
            log('empty account — seeded');
          }
        }
        return true;
      } catch (e) {
        log('pull failed: ' + (e && e.message));
        return false;
      } finally {
        pulling = false;
      }
    }

    // The renderer's persistence wrapper calls this after EVERY local save.
    function markChanged() {
      if (applying || stopped) return;
      schedulePush();
    }

    async function start() {
      stopped = false;
      await pullNow(true);
    }

    function stop() {
      stopped = true;
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    }

    return {
      start, stop, markChanged, schedulePush,
      pullNow: () => pullNow(false),
      pullNowForced: () => pullNow(true),
      pushNow,
      // Exposed for tests / status UI: what the engine currently believes is synced.
      debugProfile: () => clone(profile),
      isBusy: () => pulling || pushing || !!pushTimer,
    };
  }

  return { createSyncEngine, profileOf, sameData };
});
