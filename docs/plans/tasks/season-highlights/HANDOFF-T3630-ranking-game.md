# Handoff — T3630 Reel Ranking GAME (pairwise / Glicko)

Paste the prompt below to an implementing agent. It is self-contained per the epic handoff rules
(reads only the spec + EPIC.md). Branch `feature/T3630-reel-ranking` already exists with the data
foundation committed.

---

## Implementation prompt

```
Implement T3630: Reel Ranking GAME (pairwise comparison + Glicko).

## Getting started (repo state)
- Work on the EXISTING local branch: `git checkout feature/T3630-reel-ranking`
  (it is committed locally but NOT pushed; do not branch off master).
- The data foundation is already on it at commits 6a103eaa + 7c11f3f7 (and docs at 6b4ca42d).
  Read them for the exact committed code: `git show 6a103eaa 7c11f3f7 --stat` then the diffs.
- Backend runs from src/backend with its venv: `cd src/backend && .venv/Scripts/python.exe ...`.
  After backend edits: `.venv/Scripts/python.exe -c "from app.main import app"`.
  Backend tests: `.venv/Scripts/python.exe -m pytest tests/test_reel_ranking.py -q`
  (Postgres-touching suites need local dev Postgres up; see CLAUDE.md).
  Frontend: `cd src/frontend && npm test -- --run` and `npm run build`.
- This is NOT for deploy until all ranking UI is in (UI may still move the schema).

## Epic context
Task 5 of 9 in the Season Highlights & Collections epic. Read, in order:
- docs/plans/tasks/T3630-ranking-game-spec.md   <- AUTHORITATIVE (UI + engine)
- docs/plans/tasks/season-highlights/EPIC.md    <- decisions #3 (ranking), #5 (gesture-only), #13 (summary-first), #14 (mobile)
- CLAUDE.md sections: "Persistence: Gesture-Based, Never Reactive"; "No Silent Fallbacks";
  "Correct Data, Not Workarounds".
The insertion-prompt design in docs/plans/tasks/T3630-design.md is SUPERSEDED by the game spec;
read it only for the data-foundation rationale.

## Already committed on this branch (KEEP, build on)
Commits 6a103eaa + 7c11f3f7:
- profile_db v009 added final_videos.clip_count (single-clip membership; ==1 => collection-eligible),
  quality_score (frozen star), season_rank, + collection_settings table, + backfill from archives.
- quality_score + clip_count stamped at the 3 export-finalize sites (routers/export/overlay.py x2,
  services/auto_export.py) and backfilled (v009). route_collection(game_ids, clip_count) sends
  multi-clip reels to Mixes; adopted in collections_summary, list_downloads, the T3620 resolver.
- ORDER_BY_RANK comparator + frontend mirror src/frontend/src/utils/reelOrder.js.
- POST /api/downloads/{id}/rank (insertion) + useCollections.rankMember (optimistic).
- Tests: tests/test_reel_ranking.py (+ updated test_collections_summary/test_collection_shares).
KEEP all of the clip_count / quality_score / single-clip-membership / freeze-and-backfill work.

## What to change (see spec §5, §6)
1. Revise v009 (UNDEPLOYED — edit in place): DROP season_rank; ADD rating REAL, rd REAL,
   match_count INTEGER DEFAULT 0, source_clip_id INTEGER (frozen raw_clip id, links portrait/
   landscape twins), clip_start_time REAL (frozen, for the 33' timestamp). Update database.py
   fresh-DB schema. Backfill all five (mirror the existing clip_count/quality_score backfill;
   seed rating from quality_score via 1500+(star-3)*40, rd=350, match_count=0; brilliant clips
   recover source_clip_id/start from the live raw_clip else archive else NULL).
2. Stamp rating/rd/match_count/source_clip_id/clip_start_time at the 3 export sites.
3. services/glicko.py: Glicko-1 update (q=0.0057565, RD_MAX=350, RD_MIN=50; each pick = a 1-game
   period; winner score 1 / loser 0; both ratings move, both RD shrink).
4. Endpoints (gesture-based, auth):
   - GET /api/rank/next?aspect_ratio=  -> {a,b}: least-matched single-clip reel of that ratio paired
     with its nearest-rating opponent (no immediate repeat). Each side = identity payload
     (name, opponent+date via games/game_ids, clip_start_time->minute, tags) + stream/presigned URL.
   - POST /api/rank/result {winner_id, loser_id} -> Glicko update + TWIN SYNC: apply to every
     final_videos row sharing source_clip_id; returns {confidence_pct, ranked_count, total}.
   - GET /api/rank/confidence?aspect_ratio= -> banner numbers.
   Remove POST /api/downloads/{id}/rank + its tests.
5. Comparator: ORDER_BY_RANK -> "rating DESC NULLS LAST, quality_score DESC NULLS LAST,
   created_at DESC"; update reelOrder.js to match. (Adoption sites already wired.)
6. Confidence: per-clip c=clamp(1-(rd-RD_MIN)/(RD_MAX-RD_MIN),0,1); per-ratio mean as %.

## Frontend (spec §3, §7)
- components/ranking/ConfidenceBanner.jsx (in DownloadsPanel header): meter + 3 tones + "Rank reels".
- components/ranking/RankingGame.jsx: fetch next pair, two ReelMatchCards + VS, pick (tap winner or
  Pick A/B, NO skip) -> POST result -> sparkle/scale + pop sound + meter tick -> next (prefetch next
  pair). Mobile stacked / Portrait-only; desktop side-by-side with Portrait|Landscape tab
  (responsiveness skill for the width breakpoint).
- components/ranking/ReelMatchCard.jsx: identity card + tap-to-replay (reuse CollectionPlayer single).
- hooks/useRanking.js. Endorphin sound via Web Audio; mute pref persisted (user_settings).

## Rules
- GESTURE-ONLY persistence (EPIC #5): every rating write traces to a pick (POST result). No reactive
  useEffect writes. Pairing/preview is read-only.
- Single-clip only: collections + the game pool = clip_count==1 (route_collection). Multi-clip -> Mixes.
- Mobile-PRIMARY (EPIC #14): >=44px targets; phone = Portrait pool only.
- No silent fallbacks: a published reel missing rating/quality is a seed/backfill gap to surface, not hide.

## Tests (spec §8)
Backend: glicko math; seeding; pairing (least-matched + nearest, no repeat); TWIN SYNC across
source_clip_id; confidence (new clip lowers, matches raise); endpoints; comparator order; v009
backfill of new columns incl. orphaned brilliant clip. Frontend Vitest: reelOrder rating-first;
matchup flow; no-skip; device->ratio gating. E2E (mobile+desktop): play matchups -> confidence rises
-> a collection reorders.

## Deploy
profile_db v009 (revised). DO NOT deploy until ALL ranking UI is in (user directive; UI may still
move the schema). Then: merge -> staging POST /api/admin/migrate (per-user SQLite sweep) -> verify -> prod.

## Workflow
Classify (Frontend+Backend+Database; Migration agent for v009; Reviewer for persistence scrutiny),
then implement to the spec. Run cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"
after backend edits; cd src/frontend && npm run build before finishing.
```
