# T5720 Design — Public game link + edge watch page

**Task:** 3 of 5 in the [Share the Game epic](EPIC.md). Absorbs the link/unfurl/watch half of T4910.
**Tier:** L (new public surface + edge function). Design gate — user approval required before implementation.
**Builds on:** T5710 `ensure_recap(user_id, profile_id, game_id, layer) -> {status, recap_key, mapping_key, poster_key, clip_count}` (`auto_export.py:658`), `recap_poster_r2_keys_for_layer` (`poster.py:721`).

**Scope of this doc:** the design gate for the endpoint contracts, the structural anonymous-scope
guarantee, the share-row shape (incl. the DDL question), the `share_type` membership audit, the
revocation/expiry semantics, the edge/SPA split, and the T5730 CTA seam. Everything already locked
in [EPIC.md](EPIC.md) + the T5720 task file + [T5710-design.md](T5710-design.md) is NOT
re-litigated here.

## Locked context (not decided here)

- **Anonymous = TEAM RECAP ONLY.** No full-game URL, no athlete-layer data ever leaves the public
  resolve endpoint (EPIC decision 3). This is the single most important property of the task.
- Links live until revoked; idempotent per game; revoked → 410 (EPIC decision 6).
- Expired game source degrades to **recap-only playback** (recaps survive expiry) — supersedes
  T3970's hard block for THIS share kind.
- **Stitch-on-share:** creation calls `ensure_recap(user_id, profile_id, game_id, 'team')`
  (auto_export.py:658) + warms the team poster BEFORE returning. `status == 'empty'` (T5710's
  zero-team-clips signal) → actionable refusal, NO share row created.
- `ensure_recap(...,'team')` is single-layer, idempotent, cheap on the hit path; returns
  `{status, recap_key, mapping_key, poster_key, clip_count}`, `status ∈ present|empty|stitched`.
- Team poster keys via `recap_poster_r2_keys_for_layer(user_id, profile_id, game_id, 'team')`
  (poster.py:721) → `_team` siblings. Edge = clone `functions/shared/[token].js` →
  `functions/shared/game/[token].js`; `_redirects` is `/* /index.html 200`, so two-segment
  routes already reach the SPA (confirmed).
- Claim materialization does NOT ship here (T5730). This task ships view-only value + the CTA seam.

---

## 1. Endpoint contracts

Five endpoints. Anonymous (no-auth) endpoints ride the existing `/api/shared/` allowlist prefix
(already `AUTH_ALLOWLIST_PREFIXES`). Create + revoke are authed (sharer-only) and live under
`/api/games/` next to `share_game` (games.py:~1698).

| Endpoint | Auth | Success | Error states |
|---|---|---|---|
| `POST /api/games/{game_id}/share-link` | sharer (session) | 200 `CreateGameLinkResponse` | 404 game not found; **409 `empty_team_layer`** (zero team clips); 401 no session |
| `GET /api/shared/game/{token}` | none | 200 `PublicGameLinkResponse` | 404 unknown/not-a-game_link; 410 revoked |
| `GET /api/shared/game/{token}/poster.jpg` | none | 200 `image/jpeg` | 404 unknown/revoked/no poster |
| `POST /api/shared/game/{token}/viewed` | none | 204 | 404 unknown; 204 (no-record) revoked |
| `DELETE /api/games/{game_id}/share-link` | sharer (session) | 200 `{ "ok": true }` | 404 no active link; 403 not the sharer; 401 no session |

### 1a. `POST /api/games/{game_id}/share-link` (create, authed, idempotent)

Request body: none (game_id in path; sharer resolved from session).

Flow: resolve `(user_id, profile_id)` from context → `ensure_recap(user_id, profile_id, game_id,
'team')`:
- `status == 'empty'` → **409** `{ "error": "empty_team_layer", "message": "Tag some team plays
  first" }`. No share row created (explicit refusal, not an empty share).
- `status ∈ {present, stitched}` → warm the team poster (below), then upsert the idempotent
  `game_link` share row (section 3) and return its token.

Poster warm: `warm_recap_poster` (poster.py:749) is the pre-T5710 whole-game warmer and uses the
UNSUFFIXED `recap_poster_r2_keys` (athlete/legacy keys) — it CANNOT warm the `_team` poster as-is.
**Recommendation: EXTEND `warm_recap_poster` with a `layer: str = "athlete"` argument** that
selects `recap_poster_r2_keys_for_layer(user_id, profile_id, game_id, layer)`; default keeps the
existing email-teammate caller byte-identical (EPIC decision 6 — that flow is untouched). Do NOT
write a parallel `warm_team_recap_poster`; one greppable warmer, one layer knob.

