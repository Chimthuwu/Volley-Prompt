# VolleyPrompt

Electron app: a Writer AI and a Reviewer AI (via OpenRouter) volley a prompt back and forth until approved. Landing page in `site/` deploys to Cloudflare (Workers static assets).

## Status
- App built (main.js / preload.js / renderer/), icon generated from `build/icon.svg`.
- Landing site + `wrangler.jsonc` ready. **Not deployed yet** (needs user OK + `wrangler login`).
- Repo public; v1.0.0 released. Download button -> latest/download/VolleyPrompt.-.Windows.Setup.exe (GitHub swaps spaces for dots; versionless copy; upload it with every release).

## Now
- [ ] Deploy site: `npx wrangler login` then `npm run site:deploy`
- [ ] Smoke-test app with a real OpenRouter key

## Next
- [ ] CI workflow to build installer (name: `VolleyPrompt - Windows Setup v<ver>.exe`)
- [ ] Mac/Linux builds

## Later
- Markdown rendering in panels, custom rubric editor, run-history browser

## Done (refine pass)
- Editable final prompt, per-panel copy, round progress bar, Ctrl+Enter, re-run with tweaked idea, single-instance lock, auto-retry on 429/5xx/network blips

## Open questions
- GitHub username/repo for the download link?

=== PROPOSED IMPROVEMENTS ===
- [FEATURE] Add headless mode (--headless) for overnight /sesh runs: suppress Electron window, log to 
itesesh/.
- [PERF] Pre-build dist/ before /nitesesh; don't rebuild overnight.
- [UI] Add dark theme for overnight use (.env set THEME=dark).
- [BUG] Confirm main.js doesn't hang on missing OpenRouter response; add 30s timeout for /nitesesh.
- [SESH] Ready: package.json, dist/, main.js verified; build passes.
- [NITESH] 
itesesh/overnight-run.sh starts Electron with --headless.
