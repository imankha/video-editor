# T13931: R2 usage admin view (per-source daily Class A/B, cycle vs free tier)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-10-29
**Updated:** 2026-10-29

## Problem

T13930 counts every server-side R2 call by (day, env, source, op class, op) into per-machine
`analytics.sqlite` shards, but nothing reads them yet. Without a view, the counts only help by
downloading shards by hand.

## Solution

Unit 3 of [T13930-design.md](T13930-design.md) sec 4.4, as approved:
- `app/services/r2_usage_report.py` `load_merged_usage()`: per env in (dev, staging, production),
  `ListObjectsV2 {env}/analytics/shards/`, GET only shards whose ETag changed (in-process cache),
  `sqlite3.deserialize` in memory, sum across shards; 10 min TTL cache (shared with T13932).
- `GET /api/admin/r2-usage` (admin-only, thin route in `admin.py`): 30-day `daily`, top-10
  `today_top` by Class A, billing cycle anchored on day 18 (`R2_BILLING_CYCLE_START_DAY`) vs the
  1,000,000 Class A free tier with linear projection, shard freshness; a failed shard GET returns a
  partial result marked `unreadable`, never a silent full total.
- Frontend: `adminStore.fetchR2Usage()` on an explicit gesture (T10270 precedent, never on mount),
  presentational `R2UsagePanel.jsx` in a `CollapsibleSection`; highlight `untagged`/`unmatched`;
  flag shards older than 2h; state the coverage caveat ("server-side boto3 calls only").

## Context

- Parent: [T13930-r2-usage-attribution.md](T13930-r2-usage-attribution.md), design [T13930-design.md](T13930-design.md)
- Knowledge docs: `.claude/knowledge/backend-services.md`, `.claude/knowledge/persistence-sync.md`

## Acceptance Criteria

- [ ] Admin view shows per-source daily Class A/B for the last 30 days, merged across writers.
- [ ] Test: two prod shards + one staging shard merge per env/source; a 31-day-old row is excluded; non-admin gets 403.
- [ ] Panel test: renders rows, highlights `untagged`, shows cycle vs 1,000,000 and the caveat.
