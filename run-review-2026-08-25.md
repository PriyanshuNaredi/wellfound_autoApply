# Wellfound auto-apply — live run review (2026-08-25)

**Correction:** an earlier version of this file claimed 7 applications; that was wrong
(read a stale path, never verified). Real numbers below are taken from the runner log,
`applications.csv`, and `apply-state-wellfound.json`.

## Verified outcome (8:26 PM run)

Full location-fix cycle worked end-to-end in production:

```
8:26:18 blocked by location → attempting fix
8:26:19 navigating to /profile/edit to set location "Seattle"
8:26:34 ✓ profile location set to "Seattle, Washington"   (ProfileSavePrimaryLocation)
8:26:44 retrying Sobek AI after fix
8:26:49 ✅ APPLICATION CONFIRMED BY WELLFOUND
8:26:49 ==> 1/50 this run (1/50 today)                     (state file + CSV updated)
```

## Bugs found while monitoring, all fixed

| # | Bug | Root cause | Fix |
|---|-----|-----------|-----|
| 1 | Blocked jobs retried forever across restarts | localStorage in this Chrome profile **does not survive a relaunch** (verified: PERSISTENCE BROKEN probe) — and Wellfound wipes site storage on every load | runner owns `.wellfound-seen-<site>.json`; passes `seenHrefs` via `__APPLY_CONFIG`; script reports back with raw `AA_SEEN` / `AA_SEEN_REMOVE` console markers |
| 2 | Pending location fix lost on navigation | same localStorage wipe killed `__aaLocFix` mid-flow | same channel: `AA_LOC_FIX` marker → runner holds it → injected back as `__APPLY_CONFIG.locFix` → script consumes on /profile/edit → `AA_LOC_DONE` clears it |
| 3 | Confirmed application counted 0/50, no CSV row | runner `submittedRe` didn't match the script's actual confirmation text | regex now matches `APPLICATION CONFIRMED`, `submission assumed successful`, `application sent` |
| 4 | "Could not extract job location" on every block | extractor only knew labels from job PAGE ("Job Location"), feed cards/panels don't carry them; fetched-page variant differs ("Location Seattle Job type…") | extraction order now: live SPA overlay body (`Job Location Seattle Visa Sponsorship…`) → card text → panel text → fetched page; `trimCity` cuts at next section label and splits bullet separators |
| 5 | Injection used a seen-list snapshot from launch | `buildInjection()` was called once per run | now called per-injection so each embeds the current state |
| 6 | Title pollution ("Founding Software EngineerIn office") | cleanTitle didn't split `In office` | added `in[- ]?office` |
| 7 | Finished scans restarted every ~4 min | nothing told the runner the script had ended | script sets `window.__aaFinished = true` |

Also verified live earlier: profile-location edit recipe (clear ✕ button → type → keyboard Enter;
a plain option click does NOT save), Gemini radio picking, F-1 OPT select handling.

## Known limitations / future enhancements

1. **CSV row quality** — today's row logged mostly "unknown": the detail-scrape races the fast
   confirm path when the panel opens pre-filled. Scrape before clicking Send instead of after.
2. **Timezone-gated roles** — Lexi (Boston) demands Eastern Time; location change alone can't
   satisfy it. Such jobs will burn one of the 3 daily fix attempts. Consider parsing
   "Preferred timezones" and skipping mismatches without touching the profile.
3. **Profile left at last fixed city** — after this run the profile says Seattle, not Syracuse.
   Nice-to-have: restore the default location at end of run.
4. **Feed yield** — ~150+ cards scanned but only 2–3 pass title/experience filters; widening
   TITLE_KEYWORDS (e.g. "forward deployed", "founding engineer") would raise throughput.
5. **Success-overlay close** sometimes needs a second attempt ("still visible" then closes).

## Runtime artifacts

- `wellfound-run-live.log` — runner stdout (gitignored via *.log)
- `.wellfound-seen-wellfound.json` — cross-restart seen list (add to .gitignore)
- `apply-state-wellfound.json` — daily submit counter
