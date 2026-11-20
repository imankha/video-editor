# T18010: Staging check account has no play Frame can open

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-20
**Updated:** 2026-11-20

## In plain words

After every merge, /dotask runs each task's browser checks against staging, signed in as one shared test account (`e2e-gate@test.local`). A check that opens the Frame screen first looks for a play in that account whose highlight has not been sharpened yet. Frame is the step where a parent drags a box around their athlete and pays credits to sharpen it into a highlight.

Today that account has no such play Frame can open. On 2026-11-20 all nine browser checks of T17910 (Frame buttons read as steps) failed on staging with "no unsharpened play Frame can load among 2 unfinished projects", and nine bug tasks were filed (T17920 to T18000). The feature was fine: the same checks run as the third test account (`e2e-gate3@test.local`) passed C1 to C9. The account has three unfinished projects. One is already sharpened, and the other two ("Play 2", projects 9 and 10) belong to game 2, whose upload never finished. Frame refuses to load those (the playback link answers 409 `source_uploading`). Every staging check that needs a fresh play will keep failing this way and filing false bugs until the account is fixed.

We will give the account a set of plays Frame can open, and stop it from running out again. Either re-seed it from the dev fixture (the documented reset), or repair game 2 so its plays load. Then have checks that sharpen a play leave one behind or make their own, so one run cannot use up what the next run needs.

Why this and not something else: re-pointing the staging check at `e2e-gate3` would hide the problem, not fix it. That account already has three or more finished highlights, so the coach shows its "experienced" sentence and checks for new-parent coach steps (like T17910's C10, "Step 1 of 5") can never pass there.

We will know it worked when the T17910 browser checks, run against staging as `e2e-gate@test.local`, pass C1 to C9 without changing the account by hand first. They should still pass after a second run.

## Acceptance Criteria

- [ ] C1: Signed in on staging as `e2e-gate@test.local`, the projects list holds at least two unsharpened plays whose playback link answers 200 (none on a game stuck uploading).
- [ ] C2: `npx playwright test e2e/checks/T17910.check.spec.js` against staging as `e2e-gate@test.local` passes C1 to C9, and passes them again on a second run straight after.
- [ ] C3: C10 of the same file passes on staging, or the task records why the account cannot show new-parent coach steps and which account C10 should use instead.

## Implementer details

- Failing helper: `sharpenPlayPath` in `src/frontend/e2e/checks/T17910.check.spec.js` (needs a project with clips, `has_working_video` false and a playback-url that answers 200).
- Staging data probed 2026-11-20 (after the T17910 merge): project 48 "Play 6" is sharpened; projects 9 and 10 "Play 2" are on game 2, playback-url 409 `{"code": "source_uploading", "game_id": 2}`.
- Re-seed route: `src/frontend/e2e/STAGING-GATE.md` step 0 (stop the staging machine, seed from the dev fixture with `copy_user_between_envs.py --to-email e2e-gate@test.local`, start, migrate Postgres). It takes about 15 minutes with staging down, so it needs the owner's go-ahead.
- Account defaults: `loginForCheck` in `src/frontend/e2e/helpers/checkAuth.js`; the staging check's account comes from `E2E_CHECK_EMAIL` / `DOTASK_STAGING_EMAIL` (default `e2e-gate@test.local`) in `scripts/dotask_cli.py`.
- Closed false bugs from this cause: T17920, T17930, T17940, T17950, T17960, T17970, T17980, T17990, T18000 (see PLAN-archive.md).
