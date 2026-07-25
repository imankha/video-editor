# Write Correctness & Concurrency Epic

**Status:** TODO (lower priority — split from durability-sync 2026-07-24)
**Started:** -
**Completed:** -
**Source:** [Code quality audit 2026-07-03](../../audit-2026-07-03-code-quality.md) items B5, B6, B7, B8, C8, G1, G3

> **Split rationale (2026-07-24):** the original Durability & Sync Hardening epic bundled two
> different failure classes. The *silent-data-loss / whole-DB-clobber* class — which twice
> destroyed real prod data (arshia's profiles, then his credits + reels) and fires on the current
> single-server stack — was kept in [durability-sync](../durability-sync/EPIC.md) and pushed to
> the TOP of the roadmap. This epic holds the rest: real correctness and concurrency bugs, but
> none of them silently loses committed data across a machine cycle. They are worth doing, not
> urgent the way the clobber class is.

## Goal

Writes produce correct, canonical, atomically-ordered, conflict-safe data — and concurrent edits
surface a conflict instead of silently losing one side.

The distinction from the durability epic: those tasks stop a good write from being **destroyed**
after it committed. These tasks stop a write from being **wrong, non-canonical, mis-ordered, or
silently overwritten by a concurrent edit**. Different mechanism, lower blast radius (a wrong
render or a lost concurrent-tab edit, not a vanished balance or a reverted profile).

## Tasks

| ID | Task | Status | Class |
|----|------|--------|-------|
| T4330 | [Unified Action Client: Serialization + Versioning + 409](T4330-action-client-serialization-conflicts.md) | TODO | concurrency (two tabs/gestures race whole-blob RMW) |
| T4340 | [Canonicalize segments_data at Write Time](T4340-canonicalize-segments-at-write.md) | TODO | data format (dual format → inverted-clip / wrong-recap render) |
| T4350 | [Re-Export Must Re-Transform Carried-Forward Highlights](T4350-reexport-retransform-highlights.md) | TODO | transform correctness (highlights drift after re-time) |
| T4360 | [Explicit Orderings: BEGIN IMMEDIATE + Invariant Tests](T4360-explicit-orderings-invariants.md) | TODO | local atomicity / ordering (RMW atomicity is an accident; activation ordering) |

Order: **T4340 before T4350** (T4350 builds on canonical segments). T4330 and T4360 are
independent. T4360 is a prerequisite for T4640 (games-services extraction).

## Relationship to the durability epic

- **T4330** is the closest to the loss class (a concurrent-tab edit can be silently lost), but it
  requires two simultaneous editors — far lower frequency than the deploy/R2-error clobber, and
  the fix (409 + refresh UX) is a different mechanism than CAS/restore-if-newer. If concurrent
  editing becomes common, promote it back.
- **T4340 / T4350** are pure single-server *render*-correctness bugs that happened to live in a
  "sync" epic because the fix is at write time. They are not sync-durability at all.
- **T4360** hardens local transaction atomicity + activation ordering (bug26p class). Foundational
  cleanup; not the active-loss class.

## Completion Criteria

- [ ] Two concurrent tabs/gestures cannot silently lose an edit (409 + retry UX instead)
- [ ] `segments_data` has one on-disk format; readers don't defensively canonicalize
- [ ] Re-export never carries highlights verbatim across a timing change (transform or drop-and-notify)
- [ ] Action-endpoint RMW atomicity is explicit (BEGIN IMMEDIATE) with a race-detector test
- [ ] Backend import check + full backend tests green after each task