Response `CreateGameLinkResponse`:

```json
{ "share_token": "…uuid4…", "url": "https://app.reelballers.com/shared/game/{token}", "already_existed": true }
```

`already_existed` distinguishes a fresh row from an idempotent reuse (drives the share-sheet copy in
T5740; not load-bearing for correctness). Status 200 for both.

### 1b. `GET /api/shared/game/{token}` (resolve, no auth)

Guard order (fail-visible, each state explicit):
1. `get_game_share_by_token(token)` → falsy → **404**.
2. `share["share_type"] != "game_link"` → **404** (not a public game link; never resolve a
   `game`/`annotation_playback` row through this endpoint — those stay per-recipient gated).
3. `share["revoked_at"]` → **410**.

Then build `PublicGameLinkResponse` (see §2 for HOW it is built to be leak-proof). Presign the TEAM
recap master (`recap_key` from the `_team` scheme, 4h) — NEVER the game source. Clip rail is drawn
from the frozen team-layer mapping (`_team_clips.json`) so names/offsets/tags match exactly what the
recap plays. View recording is scheduled off the response path via `BackgroundTasks`
(`record_milestone("share_viewed")`), never awaited.

Response shape (every field; NOTE what is structurally absent):

```json
{
  "share_token": "…",
  "is_public": true,
  "game_name": "vs. Riverside — Mar 3",
  "game_date": "2026-03-03",
  "sharer_name": "the Khan family",
  "recap_url": "https://…r2…/recaps/{game_id}_team.mp4?X-Amz-… (presigned, 4h)",
  "poster_url": "/api/shared/game/{token}/poster.jpg",
  "clips": [ { "name": "Goal", "recap_start": 0.0, "recap_end": 6.2, "player_tags": ["#7"] }, … ],
  "clip_count": 8,
  "video_kind": "recap"
}
```

- `recap_url` is presigned R2 (the edge `<video>` src + `og:video`) — but see §2: it is a
  RECAP-ONLY presign; the DTO has NO field for a game-source URL.
- `poster_url` is the STABLE relative proxy path, NEVER a presigned URL in `og:image` (T5180 rule);
  the edge absolutizes it against the API base (existing `absolutizePosterUrl`).
- `video_kind` mirrors T5710's vocabulary (`recap` | `recap_legacy` | `recap_legacy_combined`) so
  the edge/SPA can label an expired-source combined recap honestly; a `null`/absent recap can never
  reach here because create refuses `empty` and `ensure_recap` guarantees a team artifact exists.

### 1c. `GET /api/shared/game/{token}/poster.jpg` (poster proxy, no auth)

Mirror `get_shared_teammate_poster` (shares.py:557) but for the TEAM poster key. Guard: share
exists, not revoked, `share_type == "game_link"`, has `game_id`. Ensure/serve the poster at the
`_team` key via `ensure_recap_poster(team_recap_key, team_poster_key)` (generate-on-first-request
fallback for a link whose warm was evicted), then `_serve_poster_jpeg` (fresh presign per request,
24h client cache). Absent → 404 → edge keeps the branded card (never a broken image). Stable proxy
path, NEVER presigned in `og:image` (T4890/T5180 rule).

### 1d. `POST /api/shared/game/{token}/viewed` (beacon, no auth)

Byte-for-byte the T4840 `record_shared_view` pattern (shares.py:597), scoped to `game_link`:
unknown token → 404; revoked → 204 with NO milestone; otherwise schedule
`record_milestone("share_viewed", {share_type: "game_link"})` via `BackgroundTasks` and return 204.
Analytics NEVER on the response path.

### 1e. `DELETE /api/games/{game_id}/share-link` (revoke, authed)

**Chosen path: `DELETE /api/games/{game_id}/share-link` (game-scoped), NOT the token-scoped
`DELETE /api/shared/{token}` and NOT a visibility PATCH.** Rationale:
- The game card is the revoke gesture surface (ProjectManager) — it holds `game.id`, not the token;
  a game-scoped route means the card never has to first fetch/track the token.
- Idempotent-per-game means at most one active `game_link` per game, so "revoke the link for this
  game" is unambiguous.
