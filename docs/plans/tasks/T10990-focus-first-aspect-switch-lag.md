# T10990: Big lag on the first Portrait/Landscape switch of a Focus session

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-09-21
**Updated:** 2026-09-21

## Report (user, prod, 2026-09-21)

"There also seems to be a big lag when I try to switch between portrait and landscape for the
first time in a session." Later switches are fast.

## What is already known (investigated during T10980)

- The switch is `handleAspectRatioChange` (FocusScreen) -> `POST /api/clips/projects/{id}/aspect-ratio`
  (UPDATE project + re-fit every latest clip's crop keyframes, non-durable so the R2 upload is a
  background task) -> `GET .../clips` -> `GET /api/projects/{id}`. Three sequential round trips.
- Nothing on the frontend is first-time-only: no lazy import, no video reload (`lastLoadedUrlRef`
  guard), no worker, no cache build. In dev the whole gesture measures ~100 ms.
- The only first-write-only server path is `db_sync.py` `_sync_aware_flow`: a WRITE request whose
  user has a `.sync_pending` marker from an earlier failure first awaits `retry_pending_sync`
  (an R2 PutObject, 300-1000 ms+) before the handler runs. That needs a leftover marker, i.e. an
  earlier failed sync, so it is not the normal case.
- Before T10980 the selector could show the WRONG ratio, so the first click on the correct
  button was a silent no-op (guard compared against the real project value). A user's "first
  switch" may therefore have been a no-op click followed by a real one; re-test after T10980.
- Fly's `fly logs` buffer only holds ~100 recent lines and there is no log drain yet (T10350), so
  the prod requests from the report window could not be inspected.

## Next step

Reproduce on staging with DevTools Network open (or ask the user to note the time so the
`[SLOW REQUEST]` lines can be read from `fly logs` immediately after). Compare the three
requests' server timings on the first vs second switch; if the first POST is slow, check for
`[SYNC] Retrying pending sync` on the same req_id window and for a cold Postgres/R2 connection.
If the frontend is the slow half, profile the `clips` -> `useCrop` restore effect chain.
