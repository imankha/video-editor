# T4945: Core Stitch + Owner Download

**Status:** TODO
**Impact:** 6 | **Complexity:** 5
**Epic:** [Collection Download](EPIC.md)
**Created:** 2026-07-12 · **Design pass:** 2026-08-10 · **Scope revised:** 2026-08-10

## Problem

User directive during T3950 (2026-07-12): "burn the outro on download — same thing for
compilations, burn them on download." There is no compilation download today: collections (Top
Plays, game highlights, mixes) exist only as client-composited *playback*. No endpoint produces
a single stitched MP4, so there is nothing to burn an outro into.

## Solution

**The Architect's 2026-08-10 audit found the hard part already built — this task is almost
entirely wiring, not new engineering.** `compose_serve_time` (`serve_time_video.py:78`) already
builds `[intro?][video][outro?]` in one non-fatal pass — its own docstring names this exact
seam. The only genuinely new engine call is pre-joining N members into the one file it expects,
via the already-existing `concat_segments` (`ffmpeg_concat.py:200`, in production use since
T5220 for the player-intro/outro paths).

```
stitched.mp4 = [member_1][member_2]...[member_N]      <- concat_segments (this task's only new engine call)
final out.mp4 = [intro?][ stitched.mp4 ][outro?]       <- compose_serve_time (unchanged; existing seam)
```

See [EPIC.md](EPIC.md) for the full resolved-decisions table (all 7 original design questions)
and the shared invariants. This task owns decisions 1, 5, and 7 specifically — decisions 2
(recovery), 4+6 (credits/access), and 3 (caching) are out of scope here, split to the recovery
epic and to T4946/T4947 respectively.

### This task's scope

1. **Endpoint**: `GET /api/collections/download?scope_type&aspect_ratio&game_id?&tags?&budget_sec?`
   — resolve members (`evaluate_collection_members`, rank order) + the collection's own card id
   BEFORE the streaming generator starts (see Gotcha below), then: parallel-fetch members →
   `concat_segments` → `compose_serve_time` (intro=collection card, outro=True) →
   `StreamingResponse` attachment. Read-only over R2 sources throughout; output lives only in a
   per-request temp dir, `rmtree`'d in `finally`.
