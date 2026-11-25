// VolleyPrompt Scaffold mode (todo B2) — the shared core for both builds.
//
// The SAME Writer+Reviewer pair that volleys a prompt now volleys a FILE MANIFEST:
//   cycle 1 — folder skeleton: structure, config, PROMPT.md (the approved prompt), todo.md
//   cycle 2 — fill stub files / entry points / data models (still opens clean)
//   cycle 3+ — real head-start: implement the first milestone end to end (cap at cycles)
// The Writer emits a JSON manifest [{path, content}]; the Reviewer scores it with the same
// FITNESS SCORE / VERDICT machinery as a prose prompt. Depth is the cycles slider — the
// MODEL does not decide how deep to go (todo L83: "predictable, not 'the model decides'").
//
// Pure, no DOM, no network: node tests require() it; the renderer and web get it as
// window.VPScaffold (scripts/build-web.mjs copies it into site/).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VPScaffold = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_FILES = 200;               // a scaffold is a head-start, not a codebase dump
  const MAX_FILE_BYTES = 120_000;      // per file; oversized bodies belong on disk, not in a model reply
  const MAX_TOTAL_BYTES = 900_000;     // leaves room inside any reasonable model output cap

  const SCAFFOLD_AUTHOR_SYSTEM = `You are an expert project scaffolder. You receive an approved build prompt and produce the FILE MANIFEST of a ready-to-open project folder as a JSON array: [{"path": "relative/path", "content": "full file text"}]. Rules:
- Paths are relative, forward-slash, no leading slash, no "..", no drive letters, no node_modules or binary files.
- Always include PROMPT.md (the approved prompt, verbatim) and todo.md (the handoff: milestones as checkboxes, files to create, the brief's constraints — so the next coding agent can pick up cold).
- Cycle 1 of N: structure + config + README + PROMPT.md + todo.md + stub files with TODO comments.
- Cycle 2 of N: fill the stubs — entry points, data models, core module skeletons with real signatures.
- Cycle 3+ of N: implement the FIRST milestone end to end (working code, not prose).
- Output ONLY the JSON array. No markdown fences, no commentary. Every file's content must be the COMPLETE file text.`;

  const SCAFFOLD_CRITIC_SYSTEM = `You are a harsh but fair reviewer of a project scaffold. You receive a JSON file manifest for a coding agent to pick up. Review it against this rubric:
1. Completeness — missing directories or files the stack needs (package manifest / dependency file, entry point, README, .gitignore)?
2. Handoff quality — is todo.md present, with actionable checkable milestones that match the brief's scope?
3. Stub discipline — for this depth, are files either implemented or honest stubs (never fake-looking half-truths)?
4. Path hygiene — relative, clean, no collisions, no binaries or secrets?
5. Testability — could an agent open this folder and start at milestone 1 without guessing?
List issues ranked by severity (HIGH / MED / LOW), number every issue, and give a concrete fix (name the exact file). Do not emit a manifest yourself. End with exactly these machine-readable lines:
FITNESS SCORE: N/100 (score completeness, handoff quality, stub discipline, path hygiene, testability)
VERDICT: APPROVE if there are no HIGH issues left, otherwise VERDICT: REVISE.`;

  // Depth semantics (todo L83) — one goal line per cycle, capped at the slider value.
  function cycleGoal(cycle, cycles) {
    const c = Math.max(1, Math.min(Number(cycle) || 1, Number(cycles) || 1));
    if (c === 1) return 'Create the folder skeleton: directory structure, dependency/config files, README, PROMPT.md (the approved prompt verbatim) and todo.md (the handoff). Stub everything else.';
    if (c === 2) return 'Fill the stubs: entry points, data models and core module skeletons with real signatures — the folder must still open clean.';
    return `Real head-start: implement milestone 1 end to end with working code${c > 3 ? ` (this is cycle ${c} of ${cycles} — keep hardening milestone 1, then start milestone 2)` : ''}.`;
  }

  function authorUserContent({ cycle, cycles, idea, prompt, manifest }) {
    const brief = `APPROVED PROMPT:\n${prompt}`;
    const orig = idea && idea.trim() && idea.trim() !== prompt.trim() ? `ORIGINAL IDEA (context):\n${idea.trim()}\n\n` : '';
    const depth = `DEPTH: this is cycle ${cycle} of ${cycles}. Goal: ${cycleGoal(cycle, cycles)}`;
    const prior = manifest && manifest.length
      ? `\n\nCURRENT MANIFEST (revise it — keep every still-valid file, apply the reviewer's fixes):\n${JSON.stringify(manifest.slice(0, MAX_FILES))}`
      : '';
    return `${orig}${brief}\n\n${depth}${prior}`;
  }

  function criticUserContent({ cycle, cycles, prompt, manifest }) {
    return `DEPTH: the user asked for cycle ${cycle} of ${cycles}. Files expected at this depth: ${
      cycle <= 1 ? 'skeleton + config + PROMPT.md + todo.md' : cycle === 2 ? 'skeleton plus real entry points / models' : 'milestone 1 working end to end'
    }.\n\nAPPROVED PROMPT:\n${prompt}\n\nMANIFEST TO REVIEW:\n${JSON.stringify((manifest || []).slice(0, MAX_FILES))}`;
  }

  // Parses and validates a model's manifest reply. Never trusts the model: relative clean
  // paths only, per-file and total size caps, hard file count cap. Returns
  // { ok, manifest?, files?, error? } — error text is safe to show the user.
  function parseManifest(text) {
    if (typeof text !== 'string') return { ok: false, error: 'Empty model reply.' };
    let raw = text.trim();
    // Tolerate a fenced reply even though the system prompt forbids it.
    const fence = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fence) raw = fence[1].trim();
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) {
      return { ok: false, error: 'The reply contained no JSON manifest array.' };
    }
    let parsed;
    try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch (e) {
      return { ok: false, error: `Manifest was not valid JSON: ${e.message}` };
    }
    if (!Array.isArray(parsed)) return { ok: false, error: 'Manifest must be a JSON array.' };
    if (parsed.length > MAX_FILES) return { ok: false, error: `Manifest has ${parsed.length} files (max ${MAX_FILES}).` };
    const seen = new Set();
    let total = 0;
    const manifest = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || typeof item.path !== 'string' || typeof item.content !== 'string') {
        return { ok: false, error: 'Every manifest entry needs string "path" and string "content".' };
      }
      const p = item.path.replace(/\\/g, '/');
      if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.split('/').includes('..')) {
        return { ok: false, error: `Unsafe path in manifest: ${p.slice(0, 80)}` };
      }
      if (seen.has(p)) return { ok: false, error: `Duplicate path in manifest: ${p}` };
      const bytes = new TextEncoder ? new TextEncoder().encode(item.content).length : Buffer.byteLength(item.content);
      if (bytes > MAX_FILE_BYTES) return { ok: false, error: `File too large for a scaffold: ${p} (${bytes} bytes).` };
      total += bytes;
      if (total > MAX_TOTAL_BYTES) return { ok: false, error: `Manifest too large (${total} bytes, max ${MAX_TOTAL_BYTES}).` };
      if (/\b(sk-|api[_-]?key\s*[:=]|password\s*[:=])/i.test(item.content) && !/example|placeholder/i.test(item.path)) {
        return { ok: false, error: `Possible credential in ${p} — scaffolds never contain real secrets. Rename it to an example file or drop the value.` };
      }
      seen.add(p);
      manifest.push({ path: p, content: item.content });
    }
    if (!manifest.length) return { ok: false, error: 'The manifest is empty.' };
    return { ok: true, manifest, files: manifest.length };
  }

  // The todo.md handoff (todo L87) — the file that makes the folder a COLD-START project.
  function buildTodoMd({ idea, prompt, cycles, manifest }) {
    const name = guessProjectName(manifest);
    const files = (manifest || []).map((f) => `- [x] \`${f.path}\``).join('\n');
    const hasPkg = (manifest || []).some((f) => /(^|\/)(package\.json|Cargo\.toml|go\.mod|pyproject\.toml|requirements\.txt)$/.test(f.path));
    return `# ${name} — build handoff

> Generated by VolleyPrompt Scaffold mode. The approved brief is in PROMPT.md; this file is
> the working checklist. Pick the first unchecked box and keep going.

## What this is
${(idea || '').trim() || '(see PROMPT.md)'}

## Constraints (from the approved brief)
${keyConstraints(prompt)}

## Scaffolder notes
- Depth requested: ${cycles} cycle(s) of scaffolding.
- ${hasPkg ? 'A dependency manifest is included — install before running.' : 'No dependency manifest detected — add one for your stack.'}
- Files below were created by the scaffold; everything else is yours to build.

## Milestones
- [ ] M1 — verify the scaffold: install dependencies, open the folder, run it once.
- [ ] M2 — first user-visible feature from PROMPT.md (pick the smallest one).
- [ ] M3 — the rest of PROMPT.md's scope, one checkbox per feature.
- [ ] M4 — polish: error states, empty states, README screenshots.

## Files already created
${files || '- (none)'}

## Working rules for the next agent
- One concern per commit; commit after every finished milestone step.
- Never widen the brief's constraints without writing the change into this file.
`;
  }

  function guessProjectName(manifest) {
    const readme = (manifest || []).find((f) => /readme(\.md|\.txt)?$/i.test(f.path));
    if (readme) {
      const h = readme.content.match(/^#\s+(.+)$/m);
      if (h) return h[1].trim().slice(0, 60);
    }
    return 'Scaffolded project';
  }

  // Pulls the constraint-shaped lines out of the approved prompt for the handoff.
  function keyConstraints(prompt) {
    const lines = String(prompt || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const hits = lines.filter((l) => /^[-*]?\s*(constraint|must|never|only|no |without|tech stack|stack)\b/i.test(l));
    return (hits.length ? hits : lines.slice(0, 5)).map((l) => `- ${l.replace(/^[-*]\s*/, '')}`).join('\n') || '- (none stated)';
  }

  // Same verdict shape as the prose volley (FITNESS SCORE / VERDICT lines).
  function verdictOf(criticText) {
    const t = String(criticText || '');
    const scoreMatch = t.match(/FITNESS SCORE:\s*(\d{1,3})\s*\/\s*100/i);
    const verdictMatch = [...t.matchAll(/VERDICT:\s*\**\s*(APPROVE|REVISE)/gi)];
    return {
      score: scoreMatch ? Math.max(0, Math.min(100, Number(scoreMatch[1]))) : null,
      verdict: verdictMatch.length ? verdictMatch[verdictMatch.length - 1][1].toUpperCase() : 'REVISE',
    };
  }

  return {
    SCAFFOLD_AUTHOR_SYSTEM, SCAFFOLD_CRITIC_SYSTEM,
    cycleGoal, authorUserContent, criticUserContent,
    parseManifest, buildTodoMd, verdictOf,
    MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES,
  };
});
