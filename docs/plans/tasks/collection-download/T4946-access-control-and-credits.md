# T4946: Access Control for Collection Download

**Status:** DONE — deployed 2026-08-16 prod.
**Impact:** 6 | **Complexity:** 2 (dropped from 3 — no credit machinery, permission check only)
**Epic:** [Collection Download](EPIC.md)
**Follows:** [T4945](T4945-core-stitch-owner-download.md) — this task gates that endpoint's real
release; T4945 should not ship to production without this landing first or immediately after.

## Problem

The user's review of the original design (2026-08-10) widened who can download a collection
beyond the original "owner-cards-only" recommendation: **"Anyone with permissions to the clip
and who is signed in ... can download."**

**Decision 4 (free vs. charged) resolved 2026-08-14: free.** A margin model built from
confirmed codebase pricing (credit packs, 1 credit/sec exports) plus the actual compute shape
of a collection download (CPU-only Modal stitch, zero R2 egress fees) showed a user downloading
every collection they have costs the business well under 1 percentage point of margin against
the export that already earned the credits — GPU compute on the original export dominates, not
the free re-download. See [EPIC.md](EPIC.md) Decision 4 for the full resolution.

That leaves ONE open question for this task:
- **Who**: not strictly the owner — anyone with *permission* on the collection. Requires
  investigation: does the collection/sharing system have a collaborator-permission concept
  today beyond ownership, or does "permission" collapse to "owner" in current practice? If a
  real permission model doesn't exist yet, this task needs to define what "permission to the
  clip" means concretely before it can gate anything on it.

## Solution

1. Investigate the collection/sharing permission model — find or define what "has permission to
   the clip" means for a collection (owner vs. any profile that can currently view/play it vs.
   something else). Ground this in whatever the sharing system (`shares` table, Postgres) already
   expresses; do not invent a parallel permission concept if one already exists.
2. Wire the T4945 endpoint's auth check to that permission model + sign-in requirement. No credit
   check — downloads are free (Decision 4).
3. Tests: permitted user succeeds, unpermitted user is rejected (with a clear reason, not a bare
   403), signed-out is rejected.

## Context

### Relevant Files
- `src/backend/app/routers/collections.py` — where T4945's download endpoint lives; this task's
  auth check wraps it
- Whatever module owns collection/share permission checks today — **audit before assuming**,
  don't guess the file

### Related Tasks
- Depends on: [T4945](T4945-core-stitch-owner-download.md) (the endpoint this gates, STAGING)
- Blocks a real release of: T4945 (that task should not ship to prod without this)
- Feeds: [T4947](T4947-cache-stitched-downloads.md) (the cache-hit "skip the charge" half of
  that task is now moot — free downloads are never charged in the first place)

## Acceptance Criteria

- [x] Decision 4 resolved 2026-08-14: free (margin analysis, see EPIC.md)
- [ ] Access is gated on collection permission (investigated and defined, not assumed) + sign-in
- [ ] No credit machinery added — free, permission + sign-in gate only
- [ ] Tests pass
