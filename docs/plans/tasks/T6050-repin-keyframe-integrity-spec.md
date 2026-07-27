# T6050: Re-pin keyframe-integrity.spec.js to the current keyframe model

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-07-27
**Source:** `docs/testing/known-failures.md` — the last remaining real debt row in the baseline

## What is wrong

`keyframe-integrity.spec.js › all guards verified with a project in framing mode` fails on clean
master: `g1a_frame0` expected `0`, received `50`. Verified on a clean `master` checkout 2026-07-17
via `git show master:...`, so it is not branch drift.

**The spec is stale, not the app.** It encodes the T340-era expectation that RESTORE reconstitutes
a permanent frame-0 boundary keyframe from the nearest keyframe. The keyframe model has since
moved to a **flat list with NO permanent boundaries** (removed ~2026-06-21): any keyframe may be
deleted, an empty list means a centered crop, and trim boundaries are virtual.
`restoreKeyframes` / `removeBoundaryDuplicates` no longer manufacture a frame-0 entry, so the
guard asserts an invariant the system deliberately abandoned.

## Why it is worth a task, not a deletion

This spec is the *integrity guard* for a data model that has already produced two real corruption
incidents (T350 origin corruption from reactive persistence; the T-keyframe identity divergence
healed by profile_db v014). Deleting it removes the alarm. The job is to work out **what the
invariants actually are now** and pin those — which is genuinely harder than editing one number,
hence Complexity 3.

Do NOT simply change `0` to `50` to make it green. A guard rewritten to match whatever the code
currently emits guards nothing. Derive the intended invariants from the model, then assert them.

## What to do

1. Read `.claude/knowledge/keyframes-framing.md` FIRST — it is the domain doc and records the
   flat-list model. If it contradicts the code, the code wins and you fix the doc in the same commit.
2. Establish the current, intended invariants of the flat-list model. Candidates to consider (not a
   checklist — confirm each against the code and reject the ones that are not real):
   - a restored list round-trips exactly what was persisted (no manufactured entries)
   - no near-duplicate frames survive restore (the identity-divergence class, `resolveTargetFrame`)
   - an empty list renders a centered crop rather than throwing
   - deleting any single keyframe, including the first, is legal
3. Re-pin the spec to those. Where an old assertion encoded a retired invariant, say so explicitly
   rather than silently dropping it — same disposition discipline T5990 used.
4. Remove the row from `docs/testing/known-failures.md` once green, and check whether
   `branch-ci.yml` references it (it currently does not `--deselect` this one — confirm).

## Watch out for

- The spec self-skips on a deployed target (Vite-dev module import — see `helpers/targetEnv.js`).
  Run it locally with the dev stack up; a "pass" on staging means it skipped.
- Runtime fixups (`ensurePermanentKeyframes`-era code, origin normalization) are memory-only by
  design and MUST NOT trigger persistence (CLAUDE.md § Persistence: Gesture-Based, Never Reactive).
  If you find the spec passing only because a fixup wrote back, you have found a much bigger bug —
  stop and report it.

## Acceptance criteria

1. A written statement of the current invariants and, per old assertion, whether it was re-pinned
   or retired with the old model.
2. The spec green locally against the dev stack, run output shown.
3. `known-failures.md` row removed; the baseline note updated.
4. `.claude/knowledge/keyframes-framing.md` reflects the invariants the spec now guards.