2. **Compute location — config-gated (Decision 1, revised 2026-08-10)**: check the existing
   `modal_enabled()` flag (`app/services/modal_client.py:327`, env `MODAL_ENABLED` — the SAME
   flag framing/upscaling already branch on) and route accordingly:
   - `MODAL_ENABLED=false` (dev): run `concat_segments`/`compose_serve_time` locally, exactly as
     originally designed.
   - `MODAL_ENABLED=true` (prod): route the stitch through Modal instead. **Not a simple
     call-site branch** — no CPU-only (non-GPU) Modal function exists today; every current
     `modal_functions/video_processing.py` function assumes GPU work. This needs either a new
     lightweight Modal function or confirmation that a GPU-class container is an acceptable cost
     for pure muxing. Flag this to the Architect explicitly when this task is next opened — do
     not assume it's a one-line change.
   - Rationale: the single shared app server (see PLAN.md's Single-Server Priority) shouldn't
     absorb concat/re-encode CPU load for an arbitrary-size collection alongside every other
     user's request, even though no GPU is involved.
3. **Mixed-resolution members (Decision 7, confirmed as originally recommended)**: rely on
   `concat_segments`' built-in mismatch detection + automatic re-encode fallback
   (`ffmpeg_concat.py:238-243`) — no explicit canonical-resolution normalization in this task.
4. **Intro-burn plumbing (Decision 5, confirmed as recommended)**: reuse
   `resolve_intro_for_reel(user_id, profile_id, raw_card_id, total_duration, reel_id=None,
   mode="burn")` (`intro_egress.py:141`) with the collection's own resolved card id — it already
   takes an explicit card id, so it isn't reel-specific in practice. Mirror the card-id
   resolution pattern at `collections.py:782-798` (`get_collection_intro_playback`).
5. **Frontend gesture**: enable the disabled `CollectionHeader.jsx:124` menu item (fix the stale
   T3680 comments while there), thread `onDownload` through `CollectionCard` the same way
   `onShare`/`onCopyLink` already are (`:107-109`), and add a `downloadCollection` action
   mirroring `useDownloads.js::downloadFile:168` (blob → object URL → synthetic `<a>` click, a
   busy flag on the card, no `useEffect`).
6. **Do NOT implement**: any access/permission check beyond what's needed for the endpoint to
   run at all (T4946 owns real gating), any credit charge (T4946), any caching (T4947). Ship
   this task callable only by whatever minimal auth the endpoint needs to not be wide open —
   T4946 is expected to land before this is exposed in a real release.

### Gotcha: the generator runs after the request's DB connection closes

Same T5220 pattern already solved elsewhere in this codebase: resolve the member list,
`total_duration`, the collection's card id, R2 keys, user/profile ids, and the download filename
**before** building the async generator. `resolve_intro_for_reel` opens its own read-only
connection by default (`profile_conn=None`) — correct here, matching the single-reel download.

## Context

### Relevant Files (file:line verified by the 2026-08-10 audit)
- `src/backend/app/services/serve_time_video.py:78` — `compose_serve_time`, call only, no edits
- `src/backend/app/services/ffmpeg_concat.py:200` — `concat_segments`, call only, no edits
- `src/backend/app/services/intro_egress.py:141` — `resolve_intro_for_reel`, call only
- `src/backend/app/routers/collections.py:655` — `evaluate_collection_members`
- `src/backend/app/routers/collections.py:634` — `select_within_budget` (optional budget trim)
- `src/backend/app/routers/collections.py:782-798` — the card-id resolution pattern to mirror
- `src/backend/app/routers/downloads.py:660` — `download_file`, the endpoint template (presign
  + verify → temp → compose → stream → cleanup)
- `src/backend/app/services/modal_client.py:327` — `modal_enabled()`, the flag this task's
  compute-location branch reads
- `src/frontend/src/components/collections/CollectionHeader.jsx:124` — disabled Download menu item
- `src/frontend/src/components/collections/CollectionCard.jsx:88,107-109` — `buildDefinition`,
  existing `onShare`/`onCopyLink` wiring to mirror
- `src/frontend/src/hooks/useDownloads.js:168` — `downloadFile`, the frontend gesture template

### Related Tasks
- Builds on: T3950 (playback-composited outro + download-time burn; the card/concat engine)
- Epic siblings: [T4946](T4946-access-control-and-credits.md) (access + credits, blocks a real
  release of this endpoint), [T4947](T4947-cache-stitched-downloads.md) (caching, depends on
  T4946)
- Reference only, NOT reused: T4140 `_pick_canonical_resolution` (rejected for v1, see EPIC.md
  Decision 7)

## Implementation

### Steps
1. [ ] Backend endpoint (member+card resolve before the generator, parallel member fetch,
       `concat_segments` stitch, `compose_serve_time` compose, streaming response)
2. [ ] `modal_enabled()` compute-location branch — resolve the CPU-only-Modal-function question
       first (see above), this is not a trivial branch
3. [ ] Frontend: enable the menu item, wire the gesture
4. [ ] Tests: order correctness, single outro (never per-member), mixed-resolution produces a
       valid file, non-fatal failure never touches a member source, generator-after-connection
       gotcha covered

## Acceptance Criteria

- [ ] A collection can be downloaded as one MP4 whose segment order matches playback order
- [ ] The file ends with exactly one branded outro; flag off → no outro; one intro card at the
      front when the collection has one, never duplicated per member
- [ ] Mixed-resolution member reels produce a valid stitched file (no corrupt concat)
- [ ] Compute location honors `MODAL_ENABLED` (local ffmpeg when false, Modal-routed when true)
- [ ] Outro/stitch failure never corrupts or loses member reels (read-only over sources)
- [ ] Tests pass
