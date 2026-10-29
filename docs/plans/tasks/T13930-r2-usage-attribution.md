# T13930: Attribute R2 operations to app activity (source tags, analytics.sqlite, admin view, alert)

**Status:** WIP
**Impact:** 7
**Complexity:** 6
**Created:** 2026-10-29
**Updated:** 2026-10-29

## Problem

The 2026-10-29 Cloudflare billing alert (2.11M Class A ops in 12 days) took a manual
investigation to attribute: Cloudflare's billing only splits by bucket, and dev/staging/prod
share `reel-ballers-users`. The cause (expiry sweep hot loop, T13920) would have been obvious on
day one if every R2 call were counted by the app activity that issued it.

## Solution

**Tier L, design-gated (Architect writes `docs/plans/tasks/T13930-design.md`, user approves).**

1. **Source tag.** A ContextVar `r2_source` naming who issued the call:
   - request path: the matched route TEMPLATE (`PUT /api/clips/raw/{clip_id}`), never the raw
     path (no ids in keys), set in the request middleware;
   - background work: an explicit literal per loop/worker (`sweep`, `export_worker`,
     `poster_warmer`, `reconciliation_alert`, ...), set where each loop starts;
   - anything untagged counts as `untagged` and is itself a signal to fix.
2. **Count at the existing choke point.** The botocore event hook in `storage.py` (~line 200)
   already emits `[R2_CALL] client=<label> op=<op> status=<code>` for every call. Add
   `source=` to that line and increment an in-memory counter keyed by
   (date, env, source, op_class A|B|free, op). Op class mapping follows Cloudflare's R2 pricing
   (ListObjects, Put, Copy, multipart Create/UploadPart/Complete, ListParts, ListMultipartUploads =
   Class A; Get/Head = Class B; Delete/Abort = free).
3. **Store in `analytics.sqlite` (user decision 2026-10-29).** This store does not exist yet;
   build it per the 2026-08-20 analytics directive: flat SQLite, env-prefixed R2 key,
   single-writer, etag CAS (CLAUDE.md persistence rule 7: CAS on upload, refuse/log CRITICAL on
   conflict, never auto-merge). Aggregates only (counts per day/env/source/op), no per-call rows.
   **Design must bound its own R2 cost**: flush to the local file often, upload to R2 rarely
   (e.g. hourly + shutdown), and count its own uploads under source `analytics_store`.
   Multi-machine Fly: design must say how two machines' counts combine without clobbering
   (per-machine rows merged at read, or single-writer election).
4. **Admin view.** Read-only admin panel section: last 30 days, Class A/B per env per source,
   top sources for today, and month-to-date Class A vs the 1M free tier.
5. **Alert.** A background check (reuse the `services/reconciliation_alert.py` shape: advisory
   lock + persisted last-run marker so one alert per interval across machines) that alerts when
   any single source exceeds a daily Class A threshold or month-to-date Class A projects past
   the free tier. Alert channel: whatever reconciliation_alert uses.

Not in scope: separate buckets per env (rejected 2026-10-29 as a bigger migration this
makes unnecessary); Cloudflare GraphQL analytics (needs an API token the user has not created;
can be a later cross-check).

## Context

### Relevant Files
- `src/backend/app/storage.py` - `[R2_CALL]` botocore hook (~line 200-223)
- `src/backend/app/user_context.py` - existing request ContextVars (req_id)
- `src/backend/app/middleware/db_sync.py` - request middleware (publishes req_id ~line 724)
- `src/backend/app/services/sweep_scheduler.py`, `services/reconciliation_alert.py`, export workers, poster_warmer - background sources to tag
- `src/backend/app/analytics.py` - `_DailyCounterBuffer` (pattern for buffered flush)
- `src/backend/app/routers/admin.py` + admin frontend panel
- `src/backend/app/modal_functions/*` - Modal containers call R2 directly; design decides whether they report counts (they are out of process)

### Knowledge Docs
- `.claude/knowledge/backend-services.md`, `.claude/knowledge/persistence-sync.md` (CAS rules for the new store), `.claude/knowledge/modal-gpu.md`

### Related Tasks
- T13920 (the incident this would have caught)
- Memory: analytics directive 2026-08-20 (in-house, aggregates only, analytics.sqlite)

## Acceptance Criteria

- [ ] Design doc approved by the user before implementation.
- [ ] Every `[R2_CALL]` log line carries `source=`; route sources use templates, no ids.
- [ ] Test: a request to a route that writes R2 increments (today, env, route-template, A, PutObject).
- [ ] Test: a sweep run's lists count under `sweep`.
- [ ] analytics.sqlite upload uses CAS; conflict test refuses and logs CRITICAL.
- [ ] The store's own R2 Class A cost is bounded and visible under `analytics_store`.
- [ ] Admin view shows per-source daily Class A/B for the last 30 days.
- [ ] Alert fires once (not per machine) when a source crosses the threshold; test covers dedup.

## Progress Log

**2026-10-29**: Filed from the Cloudflare billing-alert investigation. User chose analytics.sqlite over a Postgres table or logs-only.
