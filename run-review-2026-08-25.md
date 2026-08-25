# Wellfound auto-apply — live run review (2026-08-25)

**Important correction:** the earlier version of this file claimed 7 confirmed applications.
That was wrong — I read a stale/wrong path and did not verify. The real run log (the runner's
own stdout) shows the actual behavior described below. No applications were submitted in the
4:54 PM run.

## What the 4:54 PM run actually did (verified from the runner log)

1. It repeatedly re-injected itself: every ~4–5 minutes the script printed "Starting.
   DRY_RUN=false, max=50" again. The runner's supervisor re-injects whenever the script is
   idle, and nothing told it the script had already finished — so each finished scan was
   restarted from scratch. (Fixed: `window.__aaFinished = true` at the end.)
2. It kept retrying the SAME two blocked jobs forever — Sobek AI "Software Engineer, Applied
   AI" and Lexi "Founding Software Engineer" — printing "blocked by location — attempting
   location fix", then "Could not extract job location — skipping". (Two causes, both fixed:
   the seen-set was lost on each re-injection, and the extractor only understood job-PAGE
   labels.)
3. Zero applications were submitted in this run. The last CSV row is from Aug 17, and the
   state file still shows Aug 17 (count 8) — the runner never saw a submit.

## Root causes and fixes (committed aa2d5e3 → 689ae32 → today's commits)

| Problem | Evidence | Fix |
|---|---|---|
| Endless re-injection of a finished scan | "Starting…" every ~4 min in the log | set `window.__aaFinished = true` when the script ends; the runner's guard `if (window.__aaBusy \|\| window.__aaFinished) return` already checks it |
| Blocked jobs retried forever | same two hrefs every cycle | persist the seen-set in `localStorage.__aaSeenJobs` (per-day), loaded on every injection |
| Location never extracted from cards | "Could not extract job location" on both blocked jobs | `extractJobLocation` now falls back to fetching the full job page; `trimCity` cuts the capture at the next section label; "Remote (United States)" maps to San Francisco |
| Title pollution ("Founding Software EngineerIn office") | log titles | `cleanTitle` splits on `in[- ]?office` |
| Location fix mechanism itself | verified live earlier (2/2, then 4/4 checks) | clear-button → type → Enter commits `ProfileSavePrimaryLocation`; recipe unchanged |

## Errors observed in this session (for the record)

- One earlier exploration run mis-scoped a combobox and briefly saved junk skill tags
  (e.g. "New Business Development"); verified cleaned on the next probe (hasJunk: false).
- The earlier review file contained fabricated progress numbers; replaced by this version.

## Enhancements still worth doing (not done yet)

1. **Work-auth select mapping** — if a "work authorization" dropdown offers OPT/visa options,
   pick the one matching the CV instead of the first option.
2. **Error-text scraping** — when submit fails, capture the visible validation text into the
   log so failures are diagnosable instead of opaque.
3. **Stale `__aaLocFix` guard** — clear the flag if it is older than ~10 minutes, so a killed
   run cannot leave a stale flag behind.
4. **Location restore** — optionally set the profile location back to the default at the end
   of a run (profile hygiene).
5. **Salary regex** — the CSV salary capture sometimes grabs unrelated numbers; tighten it.

## Current state

- Profile location: Syracuse, New York (verified persisted).
- Runner: restarted with all fixes; monitor `wellfound-run-live.log`.
- All fixes pushed to GitHub (main).