- A visibility PATCH (`is_public=false`) is wrong here: `is_public` is the edge-cacheability
  discriminator; flipping it would make the row resolve as a private share (403 path) rather than a
  cleanly-revoked one (410). Revocation must set `revoked_at` (→ 410), matching reel-link semantics.

Handler: resolve `user_id` from session → look up the active `game_link` share for
`(game_id, user_id)` → 404 if none → 403 if `sharer_user_id != user_id` → `revoke_share(token,
user_id)` (existing helper, sets `revoked_at`) → `{ "ok": true }`. Re-revoke → 404 (no active link)
is acceptable and idempotent from the UI's perspective.

---

## 2. The anonymous-scope guarantee (STRUCTURAL, not "remember to filter")

The threat: a later careless edit adds a game-source URL or an athlete-layer field to the resolve
response and leaks it to anonymous visitors. A filter-based guarantee ("we just don't populate it")
is one forgetful line away from breaking. The guarantee must be **structural: make the field
impossible to populate.**

**Design: a dedicated Pydantic response model `PublicGameLinkResponse` that has NO game-source
field and NO athlete-layer field to populate.** The resolve endpoint's declared return type IS this
model; FastAPI serializes ONLY the model's declared fields, so any stray `game_blake3` / `game_url`
/ athlete-clip value a future edit computes has nowhere to land — it is dropped at the serialization
boundary, not by a reviewer's vigilance.

Concretely:
- `PublicGameLinkResponse` declares exactly the §1b fields. It has **no `game_url`, no
  `game_blake3`, no `video_warm_url`, no `full_game_url`** field. (Contrast: the email-teammate
  `get_shared_teammate` response DOES carry `game_blake3` + `video_warm_url` — that endpoint is a
  claim surface for a known recipient. `game_link` must NOT reuse that dict; it uses its own model.)
- The `recap_url` presign is computed from the `_team` recap key ONLY. There is no code path in the
  resolve handler that presigns `games/{blake3}.mp4`; the `blake3` is never read into the handler.
- The clip rail is built from the frozen `_team_clips.json` mapping (team-layer-pure by
  construction — T5710 stamps the layer), so no athlete clip can appear even if the mapping loader
  were mis-called; and each `clips` item carries only `{name, recap_start, recap_end, player_tags}`
  — no source offsets into the full game, no clip filenames.

**How a test proves it (assert on the body AND the type):**
1. **Body assertion:** resolve a `game_link` token; assert the JSON body's key set is EXACTLY the
   declared set; assert `"game_url" not in body and "game_blake3" not in body and "video_warm_url"
   not in body`; assert every `clips[i]` key set excludes source-offset/filename keys.
2. **Type assertion (the structural teeth):** `assert "game_url" not in
   PublicGameLinkResponse.model_fields` (and the other banned names). This test goes RED the instant
   someone ADDS a game-source field to the model — before it can ever be populated — which is the
   property we actually want to defend.
3. **Cross-layer assertion:** seed a game with BOTH athlete and team clips; assert the resolve
   `clips` names are a subset of the team-layer clip names only.

This is the section a public-scope regression would otherwise hide in; the model boundary is the
defense.

---

## 3. Share row shape + the DDL question

Row created idempotently per game via an extended `create_game_share(...)` call
(sharing_db.py:270), reusing the existing `shares` + `share_games` two-table shape:

- `shares` row: `share_type = 'game_link'`, `is_public = true`, `sharer_user_id`,
  `sharer_profile_id`, `recipient_email = ''` (no recipient — public link; the column is NOT NULL,
  so store empty string exactly as the existing reel self-share path does at shares.py:288).
- `share_games` row: `game_id`, `tag_name = NULL` (game_link is not tag-filtered), `game_name`,
  `game_blake3`, `first_clip_start`, `clip_names` — **all filled from the TEAM layer** (team clip
  names/offsets from the team mapping / team-predicate query), so the stored snapshot matches what
  the recap plays. (`game_blake3` is stored on the row for the sharer's own bookkeeping/claim path,
  but is NEVER emitted by the public resolve DTO — §2.)

