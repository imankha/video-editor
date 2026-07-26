# T5940: Split `routers/admin.py` (1880 LOC, ~10 domains) into cohesive sub-routers

**Status:** TODO
**Impact:** 5
**Complexity:** 5
**Created:** 2026-07-26
**Source:** Observed during the T5840 × T4315 merge conflict (2026-07-26) — "conflicts are often a sign of weak cohesion"

## Problem

`src/backend/app/routers/admin.py` is **1880 LOC, 34 endpoints, 47 module-level defs**, spanning
roughly ten unrelated domains:

| Cluster | Endpoints | Notes |
|---|---|---|
| Admin session / impersonation | `/me`, `/impersonate`, `/impersonate/stop` | 3 |
| User directory | `/users` | 1 endpoint, ~170 LOC |
| **Credits administration** | bulk grant, grant, set-credits | + the `_refresh_target_user_db` / `_persist_target_user_db` helpers |
| Revenue reconciliation | `/revenue-reconciliation`, `/heal` | T5760 |
| Bulk email | `/users/bulk/email` | 1 |
| Ops / maintenance | `/cleanup-shares`, `/migrate` | 2 |
| Backfills | hiq-recaps (GET+POST), share-posters (GET+POST) | 4 |
| **Analytics** | funnel, channels, cohorts, journey, user-actions, pulse, platforms | 7, **~700 LOC** — the largest cluster, with logic inline in the router |
| Referrals | leaderboard, by-channel, user, tree | 4 |
| Bug reports | list, get, correlated, update, purge, delete, screenshot | 7, ~310 LOC |

Plus T5840 adds three more (credits backfill report / apply / open-gate).

### Evidence this is Divergent Change, not just a big file

`git log -- routers/admin.py` → **50 commits from 25 distinct task ids**: T525, T550, T920, T990,
T1510, T1590, T2847, T2910, T2920, T3020, T3040, T3100, T3450, T3460, T3490, T3500, T4140, T4310,
T4315, T4860, T4870, T4890, T4970, T5660, T5760. A module that changes for twenty-five unrelated
reasons has no single responsibility.

**The frontend already found these seams.** `components/admin/` is split into `AnalyticsDashboard`,
`RevenueReconciliation`, `CreditGrantModal`, `UserTable`, `CohortGrid`, `FunnelChart`,
`PlatformBreakdown`, `PulseCards`, `ChannelsTable`, `BulkEmailModal`, `UserDetailPanel`. The backend
serving them is one file. That asymmetry is the clearest signal that the split boundaries are already
known and agreed — they just were never applied server-side.

**Analytics has no service layer.** ~700 LOC of query/aggregation logic lives inline in the router,
against the project convention that routers stay thin. There is no `services/analytics.py`.

### Honest scoping — what this does NOT fix

This refactor would **not** have prevented the T5840 × T4315 conflict that prompted it. Both tasks
edited the *credit-grant* code specifically; split into `admin_credits.py` they would still have
collided there. Do not justify this task on that basis.

What weak cohesion *did* cost in that merge was **blast radius and risk**: 4 conflicted files, and
critically `tests/test_persistence_risk_coverage.py`, which mixes middleware foreign-DB-sync tests
with admin `_refresh_target_user_db` tests. Resolving that file wholesale in either direction
silently drops the other task's work — a clean-looking merge that reverts a durability fix. **The
test-file split is the part with real safety value and should not be dropped from scope.**

## Solution direction (confirm at design)

Split into sub-routers under `src/backend/app/routers/admin/`, each mounted on the existing prefix so
**every URL is byte-identical** — this is code motion, not an API change.

Proposed units (confirm at design; each should land as its own mechanical commit):
1. `admin/session.py` — `/me`, impersonation
2. `admin/users.py` — directory + bulk email
3. `admin/credits.py` — grant / set / bulk-grant (+ T5840's backfill endpoints)
4. `admin/revenue.py` — reconciliation + heal
5. `admin/analytics.py` — the 7 analytics endpoints, **with the aggregation logic extracted to
   `services/analytics.py`** (the one place this is more than pure motion — sequence it as a separate
   commit AFTER the move)
6. `admin/referrals.py`
7. `admin/bugs.py`
8. `admin/ops.py` — cleanup-shares, migrate, backfills

Also split `tests/test_persistence_risk_coverage.py` along the same seam (middleware sync vs admin
user-db refresh) — see risk note above.

## Process constraints (CLAUDE.md § Refactoring Rules — these are binding)

1. **Characterization tests BEFORE any motion.** Pin current behavior first: every route's path,
   method, auth requirement, and response shape. A route-table snapshot test (iterate
   `app.routes`, assert the full set of paths+methods) is the cheapest high-value pin — it makes an
   accidentally dropped or renamed endpoint impossible to miss.
2. **Moves are mechanical commits.** Code motion NEVER mixes with behavior change in one commit. The
   analytics service extraction is behavior-adjacent and must be its own sequenced commit, after the
   move.
3. **Reviewable units < ~200 lines of meaningful diff.** This task is therefore a SEQUENCE — one
   sub-router per commit, each independently reviewable. Do not attempt a big-bang split.
4. **Greppability beats elegance.** No dynamic router registration / auto-discovery loops. Explicit
   `include_router` calls, explicit module names.
5. **Update CLAUDE.md / knowledge docs in the same PR** — `.claude/knowledge/backend-services.md`
   describes the router layout and must not be left stale.

## Sequencing with T4610

**T4610** ("`require_admin` as router-level `Depends`", ~25 imperative `_require_admin()` calls, one
forgotten = an open admin endpoint) targets this same file and is Impact 7 / Complexity 2.

**Do T4610 FIRST.** It is small, security-shaped, and its meta-test (iterating `router.routes` to
assert every handler is protected) becomes the safety net for this split — if a sub-router is mounted
without the dependency, that test fails. Doing the split first would mean applying T4610 eight times
instead of once, with no net to catch a miss.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` — the module to split
- `src/backend/app/main.py` — router registration
- `src/frontend/src/components/admin/` — the already-split UI; mirror its boundaries
- `src/backend/tests/test_persistence_risk_coverage.py` — split along the same seam
- `.claude/knowledge/backend-services.md` — router layout doc to update

### Related
- **T4610** — `require_admin` router dependency. **Do this first** (see Sequencing).
- **T5840** — adds 3 credits endpoints; land it before splitting to avoid re-conflicting
- **T5760** — revenue reconciliation cluster
- Audit: `docs/plans/audit-2026-07-03-code-quality.md` E6 (the `_require_admin` finding)

## Acceptance Criteria

- [ ] Every admin URL is byte-identical before and after — proven by a route-table snapshot test
      written BEFORE the motion
- [ ] Each sub-router lands as its own mechanical commit, < ~200 lines of meaningful diff
- [ ] No commit mixes code motion with behavior change; the analytics service extraction is a
      separate, later commit
- [ ] `tests/test_persistence_risk_coverage.py` split along the middleware-vs-admin seam
- [ ] Analytics aggregation logic moved out of the router into `services/analytics.py`
- [ ] No dynamic/auto-discovery router registration — explicit imports only
- [ ] `.claude/knowledge/backend-services.md` updated in the same PR
- [ ] Full backend suite green at every commit in the sequence, not just at the end
