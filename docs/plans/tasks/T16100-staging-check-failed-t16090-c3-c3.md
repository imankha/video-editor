# T16100: T16090's browser check cannot run on staging

**Status:** WIP
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-12
**Updated:** 2026-11-12

## In plain words

**Today.** T16090 (PR #747, merged 2026-11-12) makes deleting a reel delete its highlight, so Annotate stops offering a highlight that would open Frame on an endless "Loading...". Its browser check (T16090:C3) passed on the dev stack, but failed in the staging check that runs after merge.

**The problem and how we got here.** The check never reached the feature. To get a published highlight quickly, it calls `POST /api/test/seed-published-highlight`, a test-only endpoint that exists only on dev stacks and returns 404 on staging and production by design (`src/backend/app/routers/test_seams.py`). So the staging check failed at setup, and staging has not yet shown whether the feature works there. The /dotask kickoff already says browser checks must run unchanged on the dev stack and staging (`loginForCheck`), and the reviewer did not flag the test endpoint.

**What we will do.**
1. Rewrite `src/frontend/e2e/checks/T16090.check.spec.js` so it sets up the highlight the way a parent does: mark a play, make a highlight, publish it ("Move to My Reels"), then delete the reel and check Annotate. Use only routes that exist on staging.
2. Run it against staging (`E2E_BASE_URL=https://reel-ballers-staging.pages.dev E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api E2E_CHECK_EMAIL=e2e-gate@test.local`).
3. Make the harness catch this class: a browser check that calls `/api/test/` cannot pass on staging, so the preland check (`scripts/dotask_preland_check.sh`) or the reviewer should refuse it.

**How we will know it worked.** The rewritten T16090:C3 check passes on staging, and a browser check that calls `/api/test/` is refused before landing.

## Evidence

- Staging check log: `C:\work\tasks\profiles\g-t16090-1\staging-check.log`; result `0 of 1 browser checks passed on staging; failed T16090:C3`, error `seed-published-highlight -> 404`.
- The check calls the seam at `src/frontend/e2e/checks/T16090.check.spec.js` line ~49.

## Acceptance criteria

- [ ] C1: T16090:C3's check creates its published highlight without any `/api/test/` route and passes on staging.
- [ ] C2: A browser check under `src/frontend/e2e/checks/` that calls an `/api/test/` route is refused before landing, with a message naming the file.