**Idempotency key = `(game_id, sharer_user_id, share_type='game_link', revoked_at IS NULL)`.** A
second create returns the SAME active token. Model on the reel-link idempotency
(`get_active_public_share_for_video`, shares.py:275) — add a sibling
`get_active_game_link_share(game_id, sharer_user_id)` in `sharing_db.py`. Unlike the reel link,
there is NO filename-snapshot invalidation: the link is per-game and survives re-stitches (the recap
key is deterministic and overwritten in place), so the same token keeps serving the freshest recap.

### DDL: REQUIRED — Migration agent MUST be included.

`pg.py:133` (live `_SCHEMA_DDL`) has:

```sql
share_type TEXT NOT NULL CHECK (share_type IN ('video', 'game', 'annotation_playback', 'collection'))
```

Inserting `'game_link'` VIOLATES this CHECK constraint (`shares_share_type_check`). This is a hard
STOP for the "no DDL expected" assumption in the task file. Required changes (BOTH, per the
schema-change workflow — CLAUDE.md § Migration System):
1. **New Postgres migration** `migrations/postgres/v0NN_game_link_share_type.py` following the exact
   `v003_annotation_playback_share_type.py` / `v016_collection_shares.py` template (DROP CONSTRAINT
   IF EXISTS + ADD CONSTRAINT with `('video','game','annotation_playback','collection',
   'game_link')`). Highest current PG version is v018 (backend-services.md) — the Implementor
   confirms the next free number at implementation time.
2. **Update `_SCHEMA_DDL` in `pg.py`** to include `'game_link'` in the CHECK list (fresh
   deployments). Both, always.

Also update `SHARE_TYPE_TO_CHANNEL` (sharing_db.py:483) — see §4 (behavior, not just DDL). No data
backfill: existing rows are unaffected by widening the allowed set.

**→ Flag: this task REQUIRES the Migration agent in classification.** (Postgres CHECK-constraint
edit + `_SCHEMA_DDL` update; migrations do not auto-run — admin triggers `POST /api/admin/migrate`
after deploy, BEFORE the create endpoint is exercised in prod.)

---

## 4. The `share_type` membership audit

Every site that tests `share_type in (...)` / `== …` (grepped across `src/backend/app`). For each,
does `game_link` belong?

