# VolleyPrompt — Architecture TODO

> This file supersedes the old plain TODO (its status is preserved at the bottom under **"Where we already are"**).
> Two new workstreams: **(A) web ⇄ desktop sync with accounts**, and **(B) a "hand the finished prompt off" feature** (deep-link + an agentic Scaffold mode).

---

## TL;DR — the two decisions you asked me to weigh in on

**Accounts / login:** Do **not** start with Google. Your real goal today is *"sync my desktop install to the web app"*, not *"I have a SaaS with users and billing."* The cheapest, fastest, zero-PII way is exactly what you intuited: **a pairing secret (a high-entropy "hash")**. Press **Pair** on one device → it shows a **URL-safe base64 code** (plus a QR); paste it on the other; both read/write the same **encrypted** blob in a key-value store keyed by `sha256(secret)`. No email, no password, no OAuth app to register, no user-management screen, and the server **cannot read your data** (encrypted client-side with a key derived from the secret). Backend stays on Cloudflare — no third-party vendor in the data path.

Google login is **better later**, when you want *recoverable, multi-device, real accounts* (fresh machine, no code, history still comes back). Build storage so the pairing secret is just an *anonymous account id*, and Google sign-in is **another way to claim that same id**. Today `user_id = sha256(secret)`; tomorrow `user_id = google_sub`, and a signed-in Google user enters a pairing code to **migrate** their hash-account under their email. **Ship the hash now — same table row a Google account reuses later.** One backend, two ways into identity, no rewrite.

Hard rule: **the OpenRouter API key never syncs to the server.** It stays device-local as today (desktop = OS keychain `key.bin`; web = `localStorage['vp_api_key']`). Sync *settings, presets, model pairs, run history* — not the credential. Key-in-the-cloud = real OAuth + at-rest crypto review = its own milestone. Don't let a shared secret hash unlock your credit balance.

**Handoff feature:** do **both**. The button next to *Copy prompt* that "sends it to Hermes/Claude/Cursor" is nearly free (deep links) — **do it first**. But the bigger idea — *use the same Writer+Reviewer pair to scaffold a folder, prep it for the other coding agents, optionally get a head-start, and emit a `todo.md` handoff, depth driven by the existing "cycles" slider* — is the real feature, and **yes, it makes sense and it's the right shape.** It turns VolleyPrompt from "write a good prompt" into "start the project." One constraint to design around up front: **a browser cannot silently create a folder of files on your disk.** So Scaffold is **desktop-first**; on web it uses the Chromium **File System Access API** (`showDirectoryPicker`, Chrome/Edge), falls back to a **`.zip`** download, or writes into the synced blob and the desktop materializes it (ties to A).

---

## Where things are now (the real starting line)

- **Two front-ends that have already diverged.** `renderer/app.js` (Electron) and `site/app.js` (web) are ~96–98 KB copies of the same UI. Sync is hard **because the codebase is forked**, not because there's no backend. Unifying first makes everything below cheap.
- **The seam already exists.** `preload.js` (desktop) and `site/pv.js` (web) both expose the same `window.pv` bridge; `app.js` is written against it. That's the adapter we extend — no UI rewrite to add sync.
- **Web is static-only.** `wrangler.jsonc` serves `./site` as Cloudflare Pages *assets*. No Pages Functions/Workers backend, no datastore, no auth. Sync needs all three.
- **State is local only.** Keys: `vp_api_key`, `vp_history`, `vpSettings`, `vpPresets`, `vpModelPairs`, loose composer keys (`author`,`critic`,`rounds`,`idea`,`auto`, theme hue/sat/contrast); desktop also keeps runs on disk in `Documents/VolleyPrompt/`. None leaves the device.

---

## Workstream A — Synced accounts (web ⇄ desktop)

