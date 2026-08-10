# T4946: Access Control + Credits for Collection Download

**Status:** TODO — blocked on Decision 4 (credit model), see below
**Impact:** 6 | **Complexity:** 3 (before Decision 4 resolves — may change)
**Epic:** [Collection Download](EPIC.md)
**Follows:** [T4945](T4945-core-stitch-owner-download.md) — this task gates that endpoint's real
release; T4945 should not ship to production without this landing first or immediately after.

## Problem

The user's review of the original design (2026-08-10) widened who can download a collection
beyond the original "owner-cards-only" recommendation: **"Anyone with permissions to the clip
and who is signed in and has the credits can download."**

This bundles two previously-separate open questions from the design doc into one gate:
- **Who**: not strictly the owner — anyone with *permission* on the collection. Requires
  investigation: does the collection/sharing system have a collaborator-permission concept
  today beyond ownership, or does "permission" collapse to "owner" in current practice? If a
  real permission model doesn't exist yet, this task needs to define what "permission to the
  clip" means concretely before it can gate anything on it.
- **Cost**: sufficient credits — implies downloads DO cost credits, which contradicts the
  original recommendation (free) that the user's later "Addressed" answer seemed to accept. See
  **Decision 4 in [EPIC.md](EPIC.md) — NOT YET RESOLVED.** Do not start this task's
  implementation until a human confirms one of:
  1. Free (original rationale stands: no GPU cost, members already paid for individually at
     their own export) — in which case "has the credits" in the user's answer was describing a
     trivially-always-true check, not a real gate, and this task's credit half shrinks to
     "confirm sign-in" only.
  2. Charged — in which case this task needs: a credit amount, a reserve/confirm/refund flow
     (mirroring the existing pattern in `export_helpers.py`'s `create_export_job` family, e.g.
     `framing.py:446-478`), and a visible pre-commit affordance (the existing convention
     elsewhere in the app shows the cost on the action itself before the user commits, plus a
     toast on deduction — reuse that, don't invent a new pattern).

## Solution (shape, pending Decision 4)

1. Investigate the collection/sharing permission model — find or define what "has permission to
   the clip" means for a collection (owner vs. any profile that can currently view/play it vs.
   something else). Ground this in whatever the sharing system (`shares` table, Postgres) already
   expresses; do not invent a parallel permission concept if one already exists.
2. Wire the T4945 endpoint's auth check to that permission model + sign-in requirement.
3. If Decision 4 lands on "charged": add the credit reserve/confirm/refund ladder + the
   deduction affordance; if "free": skip the credit machinery entirely, this task becomes
   permission-check-only.
4. Tests: permitted user succeeds, unpermitted user is rejected (with a clear reason, not a bare
   403), signed-out is rejected, and — if charged — insufficient credits is rejected before any
   R2/ffmpeg work starts (fail fast, don't do the compute then discover the user can't pay).

## Context

### Relevant Files
- `src/backend/app/routers/collections.py` — where T4945's download endpoint lives; this task's
  auth/credit check wraps it
- Whatever module owns collection/share permission checks today — **audit before assuming**,
  don't guess the file
- `src/backend/app/routers/export/framing.py:446-478` — existing reserve/confirm/refund credit
  pattern, if Decision 4 lands on charged

### Related Tasks
- Depends on: [T4945](T4945-core-stitch-owner-download.md) (the endpoint this gates)
- Blocks a real release of: T4945 (that task should not ship to prod without this)
- Feeds: [T4947](T4947-cache-stitched-downloads.md) (cache hits need to know whether to skip a
  charge, which only makes sense once this task's credit model exists)

## Acceptance Criteria

- [ ] Decision 4 resolved by a human before implementation starts (do not guess)
- [ ] Access is gated on collection permission (investigated and defined, not assumed) + sign-in
- [ ] If charged: credit reserve/confirm/refund wired, visible deduction affordance, insufficient
      credits rejected before any compute work starts
- [ ] If free: permission + sign-in gate only, no credit machinery added
- [ ] Tests pass
