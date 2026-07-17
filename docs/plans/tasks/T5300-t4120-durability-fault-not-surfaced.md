# T5300: T4120 durability test — forced sync fault returns 202, never surfaces `sync_failed`

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-17
**Updated:** 2026-07-17

## Problem

`e2e/T4120-self-verify-durability.spec.js` fails **locally, with or without T4934's changes**
(proven by stash + re-run on the reused container stack — it is pre-existing, unrelated to
T4934). The failing assertion is around
[T4120-self-verify-durability.spec.js:105](../../src/frontend/e2e/T4120-self-verify-durability.spec.js#L105):

```js
expect(faultTerminal.code, 'forced sync fault -> retryable sync_failed').toBe('sync_failed');
```

The test: enable the `/api/test/sync-fault` seam, POST `/api/export/render-overlay`, and expect
the export to reach a terminal `sync_failed` (retryable, COMPLETE withheld) — the T4110 durable
boundary. Observed instead: the faulted `render-overlay` returns **HTTP 202** and the terminal
event never carries `code: 'sync_failed'` (`faultTerminal.code` is `undefined`).

## Why this matters

Two possibilities, and the task is to determine WHICH and fix accordingly:

1. **Real durability gap:** the sync-fault is only honored on the SYNCHRONOUS overlay paths,
   where the durable boundary runs inline:
   - [overlay.py:2043](../../src/backend/app/routers/export/overlay.py#L2043) (no-GPU copy path)
   - [overlay.py:2110](../../src/backend/app/routers/export/overlay.py#L2110) (test-mode copy path)
   Both call `sync_export_db_to_r2`; on failure they emit `_export_sync_failed_data(...)` and
   return 503. **HTTP 202 means the render took a DIFFERENT path** — a queued/async/Modal path
   that returns `202 Accepted` and completes later — and that path may NOT pass through the same
   durable boundary, so a sync failure there would be silently swallowed (COMPLETE announced
   despite the R2 write never landing). That would be a genuine T4110 hole on the queued path
   and a real bug worth fixing at the source.

2. **Test-environment artifact:** the container has `modal_enabled()` true (or the branch
   conditions route `render-overlay` to the queued path), so the test's assumption that the
   synchronous copy path runs no longer holds. Then the fix is to make the test force the
   synchronous path (correct `X-Test-Mode` + modal-disabled conditions) OR assert the durable
   boundary on whatever path actually runs — NOT to weaken the assertion.

Either way: do NOT paper over it (no silent skip, no defensive no-op). The durable boundary is
a data-safety invariant (T4110) — a swallowed sync failure = a reel announced COMPLETE that
isn't durably in R2.

## Investigation steps
1. Reproduce in the container: `bash scripts/dev-verify.sh e2e/T4120-self-verify-durability.spec.js`;
   capture the `[T4120] faulted render-overlay HTTP <status>` log line (worker saw 202).
2. Determine which `render-overlay` branch actually executes under the test (grep the 202
   return sites in overlay.py; check `modal_enabled()` + `is_test_mode` gating at
   [overlay.py:2074-2077](../../src/backend/app/routers/export/overlay.py#L2074)).
3. If a queued/Modal path returns 202 and bypasses the durable boundary → **fix the source**:
   the durable-boundary sync-then-announce must apply on that path too (the sync-fault must
   withhold COMPLETE and surface a retryable `sync_failed` there, mirroring
   `_export_sync_failed_data`). Follow T4110's sync-then-announce pattern; no defensive re-sync.
4. If it is purely a test routing assumption → fix the test to exercise the real synchronous
   durable boundary (keep the assertion strong).

## Relevant files
- `src/frontend/e2e/T4120-self-verify-durability.spec.js` — the failing spec (assertion ~105)
- `src/backend/app/routers/export/overlay.py` — `render-overlay`; durable boundary at :2043 /
  :2110; the 202-returning queued path (find it)
- `src/backend/app/services/export_helpers.py` — `export_sync_failed_data`, `sync_export_db_to_r2`
- `src/backend/app/routers/test_seams.py` — `/api/test/sync-fault` seam
- `src/backend/app/middleware/db_sync.py` — `set_sync_failed` / `is_sync_failed` (:235-240),
  `sync_failed` payload (:77-78)
- Knowledge: `.claude/knowledge/export-pipeline.md`, `persistence-sync.md`

## Acceptance Criteria
- [ ] Root cause identified: real queued-path durability gap OR test routing assumption
      (stated explicitly with the observed HTTP status + branch taken)
- [ ] If a real gap: the queued/202 render path honors the durable boundary — a forced sync
      fault withholds COMPLETE and surfaces a retryable `sync_failed` terminal event
- [ ] `T4120-self-verify-durability.spec.js` passes locally (fault path → `sync_failed`, clean
      path → complete), assertion strength preserved (no weakening/skip)
- [ ] No defensive fallback / silent no-op introduced (data-safety invariant stays visible)
- [ ] Tests pass; if a real backend gap was fixed, a backend test pins it

## Context
### Related Tasks
- Found by: T4934 (E2E staging-compatibility) worker, flagged as out-of-scope pre-existing.
- Invariant owner: T4110 (edit-reel durability — sync-then-announce durable export boundary).

### Classification hint
M-tier. Backend + one e2e spec. If it turns out to be a real queued-path durability gap it's an
important data-safety fix (bump toward L); if it's a test routing assumption it's a smaller test
fix. Investigation gates the size — do step 1-2 before committing to scope.
