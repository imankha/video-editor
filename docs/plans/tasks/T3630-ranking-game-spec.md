# T3630 — Reel Ranking GAME: UI + Engine Spec

**Status:** APPROVED (user, 2026-06-14) — supersedes the insertion-prompt UX in
[T3630-design.md](T3630-design.md).
**Branch:** `feature/T3630-reel-ranking`

This spec replaces the **ranking UX and engine** of T3630 with a gamified **pairwise
comparison** ("this-or-that") model. The DATA foundations already built and committed
(`6a103eaa`, `7c11f3f7`) are largely **kept** — only the rank *mechanic* changes. Read §6
for exactly what to keep vs. revise.

---

## 1. Why (product framing)
Ranking as a **game**, not a hygiene chore. Reels saturate at 5★, so *absolute* ratings carry
little signal — *comparisons* do. The user plays quick A-vs-B rounds; the system converges a
per-clip ranking that drives every highlight collection's order.

Core loop: **publish → new clips lower "Collection Confidence" → play a few rounds → confidence
rises → collections sharpen → repeat.**

## 2. Locked decisions (user, 2026-06-14)
1. **Engine = Glicko** (rating + **RD** = uncertainty), seeded from the frozen star rating.
2. **Confidence %** is derived from aggregate RD. New/unranked clips → high RD → lower confidence;
   playing shrinks RD → confidence climbs (diminishing returns ⇒ not burdensome).
3. **Per-clip rating, shared across ratios.** Rating attaches to the *source clip*; ranking a
   Portrait reel informs its Landscape twin. Two displayed lists (Portrait / Landscape), one
   underlying per-clip rating.
4. **Device rule:** Phone = Portrait list only. Desktop = Portrait **or** Landscape (tab toggle).
5. **No skip — always choose.** Endless sessions; **endorphin cue** (sound on by default + mute,
   card sparkle/scale, live meter tick) on every pick.
6. **Pairing:** least-matched clip first, paired with its **nearest-rating neighbor** (bubble-sort
   feel — neighbors duel, winners float up; also the most informative Glicko matchup).
7. **Identity card:** name · "vs {opponent} · {date}" · **in-match time in soccer notation `33'`** ·
   all tags · tap-to-replay.
8. **Game is the only ranking input** for now (no manual drag/insert; revisit if users ask).
9. Defaults: a clip counts toward the "ranked" count at **≥1 matchup** (Confidence % is the real
   signal); timestamp uses trailing `33'`; pick sound **on** by default with a mute.

## 3. UX surfaces

### 3.1 Gallery banner (top of My Reels)
`ConfidenceBanner` — trophy, **Collection Confidence** meter (ring/bar), "N of M clips ranked",
subtext "Winners lead every highlight collection.", primary **Rank reels →**. Three tones:
- **Early (~8%)**: "Your highlights are picking themselves. Play a few rounds to take control."
- **Mid (~72%)**: standard.
- **Caught up (~96%)**: "Dialed in. New clips will ask for a few matchups when you publish them."
The meter animates on return from a session. Per active ratio (see device rule).

### 3.2 The matchup (the game) — `RankingGame`
Header "Which is better?" + live confidence meter. Two `ReelMatchCard`s separated by **VS**.
- **Mobile:** stacked (A over B), full-width, Portrait pool only.
- **Desktop:** side-by-side, with a **Portrait | Landscape** tab.
- **Pick:** tap the winning card OR a `Pick A`/`Pick B` button (≥44px). **No skip.**
- **On pick:** sparkle + scale on the winner, soft pop sound, meter ticks up, immediately load the
  next pair (snappy; prefetch the next pair during the current one).
- Endless; a gentle "you're caught up for now" state when every clip in the pool has met the
  coverage target and confidence is high.

### 3.3 Reel identity card — `ReelMatchCard`
Tap-to-replay (reuse the presentational `CollectionPlayer` for a single reel) + metadata:
| Field | Example | Source |
|---|---|---|
| Name | Brilliant Dribble | `final_videos.name` |
| Match | vs Carlsbad · Dec 6 | `games.opponent_name` + `game_date` via frozen `game_ids` (single-clip ⇒ one game) |
| In-match time | `33'` | **NEW** frozen `clip_start_time` → `floor(sec/60)+1` |
| Tags | #Dribble #Goal | `final_videos.tags` |

