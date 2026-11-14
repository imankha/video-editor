# T16120: Judge the seven PR #746 criteria the reviewer never saw

**Status:** WIP
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-12

## In plain words

**Today.** PR #746 (T16040, T16050, T16060) merged on 2026-11-12. It made Frame show a message instead of spinning when it has nothing to load, made loading screens log what they wait for, and tagged failures from a waking staging server.

**The problem and how we got here.** /dotask's reviewer judged only the first acceptance criterion of each task. The task files keep their criteria under `### Acceptance criteria`, and the harness only counted `## Acceptance` headings, so it believed each task had one criterion (fixed in 67757b863). The worker did write a check for every criterion, and CI ran the code checks, so each passed its own test. What nobody did is the reviewer's job: read each check against its criterion and confirm it really proves it. One check (T16040:C3) also ran on staging and passed.

**What we will do.** Read each of the seven checks below against its criterion, the way the /dotask reviewer does, and fix any that assert less than the criterion says. Also settle a possible clash: T16050:C4 wants its logs in the staging build, while T16060:C3 says production builds never print its note. Staging is a production-mode build, so the two may need different gates.

**Why this and not something else.** The code shipped and its tests pass, so this is a check of the checks, not a rewrite. Doing it now, while the code is fresh, is cheaper than finding a weak check when the feature breaks.

**How we will know it worked.** Each of the seven criteria has a check that would fail on code that does not do what the criterion says, or a new task records the gap.

## The seven criteria and their checks

- T16040:C2 (Frame's "nothing to show" message and its `console.error`): `src/modes/FocusModeView.loadingState.test.jsx`
- T16040:C3 (Annotate highlight opens Frame with video within 10 s): `e2e/checks/T16040.check.spec.js` (passed on staging 2026-11-12)
- T16050:C2 (warning after 10 s naming what is outstanding): `src/utils/loadTrace.test.js -t C2`
- T16050:C3 (error naming the empty input): see `e2e/checks/T16050.checks.json`
- T16050:C4 (lines appear in the staging production-mode build): see `e2e/checks/T16050.checks.json`
- T16060:C2 (no note on a warm backend): `coldBackendTracker.test.js` / `apiFetch.test.js -t C2`
- T16060:C3 (production builds never print the note): same files, `-t C3`

All paths are under `src/frontend/`.

## Verdicts (2026-11-14)

Each check was read against its criterion. `e2e/checks/T16120.mutants.sh` (the C1 check) reruns every one on master's code with this branch's tests, then applies each broken copy named below and requires the named test to fail on it. Run with the pre-T16120 tests it fails (T16040:C2 has no test, the T16050:C4 grep misses `console.log`).

- **T16040:C2: strengthened.** The view test only proved that `FocusModeView` shows the message when handed `stuckEmpty=true`. Nothing tested that Frame decides it is stuck, or the `console.error` naming the project id and the missing input. Added two `T16040:C2` tests to `src/screens/__tests__/focusScreenClipsFetchRetry.test.jsx`: empty clips gives `missing=clips`, and a clip with no video URL gives `missing=videoUrl`. Both check `project=4` and that `stuckEmpty` reaches the view. They fail on a copy whose error names neither. The check command now runs both files.
- **T16040:C3: strengthened.** The check allowed 20 s to navigate plus 10 s for the video, so a 25 s open passed a "within 10 s" criterion. It now times one 10 s budget from the click to a loaded video. The first local run (2026-11-14 00:15) never reached that assertion (no highlight row in Annotate); a rerun on the same dev stack later that day passed (`qa/green-T16040-C3-browser.log`), so the tighter budget holds on dev; the post-merge staging run checks it again.
- **T16050:C2: strengthened.** The test advanced 10 s and expected one warning, so a warning at 1 s also passed. It now checks no warning at 9,999 ms, one at 10,000 ms, and still only one at 40 s. It fails on a copy that warns after 1 s.
- **T16050:C3: adequate.** It fails on a copy whose Frame settles empty plays without naming them.
- **T16050:C4: strengthened.** The grep only looked at `vite.config.js`'s `pure` list, so moving the `[LOAD]` lines to `console.log` (which production strips) passed. It now also rejects `console.log(`/`console.debug(` in `src/utils/loadTrace.js` and any `drop:` of `console`. It fails on a copy whose waiting line uses `console.log`.
- **T16060:C2 and T16060:C3: adequate.** Removing the cold-window gate fails all three C2 tests. Forcing `IS_PRODUCTION_BACKEND` false fails both C3 tests.

## T16050:C4 and T16060:C3: do they conflict?

No. They gate on different things.

- **T16050 `[LOAD]` lines** gate on the console method. `src/utils/loadTrace.js` uses only `console.info/warn/error`. The production-mode build (`vite.config.js` `esbuild.pure`, set when `NODE_ENV=production`) strips only `console.log`. So the lines appear in every build, staging and production alike.
- **T16060 cold-backend note** gates on the backend URL baked in at build time, not on build mode: `IS_PRODUCTION_BACKEND = API_BASE === 'https://reel-ballers-api.fly.dev'` in `src/utils/coldBackendTracker.js`. Staging builds with `VITE_API_BASE=https://reel-ballers-api-staging.fly.dev` (`.github/workflows/deploy-frontend.yml`), so staging prints the note. Production builds with the production URL (`scripts/deploy_production.sh`), so production never prints it.
- So "production builds" in T16060:C3 means the build deployed to production, not any production-mode build. Staging shows both lines; production shows the `[LOAD]` lines and never the note. Nothing to fix. One trap: if production ever moves to a different API URL (a custom domain), the note's gate breaks silently. `PRODUCTION_API_BASE` would need to follow it.

## Implementer details

### Acceptance criteria
- [x] C1: Each of the seven checks is read against its criterion text; any that would pass on broken code is strengthened in place, with the strengthened test shown failing on a deliberately broken copy and passing on master.
- [x] C2: The T16050:C4 / T16060:C3 production-build question is answered in this file (what each gates on, and whether staging shows each line), and fixed if they conflict.

### Related tasks
T16040, T16050, T16060 (PR #746), T16090.