### A1. Unified frontend (do first — it's the tax on everything)
- [x] Make `renderer/` and `site/` share **one** source for `app.js`/`store.js`/styles (build step emits both, or web loads the same files Electron uses). Kill the hand-copied fork. — `scripts/build-web.mjs` (`npm run build:web`, also run by `site:deploy`) emits site/app.js, site/style.css, site/helpers.js, site/compare.js from renderer/ and adapts site/index.html. Added 2026-11-26.
- [x] Confirm `window.pv` is the *only* environment-specific surface; everything Electron-vs-web divergent routes through it. — site/pv.js gained openRun + the provider surfaces (web is OpenRouter-only); the build script verifies every id app.js queries exists in the emitted HTML.
- [x] Acceptance: editing UI logic once updates both the desktop build and the deployed site; `npm run dist` and `npm run site:deploy` both pick it up. — both scripts now emit from renderer/; the *deployed* site still needs the owner-gated `npm run site:deploy` ([!]) to pick it up.

### A2. Backend — **DECIDED (2026-11-01): Cloudflare. Supabase is off the table.**
Everything stays on the account the site is already deployed to. One `wrangler`, one dashboard, no third-party vendor holding your data.
- [x] **Pages Functions** (ships in the same deploy as `./site`) serve `/api/sync/*` — `functions/api/sync/[[path]].js`, GET/PUT/DELETE of one opaque blob per account, unit-tested against a mock KV (test/sync-function.test.js). Added 2026-11-26.
- [!] **KV** holds the encrypted profile blob (opaque to the server); **R2** holds oversized run bodies with pointers left in KV; **D1** only if history needs querying rather than whole-blob reads. — the CODE side is done (endpoint + tests + engine, answers 503 until bound); the KV *binding* and any R2 bucket need the OWNER to run `npx wrangler kv namespace create SYNC` / create the bucket and paste the ids into wrangler.jsonc ([!] wrangler auth + account resources). **D1 decided NOT needed** (2026-11-26): sync reads whole blobs and merges per section client-side; there is no server-side history query use case until history itself syncs — revisit only if a "browse history on the server" feature appears.
- [x] **No Supabase** (user's call, 2026-11-01). Do not reintroduce it as a shortcut when Google login comes up — real accounts then = Google OAuth verified **in a Pages Function** (`google_sub` → account row), still on Cloudflare, still no vendor in the data path.
- [x] Add `functions/` to the Pages project so the API and the static site deploy together — `wrangler pages deploy site` picks up `functions/` automatically; `site:deploy` now also runs `build:web` first.

### A3. Identity — pairing secret (now) — **DECIDED: base64 code, not a word mnemonic**
- [x] `generatePairSecret()`: 128-bit random → **URL-safe base64** (22 chars, no padding) — implemented in `lib/pairing.js` with `blobIdFor()` (sha256 hex) and PBKDF2/AES-GCM profile crypto; 5 node tests cover shape, derivation, roundtrip, tamper rejection. Added 2026-11-26.
- [x] Copy/paste-first is DONE (Settings > Sync between devices: selectable field + Copy code, one paste box on both ends). QR display deferred — see Inbox (needs a small QR encoder; adding a dependency is a review-me choice). — DECIDED 2026-11-26: QR stays deferred in the Inbox; a from-scratch QR encoder is error-prone and vendoring a third-party one is a dependency review the owner should make — copy/paste is the primary transport and works everywhere.
- [x] `derivedKey = PBKDF2/Argon2(secret)` client-side; `blobId = sha256(secret)` — `deriveProfileKey()` / `blobIdFor()` in lib/pairing.js (pure WebCrypto, works in Electron, browsers and node).
- [x] Desktop "Pair" → shows the secret; Web paste box → both persist and derive the same `blobId` (lib/pairing.js). The "read/write each other's state" part = the A4 client wiring (pull/push) — DONE 2026-11-26: engine loop + both transports wired (commit ab09917).
- [x] Persist secret locally on pair (desktop: `pairing.bin` beside `key.bin` under safeStorage; web: `localStorage` — weaker than the keychain, but the **payload is E2E-encrypted**, so the threat is a leaked secret, not a server breach).
- [x] Server stores **opaque encrypted blobs** keyed by `blobId` + updatedAt only — functions/api/sync/[[path]].js (A2, tested).
- [!] Acceptance: pair desktop↔web with one code; change a preset on one, reload the other, it's there; unpair clears the local secret (orphaned server blob is fine). — automated full-stack equivalent PASSES (test/sync-acceptance.test.js: real crypto + real Pages Function + mock KV, presets cross devices, unpair stops syncing); the LIVE device pass needs the deployed KV namespace (owner wrangler auth, same gate as A2's KV id + site deploy).

