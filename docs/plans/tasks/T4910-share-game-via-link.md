# T4910: Share a game via link (click-to-claim access + rich link preview)

> **SUPERSEDED (2026-07-21)** by the [Share the Game epic](team-game-share/EPIC.md):
> the link/unfurl/watch half became [T5720](team-game-share/T5720-public-game-link-watch-page.md),
> the claim/materialize half became [T5730](team-game-share/T5730-claim-import-flow.md).
> The T5330 provenance acceptance criterion carries over verbatim into T5730. Do not implement
> from this file.

**Status:** SUPERSEDED
**Impact:** 8
**Complexity:** 6
**Created:** 2026-07-11
**Updated:** 2026-07-11

## Problem

Feature request (user, 2026-07-11): a user should be able to share a **game** via a link. Anyone who clicks the link gets access to that game **in addition to whatever is already in their account** — and if they have no account, they get access to just that game (which becomes their account seed when/if they sign up). The link itself should unfurl with a **preview image of the game and the game's title**.

Today game sharing is targeted, not link-based: `share_game` / teammate shares ([games.py:1699](../../src/backend/app/routers/games.py#L1699), `shares` + `share_games` + `pending_teammate_shares` in Postgres) require the sharer to pick recipients, and reel share links (`/shared/{token}`) are view-only videos. There is no "anyone with the link can claim this game" flow.

## Solution

Link-token game sharing built on the existing share infrastructure (leverage, don't parallel-build):

1. **Link creation** — sharer generates a game share link from the game card/menu. Token-based, modeled on the reel share token pattern in [shares.py](../../src/backend/app/routers/shares.py) and stored in the existing Postgres `shares`/`share_games` family (design decides: new share kind vs new table).
2. **Claim on click** —
   - **Signed-in user**: game is materialized into their active profile using the existing cross-profile game materialization machinery (T2830/T2850 game reference helper: `games` + `game_videos` + `game_storage_refs` insertion; same mechanism the teammate-share accept path uses). Additive — nothing in their account is touched.
   - **No account**: landing on the link shows the game preview + sign-up/sign-in; the claim completes after auth (extend `pending_teammate_shares`-style deferred resolution / the T2915 referral-link snapshot pattern). Decide in design whether a truly anonymous (no-signup) view mode is in scope or the no-account path is "preview page + claim requires signup".
3. **Rich unfurl** — edge-rendered share page for `/shared-game/{token}` (or similar) emitting `og:title` (game title) + `og:image` (game preview frame). Reuse the poster-generation + OG-tag mechanism from T4890 (which lands it for reels first) and the T4840 edge-function pattern in [functions/shared/[token].js](../../src/frontend/functions/shared/%5Btoken%5D.js).
4. **What travels with the game** — per user direction, a shared game carries **Team highlights, not the sharer's "My Player" highlights** (see T4920, which introduces the Team vs My Player highlight layers). Sequencing: T4920's layer model should exist (or at least be designed) before this task freezes what annotation data a claimed game includes.

Storage/expiry: claimed games reference the same R2 source (`games/{blake3}.mp4` scheme, env-prefix-free); design must define expiry semantics for claimants (source expiry sweep interacts — see T4820 learnings: status must track R2 reality).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/games.py` — existing `share_game` (~1699), `share_playback` (~1849)
- `src/backend/app/routers/shares.py` — token share pattern (create/resolve/view beacon)
- `src/backend/app/routers/clips.py` — teammate share accept + `resolve_pending_shares` (~2578): the claim/materialize path to reuse
- `src/backend/app/services/pg.py` — `shares`, `share_games`, `pending_teammate_shares` DDL (~97-140); schema change likely → Migration agent
- `src/frontend/functions/shared/[token].js` — edge share page pattern to clone/extend
- Frontend: game card/menu (share entry point), claim/landing screen

### Related Tasks
- Depends on: T4890 (poster + OG-image mechanism), T4920 (Team vs My Player highlight layers — defines what annotation data a shared game carries)
- Reuses: T2830/T2850 game reference helper (cross-profile game materialization), T2915 link-snapshot pattern (inviter data captured on link, resolved at signup)
- Related: T4850 (transfer reels between profiles) established the sibling-profile R2 media copy pattern

### Technical Notes
- Knowledge docs: [backend-services.md](../../.claude/knowledge/backend-services.md), [annotate.md](../../.claude/knowledge/annotate.md), [persistence-sync.md](../../.claude/knowledge/persistence-sync.md)
- L-tier: schema change + new claim flow + edge page → full staged workflow, Architect design gate.
- Design questions to settle with user: revocation (can the sharer kill the link?), expiry, whether claimants can re-share, and the anonymous-view question above.

## Implementation

### Steps
1. [ ] Architect design doc (claim flow, schema, unfurl page, expiry/revocation) — user approval gate
2. [ ] Backend: token create + claim endpoints (+ migration)
3. [ ] Edge unfurl page with game title + preview image
4. [ ] Frontend: share entry point + claim landing flow (signed-in and no-account paths)
5. [ ] Tests: claim idempotency, no-account deferred claim, unfurl tags

### Progress Log

**2026-07-11**: Task created from user request.

## Acceptance Criteria

- [ ] Sharer can copy a game share link from the app
- [ ] Signed-in recipient clicking the link gets the game added to their account (existing content untouched)
- [ ] Recipient without an account can complete the claim via signup and ends up with (at least) that game
- [ ] Link unfurls with game preview image + game title in chat apps
- [ ] Shared game carries Team highlights (per T4920), not the sharer's My Player highlights
- [ ] Tests pass; migrations written and runnable via admin endpoint
- [ ] **NUF-blindness carries over (T5330):** the claim path MUST route the materialized
      game/clips through `materialize_game_share` (`app/services/materialization.py`) —
      specifically its `_copy_game` / `_materialize_clips` calls — so the copied game and
      any copied clips get a non-null `shared_by` provenance marker (precedence
      `sharer_email -> sharer_user_id -> "lost"`). This is what makes quest_1's DB-derived
      steps (`upload_game`/`add_clip`/`rate_clip`/`annotate_brilliant`,
      `app/routers/quests.py` `_check_all_steps`) invisible to a link-claimed game, exactly
      like an email teammate share. If the claim flow needs a code path that does NOT go
      through `materialize_game_share`, it must independently stamp the same provenance
      marker on the copied game/clip rows — do not ship a claim path that leaves
      `shared_by` NULL for shared-in content, or a link-share recipient will regress to
      T5330's original bug (onboarding silently skipped).
