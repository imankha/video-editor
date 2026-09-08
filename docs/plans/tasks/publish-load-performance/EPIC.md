# Publish Load Performance

**Status:** IN_PROGRESS
**Started:** 2026-09-08

## Goal

The Publish screen (`/home/published`) sits blank for ~4.9s after mount before any reel/game
data renders. User-reported ("Publish takes way too long to fully load"), confirmed by
`published.har` (41 requests, captured 2026-09-08) — [full analysis + waterfall](https://claude.ai/code/artifact/25370533-d3ce-4381-8d31-66feedac679c).
Sequenced **before the Tutorial Redesign group** per user order 2026-09-08, same placement
rule as the Universal Upload & Angles milestone above it.

## What the HAR actually showed

Not video weight — **zero `.mp4` bytes were requested in the whole capture.** The delay is
upstream, in the initial API burst:

- **Stall A (~3.6s):** `GET /api/admin/me`, `/api/health`, `/api/rank/confidence` (×2, one per
  aspect ratio), `/api/collections/summary`, `/api/intro-cards`, `/api/bootstrap` all fire within
  ~20ms of each other and all resolve within ~20ms of each other, 3.6s later. Seven independent,
  data-unrelated endpoints moving in lockstep is not seven slow queries — it's one blocking call
  holding the single uvicorn event loop while the rest queue behind it. `app/utils/offload.py`
  already names this exact shape as the **T6200 HAR fingerprint** (see
  `.claude/knowledge/backend-services.md` § Request concurrency model).
- **Stall B (~0.9s), same shape:** `/api/collections/intro/batch`, `/api/quests/achievements`,
  `/api/collections/summary?sport=soccer`, `/api/storage/warmup` fire right after Stall A
  releases and repeat the pattern.
- Three requests in the same window (an R2 poster JPEG, two Google avatar images) show *real*
  network timings (dns/connect/ssl present, independent completion times) — proof the stall is
  specific to the FastAPI process, not general network slowness.
- `bootstrap.py` was already patched once for this class of bug (T4771 — its user-scoped read
  moved to a worker thread via `run_in_executor`), but its own profile-scoped read
  (`_read_profile_scoped`) still runs directly on the event loop per its own docstring, and none
  of the sibling endpoints in the burst call `run_in_context`/`asyncio.to_thread` either (checked
  `bootstrap.py` — zero hits). The exact blocking call is NOT yet identified; that's T9120's job.

## Confirmed already correct (no task needed)

- **moov-to-front / `+faststart`:** universal across every encoder in the tree (`ai_upscaler`,
  both Modal `video_processing*` modules, `ffmpeg_concat.py`, `auto_export.py`, all three
  `transitions/*`, `multi_clip.py`, `local_processors.py`, `download_metadata.py`), enforced
  pre-upload by `storage.py`'s `FaststartCheck` (logs CRITICAL on a moov-at-end file before it
  ships), and pinned by `tests/test_t7370_mock_encoder_faststart.py` including the CPU-fallback
  mock encoders.
- **"Load less video for previews":** already the design. `TilePreviewVideo.jsx` (T6420/T6820) is
  `preload="none"` at rest, poster-first, and only attaches/streams a source on hover
  (WARM → REVEAL). The HAR's zero video requests is this working as intended.

## Open product decision

`ORDER_BY_RANK` (`collection_metadata.py:53`) sorts the Publish list `rating DESC,
quality_score DESC, created_at DESC` (T3630, the Glicko ranking game) — recency is only the
third tiebreaker, so a reel published minutes ago with an average seeded rating can sort well
below older, higher-rated reels. Whether/how to surface freshness without abandoning the ranking
game is T9140.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T9120 | [Root-cause the Publish page-load event-loop stall](T9120-root-cause-publish-load-stall.md) | WAITING ON USER — root cause confirmed, see file |
| T9130 | [Offload the blocking call(s) found by T9120](T9130-fix-publish-load-stall.md) | TODO — unblocked, concrete spec ready |
| T9140 | [Decide: recency vs. rank order on the Publish list](T9140-recent-reels-vs-rank-order.md) | TODO |

## T9120 verdict (2026-09-08)

Confirmed by **live reproduction against staging** (not static inference): **9 independent
handlers each block the event loop on their own** — not one shared blocking call. Proof: each
handler's own loop-hold, measured in isolation via a ping probe, differs (337ms / 356ms / 265ms /
844ms / 157ms / 123ms / 113ms / 109ms / 68ms), and the concurrent burst's wall time equals the
*sum* of the serial per-handler times rather than the max — a shared cause would show one common
duration, not an additive one. Reproduces on every request, not just cold start (a warm process's
third consecutive burst still stalled 605ms). Full per-handler citations, control experiments
(ruling out GIL/CPU contention and Fly cold start specifically), and T9130's resulting spec are in
[T9120's task file](T9120-root-cause-publish-load-stall.md).

## Completion Criteria

- [ ] T9120's root cause is confirmed (not guessed) and documented
- [ ] Publish page's initial content (games/collections/rank data) renders without the multi-second
      synchronized stall — verified via a fresh HAR capture showing no T6200-shaped burst
- [ ] A direction is picked and shipped (or explicitly declined) for surfacing recently-published
      reels on a rank-ordered list
- [ ] `.claude/knowledge/backend-services.md` § Request concurrency model updated with whatever
      T9120/T9130 find (per CLAUDE.md's knowledge-doc rule: docs are claims, code is truth)
