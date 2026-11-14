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

## Implementer details

### Acceptance criteria
- [ ] C1: Each of the seven checks is read against its criterion text; any that would pass on broken code is strengthened in place, with the strengthened test shown failing on a deliberately broken copy and passing on master.
- [ ] C2: The T16050:C4 / T16060:C3 production-build question is answered in this file (what each gates on, and whether staging shows each line), and fixed if they conflict.

### Related tasks
T16040, T16050, T16060 (PR #746), T16090.
