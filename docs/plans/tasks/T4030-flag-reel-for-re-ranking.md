# T4030: Flag Reel for Re-Ranking While Watching (Author)

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-06-26
**Updated:** 2026-06-26

## Problem

The ranking game (T3630) only learns from pairwise A-vs-B matchups, and once a clip hits its coverage target it's considered "done" — frozen at its current rating. But the most natural moment a user forms an opinion about a reel's standing is while **watching** a collection ("Top Plays"): "I'm not sure this one belongs this high / this low." Today there's no way to capture that — the only path is to replay the ranking game and hope the clip resurfaces, which it won't once it's marked done.

As the **author** watching my own collection, I want a one-tap way to say **"this reel needs re-ranking"** so the ranker re-opens it: it should re-enter the matchup queue and the ranking progress should drop, because this clip's position is now in question.

> Originated as separate "overrated / underrated" flags. Converged (user, 2026-06-26) to a **single re-rank button** — the direction was the user's reason, not a different mechanic, and a flag must **not** change the rating (see below).

## How the ranker works today (grounding)

Per [rank.py](../../../src/backend/app/routers/rank.py). Per-clip stats on `final_videos` (twin-synced across ratios by `source_clip_id`):

| Stat | Role |
|------|------|
| `rating` | Glicko-1 rating (seeded `1500 + (star-3)*40`). The order. |
| `rd` | Rating deviation = uncertainty. `RD_MAX=350` until matched, shrinks toward `RD_MIN=50` with play. Drives how far a match moves the rating. |
| `match_count` | Matchups played. **The progress/coverage signal.** |
| `source_clip_id` | Links portrait/landscape twins (one shared rating). |

