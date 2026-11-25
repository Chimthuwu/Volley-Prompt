// VolleyPrompt sync client core (todo A4) — pure logic, no DOM, no IPC.
//
// A synced "profile" is one JSON object with TOP-LEVEL SECTIONS (settings, presets,
// modelPairs, composer, theme, history…). Conflict rule (todo A4): last-write-wins PER
// SECTION, not per whole blob, so a settings tweak on one device and a new run on the
// other both survive. Each section carries an `updatedAt` timestamp written by the
// device that changed it.
//
// Shape:
// {
//   sections: { settings: { updatedAt, data }, presets: { updatedAt, data }, … },
// }
// Only the section MAP is merged; everything else is transport detail.

// Sections a device may sync. Unknown sections from the future are preserved on merge
// (forward compatibility), so the list here only governs what buildProfile copies out.
const SYNCED_SECTIONS = ['settings', 'presets', 'modelPairs', 'composer', 'theme', 'history'];

function isStamp(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)); }

// Wraps a plain state object into the sectioned profile shape, stamping `now` on every
// section it carries (used by a device pushing its FULL state for the first time).
export function buildProfile(state, now = new Date().toISOString()) {
  const sections = {};
  for (const name of SYNCED_SECTIONS) {
    if (state && Object.prototype.hasOwnProperty.call(state, name)) {
      sections[name] = { updatedAt: now, data: state[name] };
    }
  }
  return { sections };
}

// Merges remote into local, per section: the newer updatedAt wins; ties keep local
// (deterministic on both devices only if ties are broken identically — the device that
// just pulled keeps its own copy, and the remote push will have stamped itself newer).
// Returns { profile, changed } — changed lists the section names local adopted.
export function mergeProfile(local, remote, now = new Date().toISOString()) {
  const base = local && typeof local === 'object' ? local : { sections: {} };
  const remoteSections = (remote && typeof remote === 'object' && remote.sections) || {};
  const localSections = base.sections || {};
  const sections = { ...localSections };
  const changed = [];
  for (const [name, incoming] of Object.entries(remoteSections)) {
    if (!incoming || typeof incoming !== 'object' || !('data' in incoming)) continue; // skip malformed
    const mine = localSections[name];
    if (!mine || !isStamp(mine.updatedAt) || (isStamp(incoming.updatedAt) && incoming.updatedAt > mine.updatedAt)) {
      sections[name] = { updatedAt: isStamp(incoming.updatedAt) ? incoming.updatedAt : now, data: incoming.data };
      changed.push(name);
    }
  }
  return { profile: { sections }, changed };
}

// Flattens a profile back into the plain app-state object the UI stores.
export function readProfile(profile) {
  const out = {};
  const sections = (profile && typeof profile === 'object' && profile.sections) || {};
  for (const name of SYNCED_SECTIONS) {
    if (sections[name] && typeof sections[name] === 'object' && 'data' in sections[name]) {
      out[name] = sections[name].data;
    }
  }
  return out;
}

// Stamps one section as locally changed (call before pushing).
export function touchSection(profile, name, data, now = new Date().toISOString()) {
  const base = profile && typeof profile === 'object' && profile.sections ? profile : { sections: {} };
  return { sections: { ...base.sections, [name]: { updatedAt: now, data } } };
}

// Trims the history section to the N most-recent entries (todo A4 size caps; the sync
// blob must stay well under the 1 MB server cap). Entries keep whatever order the app
// uses (newest first) — this just slices.
export function trimHistory(profile, max = 200) {
  const sections = profile?.sections || {};
  const hist = sections.history;
  if (!hist || !Array.isArray(hist.data)) return profile;
  if (hist.data.length <= max) return profile;
  return { sections: { ...sections, history: { updatedAt: hist.updatedAt, data: hist.data.slice(0, max) } } };
}
