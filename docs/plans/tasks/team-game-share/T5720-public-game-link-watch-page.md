# T5720: Public game link + edge watch page

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-07-21
**Updated:** 2026-07-21

Task 3 of 5 in the [Share the Game epic](EPIC.md). Absorbs the link/unfurl/watch half of T4910.

## Problem

There is no "drop a link in the team chat" for a game. Game sharing today is email-targeted
(sharer types addresses into a modal) and the recipient landing (`/shared/teammate/{token}`)
is a signup wall — no video plays before auth. Per [EPIC.md](EPIC.md) decision 3, the link
must play the **team recap** instantly with no account.

## Solution

1. **Token link creation** — `POST /api/games/{game_id}/share-link` creates (idempotently
   reuses) a public share: Postgres `shares` row with `share_type='game_link'`,
   `is_public=true`, + a `share_games` row (`game_id, game_name, game_blake3, clip_names`
   filled from the TEAM layer). Model on the public-reel idempotency (`shares.py:275`) and
   `create_game_share` (`sharing_db.py:270`). No recipient emails. `share_type` is TEXT — no
   Postgres DDL expected (confirm no CHECK constraint; if schema changes anyway → Migration
   agent).
2. **Stitch-on-share** — the creation gesture calls T5710's `ensure_recap(game_id, 'team')` +
   warms the team recap poster (T5270 precedent) BEFORE returning the link. Creation fails
   visibly if the team layer has zero clips ("Tag some team plays first" — explicit state,
   not an empty share).
3. **Public resolve endpoint** — `GET /api/shared/game/{token}` (no auth): game title,
   opponent/date, sharer attribution name, presigned team-recap URL, team-layer clip rail
   (names + offsets + player tags), poster URL (stable proxy path
   `/api/shared/game/{token}/poster.jpg`, never presigned in og:image — T5180 rule), and a
   `/viewed` beacon (T4840 pattern). Revoked → 410. Anonymous scope is the TEAM RECAP ONLY —
   no full-game URL leaves this endpoint (epic decision 3).
4. **Edge watch page** — `src/frontend/functions/shared/game/[token].js`, cloned from the
   T4840 reel page: server-side fetch + edge cache (public, TTL under presign lifetime),
   muted-autoplay recap, clip rail, OG tags (`og:title` = "{game name} — {date}", `og:image`
   = team recap poster), attribution line ("filmed by {sharer}'s family"), persistent
   **"Add this game to your account"** CTA + end-card conversion moment. Any doubt →
   SPA fallthrough (never a broken page). The existing single-segment `/shared/{token}`
   matcher does not collide with the two-segment path.
5. **SPA route** — `/shared/game/{token}` in the SPA renders the same watch experience
   (fallthrough target + in-app viewing), reusing the shared player components. The CTA
   routes into T5730's claim flow (until T5730 lands: CTA → auth → game materializes
   WITHOUT the import dialog is NOT acceptable — ship the CTA pointing at signup with the
   token carried, and gate the actual claim on T5730; view-only value stands alone).
6. **Revocation** — game card menu gains "Revoke link" alongside share; revoked links 410 →
   edge fallthrough → SPA shows a clean "link no longer active" state. Expired game source:
   the link keeps playing the recap (recaps survive expiry — epic decision 6).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/shares.py` — new `game_link` create/resolve/poster/viewed routes
  (mirror reel share structure L249/467/545/569)
- `src/backend/app/services/sharing_db.py` — share creation/lookup helpers
  (`create_game_share` L270, public-share idempotency pattern)
- `src/backend/app/routers/games.py` — share-link entry endpoint placement (near `share_game`
  L1698) + expiry interaction (`_compute_storage_status`)
- `src/frontend/functions/shared/game/[token].js` — NEW edge function (clone
  `functions/shared/[token].js`)
- `src/frontend/src/App.jsx` — `/shared/game/{token}` route detection (mirror
  `/shared/teammate` handling L352)
- New SPA view component (mirror `SharedVideoOverlay`/`SharedCollectionView` patterns)
- `src/frontend/src/components/ProjectManager.jsx` — game card share-link + revoke entry
  points (share icon wiring ~L831/1534)
- `src/frontend/public/_redirects` — confirm two-segment shared routes reach the SPA

### Related Tasks
- Depends on: T5710 (`ensure_recap(game_id,'team')` + team poster)
- Blocks: T5730 (claim flow hangs off this page's CTA)
- Coordinate: Dual-Camera T5500 — whichever lands first owns token-landing plumbing (both
  epics record this)
- Prior art: T4840 (edge page + beacon + fallthrough), T4890/T5180/T5270 (poster/OG), T3970
  (expired-game share gating — recap-only degradation supersedes the hard block for this
  share kind)

### Technical Notes
- Knowledge docs: [backend-services.md](../../../.claude/knowledge/backend-services.md)
  (§ Edge), [annotate.md](../../../.claude/knowledge/annotate.md)
- Never make a share less accessible than today → fallthrough on any doubt (T4840 rule).
- Edge cache key by token, public only; revoke latency up to cache TTL is accepted (matches
  reel links).
- Instrumentation hooks (share_created/viewed) land here; full funnel surface is T5740.
- L-tier: new public surface + edge function; Architect design gate for the endpoint shapes +
  anonymous-scope guarantee (no full-game leakage).

## Implementation

### Steps
1. [ ] Architect design: endpoint contracts, share row shape, anonymous-scope guarantee,
       revocation/expiry semantics (user approval gate)
2. [ ] Backend: create (idempotent) + resolve + poster proxy + viewed beacon + revoke
3. [ ] Stitch-on-share wiring (`ensure_recap` + poster warm; zero-team-clips explicit error)
4. [ ] Edge function + SPA route/view + game-card entry points
5. [ ] Tests: idempotent create, revoked 410, anonymous payload contains no full-game URL,
       OG tags, zero-clip refusal; edge fallthrough paths
6. [ ] Real unfurl verify (WhatsApp/iMessage) on staging — poster + title within crawler
       timeout (T5270 gate)

### Progress Log

**2026-07-21**: Created from the epic consolidation (T4910 watch/unfurl half).

## Acceptance Criteria

- [ ] Sharer gets a stable public link per game (idempotent, revocable from the game card)
- [ ] Anonymous visitor: team recap plays on the edge page in T4840-class time; clip rail +
      attribution visible; NO full-game access
- [ ] Link unfurls with team-recap poster + game title/date in chat apps
- [ ] Creation with an empty team layer fails with an actionable message
- [ ] Revoked → clean inactive state; expired source → recap keeps playing
- [ ] share_created/share_viewed recorded per token
