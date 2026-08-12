# Session handoff — 2026-08-12

**master @ `c0ca09b4`.** Read this before doing anything else in a fresh session — it is fully
self-contained. Everything from the Deploy Candidate milestone landed except one branch
awaiting merge and one still-TODO task; the ACTIVE blocker is a real backend bug found while
investigating a UI report, described in full below.

## Deploy Candidate milestone — status

All merged to master today except:
- **T6900** ([task file](tasks/T6900-draft-tile-source-aspect-until-framed.md)) — branch
  `feature/T6900-draft-tile-source-aspect` is **pushed, CI green, NOT YET MERGED** (user asked
  to verify READY/IN_OVERLAY stay at target aspect; worker added 4 explicit regression tests
  for that; user has not yet said "merge"). Container `reel-task-t6900` still up. Merge when
  the user says so, same flow as the others today (checkout master, `git merge --no-ff
  origin/feature/T6900-draft-tile-source-aspect`, update PLAN.md status to STAGING, push).
- **T6890** ([task file](tasks/T6890-rename-icon-placement-standard.md)) — filed, still `TODO`,
  not started. Not urgent, no blocker.

T6860, T6830, T6840, T6850, T6870, T6880 all merged and STAGING. T6860 in particular went
through 4 real rounds of live-repro-driven fixes (R2 transfer-client bug on Fly, a
multi-machine facts-staleness bug) before landing — see its task file's Progress Log if you
need that history, it does not need re-litigating.

## ACTIVE ISSUE — imankh@gmail.com's dev account looks blank after a prod->dev data refresh

### What happened, in order
1. User reported two old "Ready" reel tiles rendering landscape when they expected portrait
   (unrelated aspect-ratio question, separate from T6900 — those two specific reels,
   "Brilliant Control - From Air. Test Intro Image" and "Brilliant Pass", trace back to a
   2026-07-16/17 manual test session per the T5260 bug report that also references that
   rename). To find out whether that's stale local dev data or a real stored-value bug, the
   user asked to delete imankh@gmail.com's local dev data and re-pull fresh from production.
