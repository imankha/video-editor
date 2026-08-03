# T6390 — Design: sync-conflict diagnostics + per-DB marker scoping

**Status:** Design (NON-BLOCKING gate — implementation proceeds immediately per kickoff).
**Tier:** L · Backend + Frontend · ~250 LOC.

## Problem (from the task file)

A CAS-refusal banner (`Could not save to the cloud / A newer version of your work
exists`) hit staging and **could not be root-caused**: the browser console said nothing,
the server CRITICAL scrolled out of the ~90s `flyctl logs` window, and even when read it
omitted `req_id`/method/path and *who moved R2 ahead*. Separately, a real correctness
defect was found while scoping: the `.sync_conflict` / `.sync_failed` markers are
**per-USER files describing per-DB state**, so a success on one DB silently erases a live
conflict on another (and `retry_pending_sync` self-stomps within one call, letting a
non-retryable CAS conflict be blind-retried to exhaustion and mislabelled `failed`).

## Two halves

### Part A — diagnostics (no behaviour change to the CAS guard)

1. **Markers carry a JSON diag payload, not a bare `str(time.time())`.**
   `ts, reason, db, profile_id, loaded, r2, machine, req_id, method, path, writer,
   written_at`. `reason ∈ {stale_baseline, unconfirmed_baseline, upload_failed,
   checkpoint_busy}` (+ `legacy` for a tolerated old-format body). Readers tolerate the
   legacy float-only body (a marker written by the running deploy) — never raise.
2. **`X-Sync-Diag` response header** carries a compact `k=v;k=v` rendering of the
   winning marker's payload alongside `X-Sync-Status`. Added to `expose_headers` in
   `main.py:217` — **without this the cross-origin staging/prod client cannot read it**
   (local same-origin dev hides the gap).
3. **Client logs.** `checkSyncStatus` emits `console.error` on the *transition* into
   `conflict`/`failed` (NOT on repeat responses in the same state — no console spam) with
   the diag, the request method+URL, the `req_id` (from the diag payload — the server
   already has it), and `hasAttemptedWrite`. `retrySyncToR2` logs all three outcomes
   (restored / success / failure) instead of swallowing `catch { return false }`.
4. **Server logs the correlation it already has.** Add `req_id` + method + path to both
   `[SYNC_CONFLICT]` CRITICALs (via new `_current_method`/`_current_path` ContextVars set
   next to `req_id` in dispatch). One ERROR at the request boundary already exists for
   foreign DBs; the session's own conflict/failed now also surfaces in the diag payload.
5. **Writer identity in R2 metadata.** Stamp `db-writer` (`{machine}/{req_id}`) and
   `db-written-at` (ISO) next to `db-version` on every profile/user upload. On a conflict
   the HEAD **already ran** — `get_db_version_from_r2(..., return_metadata=True)` returns
   the winner's identity from the **same** HEAD (zero extra R2 calls). Legacy objects
   have no writer → `writer=None` (honest "unknown", NOT a fabricated fallback).

### Part B — scope the marker (the correctness fix)

**Decision: per-scope marker files, not more reassertions.** A scope is a string:
`USER_DB_SCOPE = "user"` for `user.sqlite`, or the `profile_id` for a profile DB. Marker
path: `USER_DATA_BASE/{user_id}/.sync_conflict.{scope}` (and `.sync_failed.{scope}`), each
holding the Part-A JSON payload.

- `mark_sync_conflict(user_id, scope, diag)` writes only that scope's file.
- `clear_sync_conflict(user_id, scope)` clears only that scope. **`scope=None` clears ALL
  scopes + the legacy bare file** — reserved for genuine full-recovery callers
  (`set_sync_failed(user_id, False)`, `/api/retry-sync` success) and for legacy-format
  tolerance; it is NOT used on a single-DB success path.
- `has_sync_conflict(user_id)` → True if the legacy bare file OR any `.sync_conflict.*`
  scope file exists. Header priority (`conflict > failed > pending`) unchanged.

Why per-file rather than a single JSON set: the profile and user syncs run in **parallel
threads** (`_background_sync`'s `asyncio.gather`), each touching its own DB's marker. Two
threads doing read-modify-write on one shared JSON file would race; separate files mean
each thread writes only its own scope — the race the T4310 post-`gather` reassertion was
added to paper over **structurally cannot happen**, so that reassertion is **deleted**
(the "scope it, don't reassert" directive).

**Backward-compatible signatures.** `scope`/`diag` are added such that the no-scope calls
still work: `mark_*_(user_id)` writes the legacy bare file (still detected); `clear_*_
(user_id)` clears all. This keeps every existing behaviour test green without silent
semantic drift; production call sites are migrated to pass an explicit scope.

**`retry_pending_sync` returns its outcome, not a bare bool.** It now returns an aggregate
`SyncResult` (CONFLICT if either DB conflicted, else FAILED if either failed, else OK;
truthy only on OK so the existing `if ok:` caller is unaffected). `_redrain_failed_sync`
inspects that return — `CONFLICT → stop` (a CAS conflict is not blind-retryable) — instead
of re-reading the `.sync_conflict` marker file. This removes the marker-file dependency
the self-stomp defeated.

### The three stomps this fixes (failing test per stomp, written first)

- **(a)** `retry_pending_sync` with a conflicting profile + healthy `user.sqlite`: the
  profile-scope conflict marker **survives** the user branch's clear (deterministic, no
  concurrency). Its aggregate return is CONFLICT.
- **(b)** A `user.sqlite`-only success does not clear a live profile-scope conflict.
- **(c)** A surviving conflict is not blind-retried by `_redrain_failed_sync` to
  exhaustion and surfaces as `conflict`, not `failed`.
- **(legacy)** A marker written in the old `str(time.time())` format reads without raising.

## Non-negotiables honoured

- **CAS refusal never weakened** — the `storage.py` guard (`r2_version > 0 and
  (current_version is None or r2_version > current_version)`) is byte-identical; only
  logging + returned diag are added. No auto-merge, no blind-retry, no bypass.
- **No per-request R2 HEAD** — writer identity rides the HEAD already on the conflict path.
- **No new fallbacks** — a genuinely-unknown writer is `None`, not a fabricated default.
- **No presigned URLs logged.**
- **Success path stays silent** — verbose logging is on FAILURE/CONFLICT paths + one line
  per state TRANSITION only; no new INFO on every successful sync (protects T2880/T3380).
- **No reactive persistence** — markers are runtime state written on the existing sync
  gesture path; the client change is log-only. No new write path, no `useEffect`.
- **No schema migration** — markers are ephemeral filesystem state, not DB schema.

## Files

`storage.py` (metadata stamp + return_metadata + diag return + conflict-log fields),
`database.py` (scoped marker helpers + diag builder + explicit-sync call sites),
`user_context.py` (method/path ContextVars), `middleware/db_sync.py` (marker scoping at
call sites, retry outcome, redrain, X-Sync-Diag header), `main.py` (expose_headers),
`routers/health.py` (set_sync_failed full-clear), `stores/syncStore.js` (diag logging).
Tests: `tests/test_t6390_marker_scoping.py`, `syncStore.test.js` additions.

## Risks

- Deploy window: a running old machine may still write a legacy bare marker — tolerated by
  the reader and cleared opportunistically on the next scoped success.
- Header size: the diag is compact (`k=v;`), well under header limits; `writer` is
  `machine/req_id`, never a URL.