### A4. Sync protocol
- [x] Payload = one JSON "profile" with TOP-LEVEL SECTIONS (settings, presets, modelPairs, composer, theme, history) — `lib/sync-client.js` buildProfile/readProfile; history metadata + prompts, never attachment contents.
- [x] `pull()` on open/focus; `push()` debounced ~2 s after change. — DONE 2026-11-26: lib/sync-engine.js (restamps only sections whose data changed, first-pull adopts the paired profile wholesale, min 5 s pull gap) wired in renderer/app.js (store.set wrapper + focus/visibilitychange) with transports pv.syncPull/syncPush in preload.js + main.js (desktop, VP_SYNC_URL overridable) and site/pv.js (web, same-origin). Run-history section not collected yet (desktop disk vs web localStorage) — its own task.
- [x] **Conflict rule:** last-write-wins **per top-level section** — `mergeProfile()` in lib/sync-client.js; a convergence test proves two devices merging in opposite orders reach identical state. (CRDT is overkill for two devices.)
- [!] Size caps: server enforces ≤ 1 MB (413) and `trimHistory()` keeps the newest N — the cap + newest-200 history trim BEFORE push are DONE (lib/sync-engine.js maxHistory, tested); **R2 for oversized run bodies still to do** (later; needs an R2 bucket, owner-gated like the KV id).
- [x] Rate-limit `/api/sync` per `blobId` (the only "auth") — 30 PUT/min, best-effort KV counters, tested.

### A5. Google login (later — same table)
- [ ] `accounts` row keyed by `google_sub` that can **claim** a `blobId` via pairing code → migrates hash-account data under the email identity; future devices use `google_sub` directly.
- [ ] OAuth **verified in a Pages Function** (Google id-token → `google_sub`); no auth vendor in the data path. Cloudflare Access is the alternative if you'd rather gate than integrate.
- [ ] Recovery: "lost my devices/secret" → sign in with Google, data's there.
- [ ] **Still never store the OpenRouter key server-side**, even for Google users (per-device key, or an opt-in encrypted "key vault" as its own crypto-reviewed milestone).

---

## Workstream B — Hand the finished prompt off

### B1. "Send to ▸" handoff (cheap — do first)
- [x] Next to the result tools, **Send to ▸** (Cursor / Claude / VS Code / Cline / **Hermes**) — replaced the old Copy+Cursor button. Added 2026-11-26.
- [x] `main.js` already whitelists `cursor://`, `claude://`, `vscode://`, `https://` in `url:open`, and `clipboard:write` exists → "copy + open agent" is two existing calls. — verified 2026-11-26 (main.js url:open regex + the Send-to handler uses pv.copy then pv.openUrl).
- [x] Web: `navigator.clipboard` + same scheme URLs (pv.openUrl allows cursor/claude/vscode/https; a toast tells the user to paste if the browser blocks the launch).
- [x] **Hermes is a DIRECT handoff, not a Discord message** (user's call, 2026-11-01) — shipped the CLI-spawn path (`hermes chat -q <prompt>` via hermes:run IPC, output lands in the app's utility panel); the `/v1/runs` gateway-API path needs a stored token and is still open:
  - **Preferred — the gateway's local API:** `POST /v1/runs` with the prompt as the run's first message, then poll `GET /v1/runs/{id}` / `/events` to show progress inside VolleyPrompt's own result panel. Needs `platforms.api_server` enabled locally (already configured in `config.yaml`: `api_server.max_concurrent_runs: 10`) and a token. `POST /v1/runs/{id}/steer` and `/stop` give the app live control over the run.
  - **Fallback — spawn the CLI:** `hermes chat -q "<prompt>"` as a detached child process (desktop only, no API/token needed); capture stdout to the result panel.
