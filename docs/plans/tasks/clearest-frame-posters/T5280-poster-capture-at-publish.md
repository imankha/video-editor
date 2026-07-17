# T5280: Capture the share poster at "Move to My Reels", not at render

**Status:** DONE
**Impact:** 5 | **Complexity:** 3
**Epic:** [Clearest-Frame Posters](EPIC.md) — follow-up; user direction 2026-07-16
**Created:** 2026-07-17

## Problem / Direction

Today the poster JPEG is chosen + extracted + stored at export finalize (render), while the
reel is still a draft. User direction: it should happen **as part of the "Move to My Reels"
gesture (publish)** instead:
- The poster's ONLY consumers are share links / og:image — which cannot exist before publish.
- Drafts that never get published currently pay a pointless ~5-seek ffmpeg cost per render.
- Publish is the established freeze point (T5260 froze the NAME there for the same reason).

## Design (determine at render, capture at publish)

1. **Render keeps the section freeze** (`final_videos.slowmo_section_start/end`, shipped with
   v025): computed from live working clips at finalize — cheap, no ffmpeg. Regen/backfill
   continue to rely on it. Remove ONLY the JPEG extraction/upload from the finalize path.
2. **Publish captures the poster**: in `publish_to_my_reels` (downloads.py ~1207), BEFORE
   `archive_project` runs (working clips still live, but prefer the frozen section columns —
   they're already on the row), call `generate_and_store_poster` for the latest final video and
   store `poster_filename`. Failure NEVER fails publish (same invariant as today's export rule);
   log at info, share page falls back per existing behavior.
3. **Auto-publish paths get the same hook**: the expiry-sweep auto-export (rank raw-clips
   sweep, `source_type='brilliant_clip'`, project_id NULL -> no slow-mo -> first frame) and any
   other code path that sets `published_at` directly must generate the poster at ITS publish
   moment. Grep all `published_at` writers; one shared helper, single write path.
4. **Idempotency**: re-publish (unpublish -> publish again) with an existing poster: overwrite
   at the deterministic key is fine (same policy -> same frame) or skip if present — pick one,
   test it.
5. **In-flight compatibility**: reels rendered before this change already HAVE posters (made at
   render) — publish overwriting with the same policy is a no-op in content. Reels rendered
   AFTER this change but published before it deploys: none (render+publish always brackets a
   deploy in the same code version per env; note it anyway).
6. **Latency**: publish already does archive-to-R2 work; the ~5 ranged seeks add a couple of
   seconds. Run via `asyncio.to_thread` within the request (durable boundary T4110 preserved —
   poster upload completes before the response's durable sync barrier), NOT fire-and-forget.

## Considered and rejected (do not re-litigate)

**In-render capture** (second ffmpeg output emitting the candidate JPEGs during the final
render, where frames are already decoded — computationally ~free): rejected 2026-07-16 (user
decision). Reason: it couples poster policy into BOTH render paths (local ffmpeg + the Modal
GPU command template) forever, to optimize a rare user gesture whose archive step already
does heavier R2 work. Publish-time capture keeps ONE simple greppable path. The R2
presign+seek cost at publish (~2-4s) is accepted.

## Relevant files
- `src/backend/app/routers/export/overlay.py` — REMOVE JPEG capture from finalize (both paths);
  KEEP the slowmo-section freeze
- `src/backend/app/routers/downloads.py` — `publish_to_my_reels` gains the capture (before archive)
- `src/backend/app/services/poster.py` — `generate_and_store_poster` (reuse; may need the
  frozen-section read moved into a helper shared with backfill)
- Expiry-sweep auto-export publisher (grep `published_at` writers) — same hook
- Tests: publish generates poster; render does NOT; auto-export publish generates; poster
  failure doesn't fail publish; re-publish idempotent

## Acceptance criteria
- [ ] Rendering a reel (draft) does NOT extract/store a poster JPEG (section columns still frozen)
- [ ] "Move to My Reels" produces the poster (slow-mo policy via frozen section; first frame
      when none) before the response returns; share link unfurls immediately after publish
- [ ] Expiry-sweep auto-published reels also get posters at their publish moment
- [ ] Poster failure never fails publish (logged)
- [ ] Re-publish is idempotent; existing tests (T4890/T5090 policy math, regen) stay green —
      regen/backfill behavior unchanged

## Classification hint
M-tier, backend-only, ~3-4 files, no schema change (columns already exist via v025). Sequence
AFTER T5270 (both edit poster call sites + the same test files/knowledge doc).