2. Stopped the local dev backend (there was significant back-and-forth here — the process on
   port 8000 was hard to pin down: `netstat`/`Get-NetTCPConnection` kept attributing it to PID
   `16680`, which `Get-Process` said didn't exist; no Docker container, WSL Ubuntu distro, or
   docker-desktop distro had a matching listener either. User said it's Docker/WSL-based but
   we never found the actual owning process. **If you hit this again, that mismatch (netstat
   shows a PID that doesn't exist in Get-Process) is worth understanding on its own — possibly
   a WSL2/vpnkit NAT artifact, not necessarily a real leak.**
3. Ran the established tool for exactly this (`scripts/copy_user_between_envs.py`, see
   [reference_copy_account_script] memory / the script's own docstring):
   ```
   fly proxy 15433:5432 --app reel-ballers-db-prod   # (backgrounded, stopped after)
   cd src/backend && .venv/Scripts/python.exe ../../scripts/copy_user_between_envs.py \
       --email imankh@gmail.com --from production --to dev
   ```
   **This succeeded and self-verified clean**: user_id `3ed03fb5-949d-4cfd-b708-0c758ea68ef3`,
   254 R2 objects copied production/ -> dev/, Postgres rows copied (users, user_segments,
   60 user_actions, 69 credit_transactions), `[VERIFY]` and `[VERIFY-REFS]` both passed (0
   dangling media refs). Full log was `/tmp/copy-real.log` in that session's scratchpad (not
   guaranteed to still exist — rerun with `--dry-run` first if you need to re-see it).
4. Deleted the local cache to force a fresh pull: `rm -rf
   ./user_data/3ed03fb5-949d-4cfd-b708-0c758ea68ef3` (repo root). This also removed a
   THIRD local-only profile, `fbea87da`, that was never in production.
5. User restarted the dev backend (some process now listening on :8000 again, still not
   definitively identified — same caveat as step 2).
6. **User reports the account now looks blank in the UI.**

### Root cause — found, precise, NOT yet fixed

**The per-profile data restored correctly. The user-level profile LIST did not.**

Direct SQLite inspection (`src/backend/.venv/Scripts/python.exe`, sqlite3 stdlib) after the
restart:

```
user_data/3ed03fb5-949d-4cfd-b708-0c758ea68ef3/
  profiles/9fa7378c/profile.sqlite   -> games:6 projects:47 final_videos:48 game_storage:6  REAL DATA, correct
  profiles/b95eb93b/profile.sqlite   -> games:0 projects:0  final_videos:0  game_storage:0   real prod profile, genuinely empty
  profiles/510b2c07/profile.sqlite   -> games:0 projects:0  final_videos:0  game_storage:0   NOT a prod profile — see below
  user.sqlite  -> profiles table has EXACTLY ONE ROW:
      {'id': '510b2c07', 'name': '', 'color': '#6366f1', 'sport': 'soccer',
       'is_default': 1, 'created_at': '2026-08-12 05:32:31'}   <- created at restart time
    user_settings: {'key': 'selected_profile', 'value': '510b2c07'}
```

So: the per-profile `profile.sqlite` files for `9fa7378c` (the real, populated profile) and
`b95eb93b` DID restore from R2 correctly (their data matches what `copy_user_between_envs.py`
verified was mirrored). But `user.sqlite` — the file that holds the profile LIST and the
`selected_profile` pointer the frontend reads — did NOT restore the real copy from R2. Instead
a brand-new `user.sqlite` was created locally with a single freshly-generated blank default
profile (`510b2c07`, `created_at` matching the restart), and `selected_profile` points at that
empty profile. **The account is not actually blank — the UI is just looking at the wrong
(freshly-invented, empty) profile instead of `9fa7378c`, which has all 47 real projects.**

The R2 copy's own `[VERIFY]` step already proved a real `user.sqlite` exists in R2 at
`dev/users/3ed03fb5-949d-4cfd-b708-0c758ea68ef3/user.sqlite`, db-version `626` — this is not a
copy failure, it's a **local restore-on-first-access bug**: something in the bootstrap path
didn't pull that file down and instead treated this as a brand-new user.

### Where to look

`src/backend/app/services/user_db.py:122-217`, `ensure_user_database(user_id)`. Read the whole
function — the docstring says "On first access, attempts R2 restore with NOT_FOUND vs ERROR
distinction," and the logic branches on `get_local_user_db_version(user_id)` (imported from
`app.database`) before deciding whether to call `sync_user_db_from_r2_if_newer`. Candidates,
in the order I'd check them:

1. **`get_local_user_db_version` returning non-None when it shouldn't.** The function early-
   returns "genuinely new user, starts fresh" (line ~188-194) when `sync_user_db_from_r2_if_newer`
   reports NOT_FOUND — but NOT_FOUND should be impossible here since R2 definitely has the
   object (verified). So either (a) this branch fired incorrectly (a real NOT_FOUND
   misdetection — check `sync_user_db_from_r2_if_newer` in `app/storage.py` for how it
   distinguishes NOT_FOUND from ERROR, especially around the just-completed R2 copy — is there
   a propagation delay, wrong bucket, wrong prefix?), or (b) `get_local_user_db_version`
   returned something OTHER than `None` on a fresh process (skipping the R2 check entirely) —
   check that function in `app/database.py`.
2. **The in-memory `_initialized_user_dbs` cache** (module-level set in `user_db.py`) — is it
   possible this process never actually restarted cleanly (the port-8000 PID confusion from
   step 2/5 above is suspicious), so a STALE in-memory entry for this user_id survived across
   what looked like a restart, causing `ensure_user_database` to skip the R2-restore branch on
   the (incorrect) assumption it already ran? The function's own comment block acknowledges
   this exact risk category (`schedule_user_db_reheal`'s docstring: "ensure_user_database
   early-returns on `_initialized_user_dbs` membership BEFORE it ever checks the version").
   Given step 2/5's unresolved process-identity mystery, this is a real candidate — confirm
   whether the "restart" actually replaced the process or not.
3. **Timing/race with the copy script itself** — the copy ran, then the local dir was deleted,
   then (at some later point) the backend was told to restart. If the backend's restart
   happened to overlap with anything cache-related from BEFORE the copy (e.g. it had already
   locked in `_initialized_user_dbs` for this user_id during earlier testing this session,
   before the copy ran), see #2.

### How to fix it right now (unblock the user first, root-cause after)

Cheapest unblock: manually pull the real `user.sqlite` down from R2 (bypass the buggy
bootstrap) — e.g. via `scripts/edit-user-db.py` or a one-off boto3 download of
`dev/users/3ed03fb5-949d-4cfd-b708-0c758ea68ef3/user.sqlite` from bucket `reel-ballers-users`
into `user_data/3ed03fb5-949d-4cfd-b708-0c758ea68ef3/user.sqlite` (backend must be stopped
first — same WAL-safety rule as before). Confirm `profiles` table then has `9fa7378c` +
`b95eb93b` and `selected_profile` reads `9fa7378c` (or ask the user which they expect
selected) after the manual pull. **Do this before chasing the root cause if the user wants to
be unblocked quickly** — but don't skip root-causing afterward, since this bug means ANY
first-access restore on a fully-wiped local user could silently land the user on a blank
invented profile instead of their real one, on any environment.

### Unrelated finding, not a bug — for context so it's not re-investigated

`intro_cards` count is `0` in profile `9fa7378c` post-copy. This is expected, not a bug: the
Athlete Intro Card epic has never been deployed to production (confirmed earlier this session
— prod's last deploy predates the whole epic), so copying FROM production correctly yields
zero intro cards. Don't chase this.

### Original aspect-ratio question — still open, blocked on the above

Once the account is unblocked (real profile visible), re-check whether
"Brilliant Control - From Air. Test Intro Image" / "Brilliant Pass" still show landscape tiles
with vertical source video. `project.aspect_ratio` has exactly one writer (creation-time
default 16:9, or the Framing screen's explicit toggle at `POST
/clips/projects/{id}/aspect-ratio`, `clips.py:629-719`) and export trusts it blindly with no
cross-check against real video dimensions (`export/framing.py:389,504,590`) — so if these
reels are still landscape with the correct (now-real, not locally-stale) data, that confirms a
genuine stored-value issue worth a migration/backfill script rather than local staleness.
