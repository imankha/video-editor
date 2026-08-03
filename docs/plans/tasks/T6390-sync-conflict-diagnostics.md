# T6390: The sync-conflict banner is undiagnosable — log the "why" on both client and server

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-08-02
**Updated:** 2026-08-02

## Problem

User hit `Could not save to the cloud / A newer version of your work exists. Retry to
load it.` in Annotate on staging, 2026-08-03 ~01:15 UTC. **The incident could not be
root-caused**, because the two places we look carry nothing:

**The browser console said nothing.** `checkSyncStatus` (`syncStore.js:154`) flips
`syncState` from the `X-Sync-Status` header and renders the banner with **zero console
output** — no log line, no request URL, no `req_id`, no timestamp. The user's console
dump for the incident contains only page-load `[SLOW FETCH]` lines. Nothing in it even
proves the conflict happened, let alone which gesture hit it.

**The server line existed but was already gone.** `storage.py:1198` (and its
`user.sqlite` twin at `:1471`) do log a CRITICAL:

```
[SYNC_CONFLICT] user=… profile=… loaded=vN r2=vM machine=… — NOT uploading, NOT re-downloading
```

`flyctl logs -a reel-ballers-api-staging --no-tail` returns **~100 lines**, roughly the
last 90 seconds of a chatty request log. By the time a user reports a banner the line
has scrolled out. The retained window for this incident held only the *recovery*
(`[SYNC] Retrying pending sync` → `Retry succeeded` → `Uploaded DB to R2 … version 2704`
at 01:18:47), never the refusal. The marker file that *drives the banner* (`.sync_conflict`)
outlives the log line by design but stores only `str(time.time())` — the diagnosis is
thrown away at exactly the moment it is written.

**And the line that survives still can't close the case.** Even when read in time it
omits:

- **`req_id` / method / path** — so a refusal cannot be tied to the gesture that caused
  it, even though the correlation id already exists end-to-end: the client mints
  `X-Request-ID` (`sessionInit.js:77,87`) and the server logs it as `req_id` on
  `[REQ]`/`[REQ_TIMING]`/`[R2_CALL]`. The conflict path is the one place that drops it.
- **who moved R2 ahead** — the single fact that decides the whole triage. R2 object
  metadata carries only `db-version` (`storage.py:1251`); there is no writer identity, so
  "another machine", "the export worker", "an admin restore/env-copy" and "a migration
  run" are indistinguishable after the fact.
- **an ERROR at the request boundary** — `db_sync.py` logs `logger.error` when a
  *foreign* DB fails to sync (`:1094`, `:1118`) but the **session user's own** conflict
  sets `sync_status = "conflict"` (`:1056`) and returns the header silently.

The one fact the current line *does* pin down is valuable and must be preserved:
`loaded=vNone` (unconfirmed baseline, the T6340/T4315 class) vs `loaded=v2701`
(genuinely stale, the T6160 class) are different bugs with different fixes, and the
banner is identical for both.

Two known mechanisms can produce this exact banner and are worth discriminating in
one glance, not three manual steps: **T6340** (migration runner destroys its own sync
baseline → `loaded=None` → CAS refuses unconditionally; fix merged `fe27c792`, so a
recurrence means the fix is incomplete) and **T6160** (machine never re-checks R2 after
first access → stale baseline after an out-of-band write). Staging runs **one** machine
(`reel-ballers-api-staging`, `misty-snow-4472`, lax, `min_machines_running = 0`,
`auto_stop_machines = "suspend"`), so a cross-machine race is *not* the explanation here
and the log should make that conclusion reachable without a `flyctl machines list`.

This is the sync-layer twin of **T6330** ("video failures must log where the code
looked"), from the same user direction: an error that reaches the UI must arrive with
enough logged context to solve it.

## Solution

Diagnostics only. **No behaviour change to the CAS guard** — the refusal is correct
(T4310/T4315) and must not be weakened; nothing here adds a fallback, a retry, or an
auto-merge.

**1. Marker files carry the diagnosis, not a bare timestamp.**
`mark_sync_conflict(user_id, diag=None)` / `mark_sync_failed(...)` (`database.py:93,128`)
write a JSON payload — `ts`, `reason` (`stale_baseline` | `unconfirmed_baseline` |
`upload_failed` | `checkpoint_busy`), `db` (`profile` | `user`), `profile_id`, `loaded`,
`r2`, `machine`, `req_id`, `method`, `path`. Readers must tolerate the legacy
float-only body (a marker written by the running deploy). The marker's lifetime is
already exactly the banner's lifetime, so the diagnosis survives as long as the symptom —
which is the whole point, given the ~90s log window.

**2. `X-Sync-Diag` response header** carries a compact rendering of that payload
alongside `X-Sync-Status` (`db_sync.py:874`). **Landmine:** `main.py:217` sets
`expose_headers=["X-Sync-Status", "X-App-Version", "X-App-Build"]` — the staging/prod
frontend is a *different origin*, so a new header is invisible to JS unless it is added
there. Omitting this makes the client half silently no-op in exactly the deployed
environments that need it.

**3. The client logs an error at all.** `checkSyncStatus` emits a `console.error` on the
transition into `conflict`/`failed` with the diag header, the request method+URL, the
`X-Request-ID` for that response, and `hasAttemptedWrite` (so a gated/ungated banner is
distinguishable). `retrySyncToR2` currently swallows every failure (`catch { return
false }`, `syncStore.js:90`) and reloads on `restored` with no trace — log all three
outcomes. Console only; **no new telemetry endpoint**.

**4. Server logs the correlation it already has.** Add `req_id` (via the
`get_current_req_id()` already used at `storage.py:148`) plus method/path to both
`[SYNC_CONFLICT]` CRITICALs, and log one ERROR at the request boundary when the
*session's own* status resolves to `conflict`/`failed`, matching the existing foreign-DB
lines.

**5. Writer identity in R2 metadata.** Stamp `db-writer` (machine + req_id) and
`db-written-at` next to `db-version` on every profile/user DB upload
(`storage.py:1251`, and the `user.sqlite` twin). On a conflict the HEAD **has already
run** and `get_db_version_from_r2` already receives the full `Metadata` dict
(`storage.py:947`), so reading the winner's identity costs **zero extra R2 calls**. This
is the one currently-unobtainable fact, and it is what turns "R2 moved" into "R2 was
moved by X at T".

## Acceptance

- Reproduce a CAS conflict (force a stale/absent baseline against real R2 content) and
  show that **the browser console alone** names: the state, the reason, which DB, loaded
  vs R2 version, the machine, and the `req_id`.
- Show the **server** line for the same event carries `req_id` + method + path, and
  identifies the writer that moved R2 ahead.
- Show `loaded=None` (unconfirmed) and `loaded=vN` (stale) render as **different
  `reason` values** on both sides.
- A marker written in the legacy `str(time.time())` format still reads without raising
  (deploy-window compatibility).
- `X-Sync-Diag` is present in `expose_headers` and readable **cross-origin** (verify
  against staging, not just localhost — same-origin dev hides this class).
- No change to when a conflict is refused, marked, cleared, or re-drained: the existing
  `test_t4310_r2_cas_conflict.py` / `test_sync_status.py` behaviour tests stay green
  untouched.

## Notes

- Do **not** add a per-request R2 HEAD (T6160's explicit constraint) — every new fact
  here comes from a HEAD that already happens on the conflict path.
- Do **not** log presigned URLs or R2 credentials (T6330's constraint).
- Keep the success path silent: no new INFO logging on every sync (T2880/T3380 keep the
  hot path clean).