## 4. Engine

### 4.1 Per-clip rating (Glicko-1)
Each single-clip reel carries `rating`, `rd`, `match_count`, keyed by **source clip** so ratio
twins share one value (§4.4).
- **Seed:** `rating = 1500 + (star - 3) * 40` (5★≈1580, 3★≈1500, 1★≈1420); `rd = RD_MAX (350)`;
  `match_count = 0`. (star = frozen `quality_score`; if NULL, rating=1500.)
- **On a result** (treat each pick as a one-game rating period): standard Glicko-1 update of the
  winner (score 1) and loser (score 0) — both `rating` move, both `rd` shrink toward `RD_MIN (~50)`;
  increment both `match_count`. (Formulas: Glickman's Glicko-1; constants `q=0.0057565`,
  `RD_MAX=350`, `RD_MIN=50`. No time-based RD inflation in v1.)

### 4.2 Confidence
- Per clip: `c_i = clamp(1 - (rd_i - RD_MIN)/(RD_MAX - RD_MIN), 0, 1)`.
- **Collection Confidence (per ratio)** = `mean(c_i)` over that ratio's single-clip reels, as %.
- Publishing a clip adds a `rd = RD_MAX` member → mean drops; matches shrink rd → mean rises.

### 4.3 Pairing (server-side, per ratio, single-clip pool)
1. **candidate** = single-clip reel of the active ratio with the **lowest `match_count`** (ties → random).
2. **opponent** = the reel with **rating nearest** the candidate's, excluding the candidate's most
   recent opponent (avoid back-to-back repeats); prefer lower `match_count` on ties.
3. Return `{a, b}` (random A/B order). Both carry full identity-card payload + presigned/stream URL.

### 4.4 Shared-across-ratio rating
Freeze **`source_clip_id`** (the raw_clip id) on `final_videos` at export. A pick updates
`rating/rd/match_count` on **every** `final_videos` row with the same `source_clip_id` (the
Portrait + Landscape twins), so ranking one ratio informs the other. Orphaned reels (no recoverable
source clip) get their own per-reel rating (key = the reel id) — no cross-ratio share, acceptable.

## 5. Data model + backend

### 5.1 Schema — revise the (undeployed) v009 to its final shape
`final_videos` columns (profile_db v009):
| Column | Purpose |
|---|---|
| `clip_count INTEGER` | **KEEP** — single-clip membership (==1 ⇒ collection-eligible) |
| `quality_score REAL` | **KEEP** — frozen star (seeds rating + card display) |
| `rating REAL` | **NEW** — Glicko rating (seeded from star) |
| `rd REAL` | **NEW** — Glicko rating deviation (RD_MAX until matched) |
| `match_count INTEGER DEFAULT 0` | **NEW** |
| `source_clip_id INTEGER` | **NEW** — frozen raw_clip id; links ratio twins |
| `clip_start_time REAL` | **NEW** — frozen in-match start (seconds) for `33'` |
| ~~`season_rank REAL`~~ | **DROP** — replaced by `rating` |
+ `collection_settings(key,value)` table — **KEEP**.

Freeze `rating`/`rd`/`match_count`/`source_clip_id`/`clip_start_time` at the **3 export sites** and
**backfill** in v009 (mirror the clip_count/quality_score backfill; brilliant clips: source_clip_id
+ start from the live raw_clip when present, else archive, else NULL). Seed `rating` from
`quality_score`; `rd=RD_MAX`; `match_count=0`.

### 5.2 Ordering comparator
Replace `ORDER_BY_RANK` with **`rating DESC NULLS LAST, quality_score DESC NULLS LAST, created_at
DESC`** (Glicko first; seed makes it sane before any matches). Keep it in `collection_metadata.py`
and the frontend mirror `reelOrder.js`; adopt in `list_downloads`, `collections_summary`, the T3620
resolver (all already wired to `ORDER_BY_RANK` — just swap the fragment + the JS comparator).