- [x] Either way the app needs a **destination choice + a "what to do with it" prefix** — "build this" vs "review this" — because a bare prompt pasted at Hermes will just be answered, not executed. Keep the handoff text explicit about the expected action and the project folder. — DONE 2026-11-26: Send-to ▸ menu gained an intent chooser (Build it / Review it / Answer only, remembered per device in `sendIntent`); build/review prepend an explicit Task: line + the volley's project folder, the prompt body itself is untouched.
- [x] Acceptance: one click copies the prompt (formatting intact) and opens the chosen agent; the Hermes path starts a local CLI run with **zero Discord messages involved**.

### B2. Scaffold mode — the real feature (Writer+Reviewer build the folder)
> The same two models, in a new role, take the approved prompt and produce a ready project folder for downstream coding agents, optionally with a head-start, and always a `todo.md` handoff. **Depth = the existing "cycles" slider: 1 = scaffold + `todo.md`; more cycles = keep going into a real head-start ("three is plenty").**

- [x] **Structured output mode:** add `SCAFFOLD_AUTHOR_SYSTEM` → "Emit a JSON file manifest `[{path, content}]`"; `SCAFFOLD_CRITIC_SYSTEM` reviews the manifest (missing dirs? no README? todo not actionable?) and revises. Reuse the round/verdict machinery — only "what a draft is" changes (a manifest, not prose). — DONE 2026-11-26: lib/scaffold.js (both systems, parseManifest with path/size/secret validation, verdictOf reuses FITNESS SCORE/VERDICT), scaffold:call IPC + site/pv.js web path, REVISE → one revision pass with the reviewer text (tested in test/scaffold.test.js + tests/scaffold-ui.test.js).
- [x] **Depth semantics — predictable, not "the model decides":**
  - cycle 1 — create folder; write structure + config + `PROMPT.md` (approved prompt) + `todo.md` (handoff).
  - cycle 2 — fill stub files / entry points / data models (still skeleton, opens clean).
  - cycle 3 — real head-start: implement the first milestone end-to-end. (Cap at the slider max already used.)
  — DONE 2026-11-26: `cycleGoal()` encodes exactly this, cycles = the rounds slider clamped 1..8, the depth is stated in the model-facing content, and PROMPT.md + todo.md are injected deterministically regardless of the model's whim.
