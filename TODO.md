# VolleyPrompt

Electron app: a Writer AI and a Reviewer AI (via OpenRouter) volley a prompt back and forth until approved. Landing page in `site/` deploys to Cloudflare (Workers static assets).

## Status
- App built (main.js / preload.js / renderer/), icon generated from `build/icon.svg`.
- Landing site + `wrangler.jsonc` ready. **Not deployed yet** (needs user OK + `wrangler login`).
- Repo is now **private** (was public v1.0.0). Download link via `latest/download/` won't work anonymously anymore — needs auth or the repo to go public again.
- Phases 1-5 done: big composer, image/text/folder attachments wired into real OpenRouter multimodal requests (both Writer & Reviewer, persisted across rounds), collapsible sidebar, speech-to-text dictation.
- Desktop shortcut points at `dist\win-unpacked\VolleyPrompt.exe` — **must run `npm run dist` after every source change** or the shortcut goes stale (bit us twice already).

## Now
- [!] Deploy site: `npx wrangler login` then `npm run site:deploy` (needs wrangler auth + outward deploy)
- [!] Smoke-test app with a real OpenRouter key (needs credential) — vision accept/reject, reviewer-context, folder attachments all still need a live-key pass
- [ ] In progress: titlebar settings cog (general settings) + a theme/paint icon opening a hue/sat/contrast slider dropdown

## Next
- [x] CI workflow to build installer (name: `VolleyPrompt - Windows Setup v<ver>.exe`)
- [x] Mac/Linux builds

## Later
- Markdown rendering in panels, custom rubric editor, run-history browser

## Done (refine pass)
- Editable final prompt, per-panel copy, round progress bar, Ctrl+Enter, re-run with tweaked idea, single-instance lock, auto-retry on 429/5xx/network blips

## Open questions
- GitHub username/repo for the download link?

=== PROPOSED IMPROVEMENTS ===
- [FEATURE] Add headless mode (--headless) for overnight /sesh runs: suppress Electron window, log to nitesesh/.
- [PERF] Pre-build dist/ before /nitesesh; don't rebuild overnight.
- [UI] Add dark theme for overnight use (.env set THEME=dark).
- [BUG] Confirm main.js doesn't hang on missing OpenRouter response; add 30s timeout for /nitesesh.
- [SESH] Ready: package.json, dist/, main.js verified; build passes.
- [NITESH] nitesesh/overnight-run.sh starts Electron with --headless.