**Progress is driven by `match_count`, not `rd`** — [rank.py:218-228](../../../src/backend/app/routers/rank.py#L218-L228) explicitly replaced the old RD-based confidence with sort-coverage. So:
- Per-clip target `K = clamp(ceil(log2(N)), 3, 8)` (`_target_matchups`).
- A clip **needs ranking** while `match_count < K`; pairing (`_pick_pair`) always picks the **lowest-`match_count`** clip first.
- Progress % = `mean(min(1, match_count/K))`; game is **done** (banner 100%, `/next` -> 204) when every clip has `match_count >= K` (`_fully_sorted`).

## Solution

A flag is a **gesture** that re-opens a reel for ranking by writing to the existing per-clip state — twin-synced by `source_clip_id`, exactly like `/api/rank/result`/`/restore`. Decisions (user, 2026-06-26):

1. **Single button** — "Re-rank this" (no overrated/underrated split).
2. **Do NOT change `rating`** — the current rating stays as the prior; the user is saying "I'm unsure," not "move it."
3. **Invalidate confidence** — re-inflate `rd` toward `RD_MAX` so the next matchups actually move the rating instead of it being locked in.
4. **Reduce ranker progress** — drop `match_count` below `K` (to 0) so the clip re-enters `/next` as the first candidate and the Confidence banner % falls.

This stays fully inside the model: Glicko produces order, `match_count` drives coverage + pairing, every write traces to an explicit gesture (EPIC #5, no reactive persistence). It does **not** reintroduce manual drag/insert (decision #8) — the flag tells the *game* to re-rank, it never sets a position.

### Backend — new endpoint

`POST /api/rank/reopen` body `{final_video_id}` in [rank.py](../../../src/backend/app/routers/rank.py):

- Load the reel (`published_at IS NOT NULL`, must carry a `rating` — same 404/400 guards as `rank_result`).
- New state, **rating untouched**:
  - `rd' = RD_MAX`
  - `match_count' = 0`
- Write via a **SET** (not increment) helper across twins. Reuse `_restore_reel`'s shape (it already SETs `rating/rd/match_count` across `source_clip_id`); extract a shared `_set_rating_state(cursor, reel, rating, rd, match_count)` so `_restore_reel` and reopen share one twin-sync write path (DRY). Pass the reel's **current** `rating` through unchanged.
- Return `ConfidenceResponse` for the reel's `aspect_ratio` (same as `/restore`) so the banner updates live.
- Gesture-based -> middleware R2-syncs the profile DB after the authenticated write.

No new constants beyond existing `RD_MAX`. No schema change.

### Frontend — author-only re-rank affordance

In the collection watch surface (story/`CollectionPlayer` playback reached from My Reels / Top Plays), add a single **"Re-rank this"** control (e.g. a small refresh/scales icon + label) visible **only to the author**. Prop-gate it the same way T3940 gated the re-edit button so the **public shared viewer never shows it** (`SharedCollectionView`). On tap -> `POST /api/rank/reopen` -> toast ("We'll re-rank this one") + refresh confidence so the banner reflects the re-opened clip. One tap, no confirm modal; re-tapping is harmless (idempotent — already `rd=RD_MAX`, `match_count=0`).

## Context

### Relevant Files (REQUIRED — confirm with Code Expert)
- `src/backend/app/routers/rank.py` - new `/reopen` endpoint; extract shared `_set_rating_state` from `_restore_reel`
- `src/frontend/src/hooks/useRanking.js` - add `reopenReel(finalVideoId)` + confidence refresh
- `src/frontend/src/components/collections/CollectionPlayer.jsx` *(confirm name/path)* - re-rank control in the watch surface
- `src/frontend/src/components/SharedCollectionView.jsx` - ensure the control is prop-gated OFF for the public viewer
- `src/backend/tests/test_rank.py` *(confirm)* - reopen endpoint tests
- `src/frontend/src/components/ranking/ConfidenceBanner.jsx` - reacts to re-opened confidence (read-only; should already work)

### Related Tasks
- **Builds on:** T3630 (ranking game + Glicko engine + `/api/rank/*`, `final_videos.rating/rd/match_count/source_clip_id`)
- **Reuses pattern from:** T3940 (author-only affordance prop-gated off the public shared viewer); `_restore_reel` twin-sync SET write in rank.py
- **Coordinates with:** any in-flight T3630 follow-ups touching `useRanking.js` / the watch player

### Technical Notes
- **Twin sync is mandatory:** like `result`/`restore`, the reopen must write across all `final_videos` rows sharing `source_clip_id` (portrait/landscape twins). Orphaned reels (NULL `source_clip_id`) update only their own row.
- **Rating is never written by this gesture** — only `rd` and `match_count`. This is the load-bearing correction from the original design.
- **Gesture-only (EPIC #5):** the tap is the write trigger. No `useEffect` watching playback state and writing.
- **No schema change** — reuses existing columns; no migration.
- **Confirm deploy state of T3630** (profile_db v009 / ranking schema) before shipping — don't ship the re-rank trigger ahead of the game it feeds.
- **Single-clip pool only:** multi-clip reels / Mixes never rank — hide the control on Mix playback.

## Implementation

### Steps
1. [ ] Extract `_set_rating_state` twin-sync SET helper in `rank.py`; refactor `_restore_reel` onto it
2. [ ] `POST /api/rank/reopen` endpoint: guards, set `rd=RD_MAX`/`match_count=0` (rating unchanged), twin-sync, return `ConfidenceResponse`
3. [ ] Backend tests: rating UNCHANGED; rd -> RD_MAX; match_count -> 0; twin sync across source_clip_id; reopened clip reappears from `/next`; banner % drops; missing rating -> 400; unpublished/unknown -> 404; idempotent on repeat
4. [ ] `useRanking.reopenReel()` + confidence refresh
5. [ ] Author-only "Re-rank this" control in the watch surface; prop-gate OFF for `SharedCollectionView`; hidden on Mixes
6. [ ] Frontend tests (Vitest): tap calls endpoint; control hidden for non-author/public viewer and for multi-clip reels
7. [ ] E2E: author re-ranks a reel in a collection -> it reappears in `/api/rank/next` and banner confidence drops

## Acceptance Criteria

- [ ] Author can re-rank a reel while watching a collection; public shared viewer cannot see the control
- [ ] Re-ranking leaves `rating` unchanged, sets `rd=RD_MAX` and `match_count=0`
- [ ] The clip reappears in `/api/rank/next` and the Confidence banner % drops (progress reduced)
- [ ] Re-rank is twin-synced across `source_clip_id` (portrait + landscape)
- [ ] Every write traces to the tap gesture (no reactive persistence)
- [ ] Tests pass (backend + frontend unit + E2E)

## Open Questions (for Architect)

1. **Anti-spam / audit:** the gesture is idempotent so spam is harmless, but should a re-rank be recorded anywhere (count, last-reopened-at) for analytics? Default: no — avoids a schema change.
2. **`match_count = 0` vs `< K`:** resetting to 0 forces a full re-rank (K matchups). Resetting to `K-1` would force just one. Default 0 (a flagged clip is genuinely back in question); revisit if it feels heavy.
3. **Multi-clip / Mixes:** confirm the control is hidden on Mix playback (single-clip pool only).
