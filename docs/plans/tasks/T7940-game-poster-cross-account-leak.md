# T7940: Game poster cache leaks one user's thumbnail onto another user's game tile

**Status:** STAGING
**Impact:** 9
**Complexity:** 3
**Created:** 2026-08-27
**Updated:** 2026-08-27

## Problem

mikhail.k.taylor@gmail.com's game tile ("Vs Toronto JR Argos May 15", his game id=1) is displaying
a thumbnail that is actually a frame from imankh@gmail.com's video (a different game, a different
user, unrelated content). This is a cross-account privacy leak of private user media, confirmed in
**production**.

### Root cause (confirmed via prod data, read-only)

`GET /{game_id}/poster.jpg` ([games.py:3193](../../../src/backend/app/routers/games.py#L3193))
resolves `game_id` against the *authenticated caller's own* per-profile SQLite `games` table, so the
backend's DB read is correctly user-scoped. The leak is at the HTTP caching layer:

- The frontend requests the poster at
  [`GameTile.jsx:158`](../../../src/frontend/src/components/GameTile.jsx#L158):
  `` `${API_BASE}/api/games/${game.id}/poster.jpg` ``. `game.id` is a **per-profile SQLite
  AUTOINCREMENT**, not a globally unique id — nearly every account has a game `id=1`, `id=2`, etc.
- The response is sent with `Cache-Control: private, max-age=86400`
  ([games.py:3326](../../../src/backend/app/routers/games.py#L3326)) and no `Vary` header, and the
  URL carries no user id, profile id, hash, or version token.
- Because the URL `/api/games/1/poster.jpg` is byte-identical across every account that has a
  game numbered 1, any cache that keys purely on URL (most likely the Cloudflare edge in front of
  api.reelballers.com, or a shared proxy/browser cache) can serve one user's previously-cached
  poster bytes to a completely different, unrelated user's identical-looking request.

### Evidence (prod, read-only queries, 2026-08-27)

| User | user_id | game id | name | blake3_hash |
|---|---|---|---|---|
| imankh@gmail.com | `3ed03fb5-...` | 1 | "Vs LA Breakers May 9" | `d971fd15a1e0...` |
| mikhail.k.taylor@gmail.com | `d4afba1a-...` | 1 | "Vs Toronto JR Argos May 15" | `043f62e2c6a4...` |

The two accounts' `id=1` games have **different `blake3_hash` values** and no `shared_by`/
`source_game_id` link — this rules out a real video-level dedup collision (which would mean the
video itself, not just the poster, was wrong). The game *name* mikhail sees is correctly his own
("Vs Toronto JR Argos May 15"), but the *image* is imankh's — exactly what a URL-keyed cache
collision on `/api/games/1/poster.jpg` produces, and imankh's account (created 2026-05-27) predates
mikhail's (created 2026-08-24), consistent with imankh's response having been cached first.

This same defect pattern also exists on:
- `/api/projects/{id}/poster.jpg` ([DraftTile.jsx:356](../../../src/frontend/src/components/DraftTile.jsx#L356), [projects.py:1392,1405](../../../src/backend/app/routers/projects.py#L1392))
- `/api/downloads/{id}/poster.jpg` ([DownloadsPanel.jsx:677](../../../src/frontend/src/components/DownloadsPanel.jsx#L677), [projects.py:1447](../../../src/backend/app/routers/projects.py#L1447))

## Solution

Make the poster URL itself unique per owner so a URL-keyed cache (CDN, proxy, or browser) can never
return one user's bytes for another user's request — this closes the hole regardless of what any
external cache is configured to do, and doesn't depend on getting CDN dashboard config changed.

- Include a value that is unique per (user, profile) — e.g. `profile_id` (already resolved
  server-side via `get_current_profile_id()`) — as a path segment or query param on all three poster
  routes: `/api/games/{game_id}/poster.jpg`, `/api/projects/{id}/poster.jpg`,
  `/api/downloads/{id}/poster.jpg`.
- The server must still independently verify the caller's session owns `profile_id` before serving
  (never trust the URL's profile_id for authorization — it's a cache-correctness token, not an auth
  check) — reject with 403/404 on mismatch.
- Keep `Cache-Control: private` (correct for browser caching) but this alone does not stop a
  misconfigured shared/CDN cache; the per-owner URL is the actual fix.
- Flag to whoever manages the Cloudflare dashboard (not in this repo) that `api.<domain>` should
  not cache authenticated `/api/**` responses regardless of extension (no "Cache Everything" /
  cache-by-extension rule on `.jpg` under `/api/`) — this is a defense-in-depth follow-up, not a
  substitute for the URL fix above.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/games.py` — `get_game_poster` (~3193-3333)
- `src/backend/app/routers/projects.py` — draft/download poster routes (~1392, 1405, 1447)
- `src/frontend/src/components/GameTile.jsx` (~158, 217)
- `src/frontend/src/components/DraftTile.jsx` (~356)
- `src/frontend/src/components/DownloadsPanel.jsx` (~677)
- `src/backend/app/services/poster.py` — key builders (`recap_card_poster_r2_key`, etc.) for reference only, R2 keys are already correctly namespaced and NOT part of the bug

### Related Tasks
- None known. Related knowledge: `.claude/knowledge/persistence-sync.md`, `.claude/knowledge/backend-services.md`.

### Technical Notes
- R2 storage keys are already correctly namespaced per user/profile
  (`profile_r2_key(user_id, profile_id, ...)`, `storage.py:862-870`) — **not** the bug.
- `generate_presigned_url` is not globally cached in a way that crosses users
  (`storage.py:1788-1833`, `storage.py:2765`) — **not** the bug.
- The one-time video upload dedup by sampled BLAKE3 hash (`games_upload.py:137-157`,
  global `games/{hash}.mp4` key) was investigated as an alternative hypothesis and **ruled out** by
  the differing hashes above — do not "fix" that path for this bug, it's a separate (correct)
  mechanism.
- Investigate (as part of this task, not a blocker) whether Cloudflare is in fact fronting the API
  and caching these responses — `cf-cache-status` response header on a live request would confirm;
  no Cloudflare config exists in this repo (checked) so this needs dashboard access.

## Implementation

### Steps
1. [x] Add a per-owner disambiguator (profile_id) to the three poster URLs, frontend + backend
2. [x] Server-side: verify session-owned profile_id matches the URL's before serving (403 on mismatch)
3. [ ] Confirm/rule out CDN-level caching of `/api/**` (check `cf-cache-status` on a live poster request) — DEFERRED, needs Cloudflare dashboard access, not available in the container worker
4. [x] Regression test: two different accounts each with a game numbered the same id must never receive each other's poster bytes
5. [ ] Manually verify mikhail.k.taylor@gmail.com now sees his own frame after the fix + a cache-bust — DEFERRED to post-merge/post-deploy, needs prod access

### Progress Log

**2026-08-27**: Bug reported by user (imankh) after mikhail.k.taylor@gmail.com's game showed
imankh's video frame as its thumbnail. Root-caused via code audit + prod read-only DB comparison
(see Evidence table above). Hash mismatch on both accounts' `id=1` games rules out a real video
collision; confirms URL-keyed cache collision on `/api/games/{id}/poster.jpg`. Not yet fixed.

**2026-08-28**: Implemented via container worker (M-tier). All 3 routes
(`get_game_poster`/games.py, `get_draft_poster`/projects.py, `get_reel_poster`/downloads.py
— note: the task file originally cited the downloads route at projects.py:1447, which was
stale; it actually lives in downloads.py) now take `profile_id: str | None = None` and 403
on a mismatch against `get_current_profile_id()`, checked before any DB/R2 work. Frontend
(GameTile/DraftTile/DownloadsPanel) appends `?profile_id=<currentProfileId>` to all 3 URLs.
9 new unit tests in `test_t7940_poster_cross_account_leak.py` pin the exact bug scenario per
route (mismatch -> 403 + DB never read; match/absent -> normal flow). Existing
`GameTile.posterUrl.test.jsx` / `DraftTile.test.jsx` updated for the new URL shape.
`.claude/knowledge/backend-services.md` updated. CI verdict: red on first run
(`test_t6200_concurrency.py::test_authed_burst_larger_than_pool_does_not_503`, a known
pre-existing sqlite-lock flake already in `docs/testing/known-failures.md`, unrelated to
this diff) -> green on same-SHA rerun. Branch `feature/T7940-game-poster-cross-account-leak`
pushed, awaiting merge. Steps 3 and 5 remain deferred (prod/dashboard access needed).

**2026-08-28 (later)**: Added 3 real-HTTP-route integration tests
(`test_t7940_poster_http_integration.py`) closing the gap the unit tests couldn't: a live
`TestClient` against the real app, two real accounts each with a real `games` row numbered
id=1 (the exact prod incident shape), only the R2/ffmpeg boundary mocked — proving FastAPI's
query-param binding, the X-Profile-ID middleware, and the guard all work together, not just
the guard's isolated logic. Counterfactually verified: removing the guard makes the
integration test fail. Merged to master (PR #306, CI green).

## Acceptance Criteria

- [x] Poster URLs are unique per (user, profile), not just per numeric game/project/download id
- [x] Server rejects/ignores a URL profile_id that doesn't match the caller's session
- [ ] mikhail.k.taylor@gmail.com's game tile shows his own footage, verified live — deferred to post-merge/deploy verification
- [x] Regression test covers the two-accounts-same-numeric-id scenario
- [x] Tests pass
