# VolleyPrompt

Electron app: a Writer AI and a Reviewer AI (via OpenRouter) volley a prompt back and forth until approved. Landing page in `site/` deploys to Cloudflare (Workers static assets).

## Status
- App built (main.js / preload.js / renderer/), icon generated from `build/icon.svg`.
- Landing site + `wrangler.jsonc` ready. **Not deployed yet** (needs user OK + `wrangler login`).
- Download button on site points at `github.com/Chimthuwu/volleyprompt/releases/latest` — placeholder until a repo exists.

## Now
- [ ] Deploy site: `npx wrangler login` then `npm run site:deploy`
- [ ] Smoke-test app with a real OpenRouter key

## Next
- [ ] Create GitHub repo, CI workflow to build installer (name: `VolleyPrompt - Windows Setup v<ver>.exe`) and fix download link
- [ ] Mac/Linux builds

## Later
- Markdown rendering in panels, custom rubric editor, run-history browser

## Done (refine pass)
- Editable final prompt, per-panel copy, round progress bar, Ctrl+Enter, re-run with tweaked idea, single-instance lock, auto-retry on 429/5xx/network blips

## Open questions
- GitHub username/repo for the download link?