| # | File:line | The test | Current values | `game_link`? | Why |
|---|---|---|---|---|---|
| 1 | `shares.py:382` (`get_shared_teammate`) | `share_type not in ("game","annotation_playback")` → 404 | game, annotation_playback | **N** | game_link must NOT resolve through the per-recipient teammate endpoint (that path can carry `game_blake3`/`video_warm_url` — the exact leak §2 forbids). game_link resolves ONLY through the new `/api/shared/game/{token}`. |
| 2 | `shares.py:569` (`get_shared_teammate_poster`) | `share_type not in ("game","annotation_playback")` → 404 | game, annotation_playback | **N** | game_link uses its OWN poster proxy (`/api/shared/game/{token}/poster.jpg`) with the `_team` key. Adding it here would serve the athlete/unsuffixed poster — wrong layer. |
| 3 | `sharing_db.py:260` (`get_collection_share_by_token`) | `WHERE share_type = 'collection'` | collection | **N** | collection-only lookup; irrelevant. |
| 4 | `sharing_db.py:464` (`cleanup_old_shares`) | `s.share_type = 'game'` (materialized+aged delete) | game | **N (deliberate)** | game_link has no recipient/materialization lifecycle; it lives until revoked (EPIC decision 6). It must NOT be swept by the materialized-share cleanup. |
| 5 | `sharing_db.py:469` (`cleanup_old_shares`) | `share_type = 'video'` (aged delete) | video | **N** | Same as #4 — never auto-delete a live public link. |
| 6 | `sharing_db.py:483` (`SHARE_TYPE_TO_CHANNEL`) | dict share_type→referral channel | video/game/annotation_playback/collection | **Y** | Add `"game_link": "game_link_share"` so `attribute_from_existing_shares` (L574) + T2910 referral attribution recognize a claimant who arrived via a game link. Attribution keys off `recipient_email` (game_link stores `''`), so this only bites once T5730 records a real recipient — add the key now for greppable completeness. |
| 7 | `materialization.py:673` (`SHARE_TYPE_TO_CHANNEL.get`) | referral channel on materialize | (same dict) | **Y (via #6)** | Same dict; T5730's game_link claim routes here. No change beyond #6. |
| 8 | `games.py:2107`/`:2130` | `s["share_type"] == "annotation_playback"` | annotation_playback | **N** | Unrelated annotation-playback flow. |
| 9 | `email.py:584-590` (`_get_share_url`) | branches on share_type for the URL | video/game/collection | **Deferred (T5740)** | game_link is not emailed (no recipient); the share sheet builds the URL client-side from the create response. Add a `game_link → /shared/game/{token}` branch only if an email path ever links one. Noted, not wired here. |

**Net:** the only behavior-affecting membership edit in THIS task is `SHARE_TYPE_TO_CHANNEL` (#6).
The public-scope bug would hide at #1/#2 — the invariant is that **`game_link` is NEVER added to
those two tuples**; it resolves and posters only through its own dedicated endpoints.

---

## 5. Revocation + expiry semantics

Two independent degradations, each an explicit state (no silent fallback):

**Revocation (sharer gesture → 410 → clean inactive):**
- `DELETE /api/games/{game_id}/share-link` sets `revoked_at` (§1e).
- Resolve → 410; poster proxy → 404; viewed beacon → 204 no-record.
- Edge: upstream 410 is a non-OK status → `loadPublicShare` returns `null` → SPA fallthrough
  (existing T4840 behavior: 403/404/410/5xx all fall through, never cached, `no-store`).
- SPA `SharedGameView` renders a clean **"This link is no longer active"** state on a 410 from its
  own resolve fetch. Never a broken page.
- **Edge cache TTL vs revoke latency:** the T4840 reel edge page uses `SHARE_CACHE_TTL = 600`
  (10 minutes; `functions/shared/[token].js:23`). The cloned game edge page uses the SAME 600s.
  Revoke latency up to 10 min is ACCEPTED and matches reel links exactly (EPIC/task locked).

**Expired game source (recap survives → recap-only playback, NOT a hard block):**
- Do NOT reuse T3970's expired-share hard block for `game_link`. The recap artifacts
  (`recaps/{game_id}_team.mp4` + `_team_clips.json` + poster) live independently of the game source
  and survive expiry (T5710 decision).
- On resolve, presign the TEAM recap key. Game source gone but recap present → the link keeps
  playing — `video_kind` is `recap` (fresh per-layer recap survives) or, for a legacy pre-T5710
  game, `recap_legacy` / `recap_legacy_combined` per T5710's resolution table. Each is an explicit,
  honestly-labelled state.
- Because create ran stitch-on-share (`ensure_recap(...,'team')`), the team recap already exists
  before the link is pasted; later expiry cannot break the link. Expiry only affects CLAIM value
  (T5730 imports annotations without the full-game source), which is out of scope here.

---

## 6. Edge / SPA split

**Edge function `src/frontend/functions/shared/game/[token].js`** (clone of
`functions/shared/[token].js`), server-rendered, zero app bundle. Renders:
- OG/Twitter unfurl: `og:title = "{game_name} — {game_date}"`, `og:type = video.other`,
  `og:video = recap_url` (presigned team recap), `og:image = {poster_url}` (absolutized stable proxy
  path via existing `absolutizePosterUrl`), description/attribution = "filmed by {sharer_name}".
- Muted-autoplay `<video>` playing the team recap (existing `renderSharePage` structure); add the
  team-layer **clip rail** as a static list of `clips[].name`, and swap the reel end-card CTA for the
  **"Add this game to your account"** conversion CTA — see §7.
- Fetches `GET {api}/api/shared/game/{token}` server-side; edge-caches the JSON ONLY when
  `is_public === true && recap_url` (TTL 600s); fires the `/viewed` beacon on EVERY render
  (`waitUntil`), matching T4840.

The edge `loadPublicShare` gate keys its cache on the two-segment path and requires `recap_url` (the
game analog of `video_url`) — a resolve without a recap URL → `null` → SPA fallthrough.

**Every fallthrough path → SPA (`env.ASSETS.fetch(request)`, `no-store`), never a broken page:**
- upstream timeout / network error → SPA
- upstream non-OK (404 unknown, **410 revoked**, 5xx) → SPA (never cached)
- JSON parse failure → SPA
- `is_public !== true` or missing `recap_url` → SPA
- (Any doubt → SPA. Byte-identical to today's direct SPA navigation.)

**Route non-collision:** `/shared/game/{token}` is two segments; the existing single-segment
`[token].js` matcher only matches `/shared/{token}`, and `/shared/collection/*`,
`/shared/teammate/*` are the established two-segment siblings. Confirmed: `public/_redirects` is
`/* /index.html 200`, so any two-segment `/shared/*` the new function doesn't handle reaches the
SPA. No `_redirects` change needed.

**SPA route + view (fallthrough target + in-app viewing):**
- `App.jsx` gains a `gameShareToken` detector mirroring the `collectionShareToken` block
  (App.jsx:366-368): regex `/^\/shared\/game\/([a-f0-9-]+)$/i`, then a render block
  `if (gameShareToken) return <SharedGameView token={gameShareToken} />;` placed beside the existing
  `SharedCollectionView` block (App.jsx:713-716). No auth required.
- **New SPA view component: `SharedGameView.jsx`** (mirrors `SharedCollectionView` / the shared
  player pattern — presentational, fetches its own resolve JSON, renders the team recap player +
  clip rail + attribution + the claim CTA). On a 410 it renders the "link no longer active" state.

**Game-card entry points (`ProjectManager.jsx`):** the card already wires `onShare={() =>
setShareGame(game)}` → `<ShareGameModal>` (ProjectManager.jsx:855, 1150). Add a public-link create +
"Revoke link" affordance to that share surface (share-icon area ~L831/1534 / `ShareGameModal`).
Create calls `POST /api/games/{id}/share-link`; the empty-team-layer 409 surfaces "Tag some team
plays first". Revoke calls `DELETE /api/games/{id}/share-link`. (Exact modal UX is T5740's polish;
this task ships a functional create/copy/revoke.)

---

## 7. The T5730 seam

The CTA ("Add this game to your account") must carry the token toward a claim flow that does NOT
exist yet. This task ships the CTA pointing at signup with the token carried; it does NOT
auto-materialize anything on auth (EPIC decision 8 — claim is a consent moment with an import
dialog; a token→auth→silent-materialize path is explicitly NOT acceptable).

**Exact seam T5730 plugs into:**
- **Claim route (frozen name):** `/claim/game/{token}` — the CTA (edge end-card + SPA view) links
  here. Until T5730 lands, this route falls through to the SPA auth/signup flow with the token
  preserved in the URL; view-only value stands alone.
- **Token carrier:** the token travels as the LAST path segment of the claim route (not a query
  param), so it survives the share→signup→reload the way `SharedAnnotationView`'s `sessionStorage
  'shared_annotation_flow'` already survives (App.jsx:390). T5730 owns reading it post-auth and
  opening the import dialog.
- **Claim DTO (frozen name T5730 will define/consume):** `ClaimGameRequest { share_token: str,
  import_annotations: bool, target_profile_id: str | None }` — the import-annotations opt-in +
  multi-profile athlete selection (EPIC decision 8). NOT built here; named so both epics reference
  the same identifiers (coordinate with Dual-Camera T5500 per EPIC architecture decision 5 —
  whichever lands first owns the token-landing-claim plumbing).
- **Provenance invariant carried forward:** T5730's claim MUST route through
  `materialize_game_share`/`_copy_game`/`_materialize_clips` so copied games/clips get a non-null
  `shared_by` (T5330 NUF-blindness — EPIC architecture decision 2). This task does not touch
  materialization; the note is here so the seam is not implemented in a way that bypasses it.

---

## Risks

| Risk | Mitigation |
|---|---|
| **Public-scope leak** (game-source URL / athlete data reaches anonymous). | Structural DTO with no such field (§2) + a `model_fields` type-assertion test that goes RED on a field ADD, not just a populated leak. Never add `game_link` to the teammate resolve/poster tuples (§4 #1/#2). |
| **DDL missed** → every create 500s on `shares_share_type_check`. | §3 flags Migration agent REQUIRED + `_SCHEMA_DDL` update; migration does not auto-run — admin runs `POST /api/admin/migrate` post-deploy, BEFORE create is exercised. |
| **`warm_recap_poster` warms the wrong (athlete/unsuffixed) poster** for team. | Extend it with a `layer` arg selecting `recap_poster_r2_keys_for_layer` (§1a); default preserves the email-teammate caller. |
| **Edge caches a pre-revoke render** up to 10 min. | Accepted, matches reel links (600s TTL). Only successful public renders cached; 410 never cached (SPA fallthrough, `no-store`). |
| **Reusing the teammate resolve dict** (carries `game_blake3`/`video_warm_url`) out of convenience. | Enforced separation: game_link uses its own `PublicGameLinkResponse` + its own resolve endpoint; the audit forbids adding it to the teammate routes. |
| **Idempotency race** (two rapid creates → two rows). | Single active-link lookup `get_active_game_link_share(game_id, sharer_user_id)` before insert; at most one active `game_link` per game (matches the reel-link precedent). |

---

## Open questions for approval

### OQ-1 (goes to the user — DO NOT resolve here): layer-crossing on the EXISTING per-player teammate share

`_filter_clips_for_tag` (`materialization.py:253`) selects a game's clips by PLAYER TAG:

```sql
SELECT rc.… FROM raw_clips rc
JOIN clip_teammates ct ON ct.clip_id = rc.id
WHERE rc.game_id = ? AND ct.tag_name = ?
```

There is **no `my_athlete` predicate**. So today, if a parent tags a teammate on a **My-Athlete-layer**
clip (`my_athlete = 1`), that clip IS delivered by the email teammate share — a My-Athlete-layer
moment crosses into another family's Team layer. This is the pre-existing email teammate path (EPIC
decision 6 says it "stays untouched"), NOT the new game_link path (game_link is team-recap-only and
cannot leak this).

**The fork:**
- **(A) Make `_filter_clips_for_tag` layer-aware** (add an `AND rc.my_athlete = 0` layer filter):
  the email teammate share then delivers ONLY Team-layer clips, keeping the layer model strict
  end-to-end — a teammate never receives a clip the sharer authored as "my athlete's moment". Cost:
  changes a shipped, working path (EPIC decision 6 said untouched); a parent who deliberately tagged
  a teammate on a My-Athlete clip to share that one moment would silently stop delivering it.
- **(B) Leave it layer-agnostic** (status quo): tagging a teammate on ANY clip stays a deliberate
  per-clip "share this one moment with that family" gesture that legitimately crosses layers — the
  tag IS the sharing intent, independent of which recap layer the clip feeds. The layer model
  governs recaps/reels/the public link; the targeted per-tag email delivery is a separate, older
  job (EPIC decision 6's framing).

**Recommendation: (B) — leave it agnostic.** The player tag is an explicit, targeted gesture with a
named recipient; it is not the broadcast surface. The layer model's job is to keep the public link
and recaps team-pure (which §2 guarantees structurally), not to override a deliberate per-clip send.
Making it layer-aware would silently break the "my kid scored, let me send this to coach" case with
no user-visible reason. But this crosses the strict-one-layer product line, so it is the user's
call — surfaced, not decided.

### OQ-2 (design fork, minor): idempotency enforcement — app-level lookup vs UNIQUE partial index

§3 enforces one-active-link-per-game via a pre-insert lookup (matches the reel-link precedent). A
belt-and-suspenders `UNIQUE INDEX … WHERE share_type='game_link' AND revoked_at IS NULL` can't be a
single-table partial index without denormalizing `game_id` (it lives on `share_games`, not
`shares`). **Recommendation: app-level lookup only** (matches existing reel-link idempotency, no
denormalization, no DDL beyond the CHECK constraint). Raise only if a concurrency test shows a real
race.

---

## What this satisfies

- [x] Anonymous = TEAM RECAP ONLY — structural DTO with no game-source/athlete field (§2); a test
      asserts the model TYPE lacks those fields, red-on-add.
- [x] Links live until revoked; idempotent per game (§3 key); revoked → 410 → edge fallthrough →
      SPA "no longer active" (§5, §6).
- [x] Expired source degrades to recap-only playback (recaps survive; `video_kind` explicit), NOT
      T3970's hard block (§5).
- [x] Stitch-on-share: create calls `ensure_recap(...,'team')` + warms the TEAM poster before
      returning; `status=='empty'` → 409 actionable refusal, NO share row (§1a).
- [x] Never less accessible than today — edge falls through to SPA on ANY doubt (§6).
- [x] No silent fallbacks — revoked (410) / empty (409) / expired (recap-only) each explicit (§1, §5).
- [x] Analytics off the response path — `viewed` beacon + `BackgroundTasks` milestone only (§1b, §1d).
- [x] CTA carries the token toward T5730's claim flow; nothing auto-materializes on auth (§7).
- [x] DDL question answered: **CHECK constraint edit REQUIRED → Migration agent required** (§3).
- [x] `share_type` membership audit complete; the public-scope bug site (teammate resolve/poster) is
      explicitly excluded (§4).
