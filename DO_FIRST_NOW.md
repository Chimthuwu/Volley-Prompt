# DO FIRST NOW — user-reported bugs (2026-11)

Worker checklist — added 2026-11-26 (sesh AUTO) so progress can be ticked. Original bullets preserved below.

- [x] 1. Desktop icon reverted to generic Electron icon — diagnose + fix; rebuild + shortcut per standing rule.
  Done: exe + build/icon.ico carry the correct custom icon (verified by extraction); the generic icon was Explorer's icon cache going stale after rebuilds. Shortcut recreated with an explicit IconLocation so it re-resolves; if it still shows generic, an Explorer restart (or delete of %LOCALAPPDATA%/Microsoft/Windows/Explorer/iconcache_*.db) clears it.
- [x] 2. Volleys/projects in the sidebar: add Rename, Delete, and Move (change project) — currently impossible.
  Done: desktop already had them (hover buttons + right-click); the WEB build only had a hidden right-click — added the same visible hover buttons for volleys AND folder headings, plus fitness score in the item title.
- [x] 3. Variant instruction textarea character limit far too low — raise it (renderer + site forks).
  Done: 10000 (desktop) / 800 (web) -> 100000, at every cap (both HTML maxlenghts, renderer+main+web slices).
- [x] 4. "YOUR FINISHED PROMPT" fitness panel: show which models were used (writer/reviewer).
  Done: Models line now stays populated when scrubbing rounds (was only set on finish/history-load), styled slightly larger with a tooltip, invalid inline margin-left fixed on web, and sidebar item tooltips name the volley's model pair.

---

- why did the icon of it(on my desktop) revert to the generic electron icon?

-We cant rename or delete or move the volleys (or projects) in our side browser at all

- theres a character limit in the variant text field, its gotta be waaaay higher... 

- I cant see what models were used when i look at the "YOUR FINISHED PROMPT"  Fitneess thing 