### 5.3 Endpoints (all gesture-based; auth)
- `GET /api/rank/next?aspect_ratio=9:16` → `{a, b}` (least-matched + nearest-rating; single-clip
  pool of that ratio). 204/empty when the pool has <2 rankable clips.
- `POST /api/rank/result` body `{winner_id, loser_id}` → Glicko update + **twin sync** by
  `source_clip_id`; returns `{confidence_pct, ranked_count, total}`.
- `GET /api/rank/confidence?aspect_ratio=9:16` → `{confidence_pct, ranked_count, total}` for the banner.
(Implement a small `services/glicko.py`. Each `result` is one user gesture → middleware R2-syncs.)

### 5.4 Remove the insertion endpoint
Delete `POST /api/downloads/{id}/rank` (insertion + renumber) and its tests; superseded by `result`.

## 6. What to KEEP vs REVISE (from committed `6a103eaa` + `7c11f3f7`)
**KEEP:** `clip_count` single-clip membership + `route_collection`; `quality_score` freeze;
`collection_settings`; single-clip filtering in summary/list/resolver; the freeze-at-export +
archive-backfill pattern; `DownloadItem.clip_count/quality_score`.
**REVISE:** v009 columns (drop `season_rank`; add `rating/rd/match_count/source_clip_id/
clip_start_time`); `ORDER_BY_RANK` → rating-first; `reelOrder.js` → rating-first; remove the
insertion rank endpoint + `useCollections.rankMember` insertion logic.
**ADD:** `services/glicko.py`; the 3 rank endpoints; freeze of `source_clip_id` + `clip_start_time`;
all new frontend (banner, game, card, feedback, device/ratio gating).

## 7. Frontend components
- `components/ranking/ConfidenceBanner.jsx` — meter + CTA in `DownloadsPanel` header.
- `components/ranking/RankingGame.jsx` — screen: fetch next pair, render two cards, handle pick →
  `POST result` → animate → next; prefetch next pair; mobile stacked / desktop side-by-side; ratio
  tab (desktop) / portrait-lock (mobile, via viewport width like the `responsiveness` skill).
- `components/ranking/ReelMatchCard.jsx` — identity + tap-to-replay (CollectionPlayer single).
- `hooks/useRanking.js` — next-pair fetch + prefetch, submit result, confidence state.
- Endorphin: small Web-Audio "pop" + CSS sparkle/scale; mute pref in `user_settings`
  (extend settings endpoint with a `rankSoundEnabled`, or store in `collection_settings`).
- `reelOrder.js` comparator → rating-first.

## 8. Testing
- **Backend:** `glicko.py` update math (deterministic winner/loser deltas; RD shrink); seeding from
  star; pairing (least-matched first, nearest-rating opponent, no immediate repeat); **twin sync**
  (ranking a portrait reel updates its landscape twin by `source_clip_id`); confidence formula
  (new clip lowers it; matches raise it); endpoints (`next` shape, `result` updates + return, empty
  pool); comparator order = rating DESC; v009 backfill of the new columns (incl. orphaned brilliant).
- **Frontend (Vitest):** `reelOrder` rating-first; confidence meter mapping; matchup flow (pick →
  next); no-skip; device→ratio gating.
- **E2E (mobile + desktop):** play several matchups → confidence rises → a collection's order
  changes; portrait-only on a 390px viewport.

## 9. Migration / deploy
profile_db **v009** (revised). After UI is complete: merge → staging `POST /api/admin/migrate`
(needs the per-user SQLite sweep — backfills profile DBs) → verify → prod. **Do NOT deploy until
all ranking UI is in** (user directive — UI work may still move the schema).

## 10. Open / deferred
- Manual "power tool" (drag-reorder / pin) — only if users ask (decision #8).
- Glicko-2 volatility / time-based RD inflation — v1 uses Glicko-1, RD shrinks on matches only.
- "Caught up" coverage target (e.g. every clip ≥ K matches) — tune K during build.