- [x] **The `todo.md` handoff** is the deliverable: the scaffold writes a project `todo.md` (milestones, files to create, the volley's constraints) so the *next* agent (Hermes / Claude Code / Cursor) picks up cold. Mirror the shape of this very file. — DONE 2026-11-26: `buildTodoMd()` (milestone checkboxes, constraint extraction, created-file list, install notes) is always written as todo.md; covered by test/scaffold.test.js.
- [x] **Filesystem constraint:**
  - *Desktop:* write to a user-picked folder (`dialog.showOpenDialog` — Electron has it). ✅ scaffold:pickDir + scaffold:write (re-validates paths, refuses to write outside the folder).
  - *Web:* Chromium **File System Access API** (`showDirectoryPicker` mode:'readwrite') ✅ in site/pv.js; else produce a **`.zip`** download of the manifest ✅ DONE 2026-11-26 — dependency-free store-only zip writer (lib/zip.js; verified structurally AND with python zipfile.testzip), the preview's confirm becomes "⬇ Download .zip" when no folder picker exists, and the desktop has the same export (writes volleyprompt-scaffold.zip to Downloads + reveals it).
- [x] **Guardrails:** write *nothing* until the user picks a destination; preview ("about to create 14 files in `X`") with Confirm; never overwrite a non-empty dir without an explicit merge prompt. — DONE 2026-11-26: preview modal locked until a destination is picked; non-empty folder → askConfirm "Merge into it?" before overwrite:true; server/transport-side path re-validation and out-of-folder refusal. Tested in tests/scaffold-ui.test.js.
- [!] Acceptance: an approved prompt → a folder that opens in an IDE with `PROMPT.md`, `todo.md`, and (per cycle count) working stubs, produced by the same two models, no manual copy-paste. — the FULL loop is verified offline (jsdom: fake model replies drive the real renderer loop, preview, guardrails and write contract; 103 unit tests green), but the LIVE end-to-end pass makes real billed model calls with the user's OpenRouter key — owner-gated spend, same gate as the smoke-test item below.

---

## Suggested build order (cheapest unlock first)
1. **A1** unified frontend — every later step gets cheaper once the fork is gone.
2. **B1** deep-link "Send to" — hours, immediate payoff, no backend.
3. **A2 + A3 + A4** pairing-secret sync over Cloudflare Functions + KV — the thing you asked for.
4. **B2** Scaffold mode (desktop first) — the flagship "it starts the project" feature.
5. **A5** Google login — only when accounts/recovery are wanted; reuses the A4 table.
6. **B2-web** scaffold via File System Access API / zip / synced-profile.

---

## Open questions (need you to pick)
- ~~Backend~~ → **decided: Cloudflare Pages Functions + KV/R2** (see A2; Supabase ruled out 2026-11-01).
- ~~Pairing code format~~ → **decided: URL-safe base64 + QR/copy-paste-first** (see A3).
- ~~"Send to Hermes"~~ → **decided: direct to Hermes, NOT through Discord** — local `/v1/runs` API or a detached `hermes chat -q` spawn (see B1).
- Web Scaffold at launch: **desktop-only first** (recommended) or must the site scaffold from day one (needs File System Access API / zip)? ← **only one left**

---

## Where we already are (carried from the previous TODO)

**Status**
- App built (main.js / preload.js / renderer/); icon from `build/icon.svg`.
- Landing site deployed → https://volley-prompt.pages.dev (download button, GitHub link, OG/Twitter `site/assets/og-image.png`). Redeploy: `npm run site:deploy`.
- Repo **public** (confirmed 2026-10-30): https://github.com/Chimthuwu/Volley-Prompt — `latest/download/` links work anonymously. *(Old open question "GitHub username/repo for the download link?" → answered.)*
- Phases 1–6 done: big composer; image/text/folder attachments wired into real OpenRouter multimodal requests (both Writer & Reviewer, persisted across rounds); collapsible sidebar; speech-to-text dictation; titlebar settings/theme controls; Project Context Explorer (tri-state checkbox tree, lazy-rendered).
- Desktop shortcut → `dist\win-unpacked\VolleyPrompt.exe`. **Run `npm run dist` after every source change** or the shortcut goes stale (bit twice).
- [x] CI workflow builds installer (`VolleyPrompt - Windows Setup v<ver>.exe`); Mac/Linux builds.

**In flight / later**
- [!] Deploy site: `npx wrangler login` then `npm run site:deploy` (needs wrangler auth + outward deploy).
- [!] Smoke-test the app with a real OpenRouter key: vision accept/reject, reviewer-context, folder attachments all still want a live-key pass.
- Later: Markdown rendering in panels, custom rubric editor, run-history browser.
- Done earlier: editable final prompt, per-panel copy, round progress bar, Ctrl+Enter, re-run with tweaked idea, single-instance lock, auto-retry on 429/5xx/network.

**Overnight / `/sesh` ideas (from old inbox, still valid):** headless mode (`--headless`, log to `nitesesh/`); pre-build `dist/` before overnight runs; `.env` dark theme for overnight.
- [x] BUG (fixed): **`main.js` has the hard idle-stall timeout** — `IDLE_MS = 30000` aborts a stream that sends no bytes for 30 s (120 s for vision calls) and retries per the 429/5xx policy, so a missing/stalled OpenRouter response can no longer hang a volley. Verified in code 2026-11-26.

**Note:** a Hermes **`/volley`** Discord plugin now exists (`~/.hermes/plugins/volley-prompt`) — it reuses this app's exact Writer/Reviewer systems, presets, folder/GitHub filters and OpenRouter key, so "Send to Hermes" (B1) has a target today.

---

## Decisions made (review me)

- 2026-11-26 (round 2) — **D1 (SQL database for history) not needed**: sync is whole-blob reads merged per-section client-side; no server-side query use case exists until run history itself syncs. Chose "no D1" over adding one speculatively. Checkpoint: d1-not-needed commit (see git log).
- 2026-11-26 (round 2) — **QR display for the pairing code stays deferred in the Inbox**: a from-scratch QR encoder is error-prone and vendoring a third-party encoder is a dependency choice the owner should review; copy/paste-first already works on both ends. Checkpoint: same commit as above.

- 2026-11-26 — DO_FIRST_NOW.md user bugs worked before workstream A/B; B1 "Send to ▸" done before A1 unification. Why: the bugs and B1 are small, testable wins (both e2e suites cover them); A1 is a large refactor with public-site regression risk, better started fresh with the full run ahead of it. B1 was marked "do first — hours, immediate payoff" in the todo itself.
- 2026-11-26 — "Send to ▸ Hermes" shipped as the CLI spawn path (`hermes chat -q <prompt>`), not the `/v1/runs` API. Why: the API needs a token + api_server enablement the app can't assume; the CLI path needs nothing. Checkpoint: none needed (no open design question) — see commit 828b5e5. Refinement (store the gateway token, poll /v1/runs in the result panel) belongs with A2/A3.
- 2026-11-26 — "Cline" opens vscode:// (no cline:// scheme verified): prompt goes to the clipboard and the label says "paste it into the Cline extension". If Cline ships a real deep link, swap it in SEND_TARGETS.

## Inbox (agent-proposed)

- [ ] **README: document test + rebuild workflow** [P2] [docs] [size:S]
  Why: "Run npm run dist after every source change or the shortcut goes stale (bit twice)" lives only in this todo; README doesn't mention `npm test` / `npm run test:e2e` at all.
  Done when: README has a short "Developing" section: test, e2e, dist, site:deploy, and the Windows icon-cache caveat after rebuilds.
  Hints: note that the desktop shortcut targets dist/win-unpacked/VolleyPrompt.exe.
- [ ] **Keyboard access for context + send menus** [P2] [accessibility] [size:S]
  Why: #contextMenu and #sendMenu items are divs; keyboard users can't open or navigate them (the sidebar itself has F2/Del/Enter, so the gap is the two menus).
  Done when: items are focusable (button/role=menuitem) and Enter/Escape open/close both menus.
  Hints: .menu-item styles apply unchanged to <button>; keep the delegated click handlers.
- [ ] **Debounce sidebar search re-render** [P3] [performance] [size:S]
  Why: loadHistory() rebuilds the whole #history DOM on every keystroke of #historySearch (renderer/app.js historySearch input handler).
  Done when: input is debounced ~150 ms (or filtering mutates in place) with no behavior change; e2e still green.
  Hints: list caching already exists in lib/runs-store.js; this is purely renderer-side.
- [ ] **Smoke-test the web run flow after A1 unification** [P1] [tests] [size:M]
  Why: e2e-history-web covers rename/move/delete only; the OpenRouter streaming run path on the site has no automated coverage, and A1 will swap site/app.js for the renderer file.
  Done when: a scripted check runs a volley against a mock/echo server (or records a fixture) asserting round-snapshot events render; wire into test:e2e:web.
  Hints: site/pv.js stream() is the seam to stub; DO NOT hit real OpenRouter from tests.
- [ ] **Variant/utility caps: single shared constant** [P3] [code audit] [size:S]
  Why: the 100000 instruction cap now exists in four places (2x index.html maxlength, renderer/app.js, main.js, site/app.js, site/pv.js utility validator) — they drifted once already (10000 vs 800).
  Done when: one constant exported from lib/ (or validated once in main.js/pv.js) and the HTML maxlengths reference the same number via a build/test assertion.
  Hints: an ipc-contract style test comparing the caps across files would prevent drift without a build step.
