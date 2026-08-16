# Collection Download (Stitched MP4)

**Status:** COMPLETE — deployed to production 2026-08-16
**Started:** 2026-08-14 (unparked by explicit user decision, ahead of the T5140 reshoot sequencing)
**Completed:** 2026-08-16

## Goal

Collections today exist ONLY as client-side composited *playback* — the player chains member
reels in the browser. Add ONE owner download gesture that serves a collection as a single MP4:
members stitched in rank/playback order, prepended by the collection's ONE resolved intro card
and ending in exactly ONE branded outro. Originating request (T3950 pivot, 2026-07-12): "burn
the outro on download — same thing for compilations."

## Why parked instead of built now

The Architect's design pass (2026-08-10, `/dotask 4945`) found the core mechanism is almost
entirely wiring — `compose_serve_time` and `concat_segments` already do the hard part, reused
unchanged. But the user's review of the resulting 7 open questions surfaced two real
complications the original design didn't carry the weight of:

1. **Compute location has a server-protection dimension, not just a GPU-necessity one** — the
   single shared app server (see `PLAN.md`'s Single-Server Priority) shouldn't absorb concat/
   re-encode CPU load for an arbitrary-size collection. See Decision 1.
2. **The download needs to be recoverable, not just synchronous** — explicitly split into its
   own epic, [collection-download-recovery](../collection-download-recovery/EPIC.md), rather
   than bolted onto this one. See that epic for the deferred scope.

Given that, the user chose to document the full decision set now (so nothing gets re-derived
from scratch later) and defer implementation rather than build against a design that was still
visibly shifting mid-review.

## Design authority

Full mechanism audit, code-level engine inventory (file:line verified), and the original
7-question design pass live in the Architect's working doc — not copied here verbatim; the
table below is the RESOLVED state after the user's 2026-08-10 review, which supersedes it where
they disagree.

**The core reused engines (unchanged by this epic):**
- `compose_serve_time(reel_path, out_path, *, intro=None, outro=True)` — `serve_time_video.py:78`
  — already builds `[intro?][video][outro?]` in one non-fatal pass; its own docstring names this
  exact seam.
- `concat_segments(segments, out_path, probe)` — `ffmpeg_concat.py:200` — the ordered N-segment
  joiner already used by player-intro/outro paths since T5220; detects resolution/pix_fmt
  mismatch upfront and re-encodes automatically rather than producing a corrupt file.
- `evaluate_collection_members` (`collections.py:655`) — members already come back in live
  playback rank order (rating → quality → recency), ratio-scoped.
- `resolve_intro_for_reel(..., mode="burn")` (`intro_egress.py:141`) — takes an EXPLICIT card id,
  so it isn't reel-specific in practice; reused with the collection's own resolved card id.

**Structural guarantee (why a stitch/outro failure can't lose a member reel):** sources are
R2-read-only (presigned GET into a per-request temp dir, never opened for write); output lives
only in that temp dir and is `rmtree`'d after streaming; nothing is inserted into
`final_videos`/`export_jobs` — zero canonical state touched. A failure at any stage degrades the
download (serves the best playable artifact) rather than raising or touching a source.

## Decisions (resolved 2026-08-10)

| # | Question | Resolved | Notes |
|---|----------|----------|-------|
| 1 | Where does the stitch run? | **Config-gated**: local ffmpeg when `MODAL_ENABLED=false`, routed to Modal when `MODAL_ENABLED=true` | Reverses the original "always local, no GPU needed" recommendation. Rationale: on the single-server prod stack, concat/re-encode CPU work competes with every other user's request; Modal isolates it even though no GPU is used. **Reuses the existing `modal_enabled()` flag** (`modal_client.py:327`) — the same local/Modal split framing and upscaling already use, not a new flag. **Open implementation question for whoever picks this up**: no CPU-only (non-GPU) Modal function exists today for pure ffmpeg work — this likely needs a new function in `modal_functions/video_processing.py`, not just a call-site branch. Flag this to the Architect when the task is next opened. |
| 2 | Sync or job-backed? | **Split into a separate epic** — see [collection-download-recovery](../collection-download-recovery/EPIC.md) | User: "Recovery mechanic must be very robust... feel free to make this its own epic." This epic ships the synchronous path first (matches the existing single-reel `download_file` pattern); the recovery epic upgrades it later. |
| 3 | Cache the output? | **Yes — cache, and do not re-charge credits on a cache hit** | See Decision 4 — the "don't re-charge" half only makes sense once the credit model is settled; both land in the same child task (T4947). Key scheme (unchanged from the original recommendation): `collection_downloads/{sha256(member ids + filenames + card id + card content-hash + outro flag + budget_sec)}.mp4`, disposable, HEAD-before-build. |
| 4 | Free or charged? | **RESOLVED 2026-08-14: Free** | The two prior signals genuinely conflicted (Q1 discussion argued for charging to offset server cost; the "Addressed" answer read as accepting free) — resolved by a margin model built from confirmed codebase pricing (`payments.py` credit packs, 1 credit/sec) plus the actual compute shape of a collection download (CPU-only Modal stitch, zero R2 egress fees). At realistic assumptions, a user downloading every collection they have costs the business well under 1 percentage point of margin versus the export that already earned the credits — GPU compute on the original export dominates the cost, not the free re-download. Decision 3's "don't re-charge on a cache hit" is now moot by construction (nothing is ever charged) rather than something to build and not use. |
| 5 | Intro-burn plumbing | **Reuse `resolve_intro_for_reel` with the collection's card id** (as recommended) | User: "ID" (approved as proposed). No new collection-specific burn seam. |
| 6 | Who can download? | **Broader than owner-only**: anyone with permission on the collection, signed in | User: "Anyone with permissions to the clip and who is signed in ... can download." This widens the original "owner-cards-only" recommendation from strict ownership to a permission check — **needs investigation**: does the collection/sharing system already have a collaborator-permission concept beyond the owner, or does "permission" collapse to "owner" in practice today? The "has the credits" half of the original quote is now moot per Decision 4 (free) — this is a permission + sign-in gate only, no credit check. Lands in T4946. |
| 7 | Mixed-resolution members | **Built-in `concat_segments` re-encode fallback, no explicit canonical-resolution picking** (as recommended) | User: "Whatever you think" — deferred to the original recommendation. Reference resolution is the first (top-ranked) member's; correct in all cases, just not always the minimally-rescaled choice. Upgrade path if this proves costly in practice: pass a canonical resolution (T4140's approach) as the concat probe — a one-line change at the call site. |

## Shared invariants (bind every child)

- **Read-only over member sources, always.** No child may write to a `final_videos` object; a
  stitch/outro/cache failure degrades the download, never corrupts or drops a source reel.
- **Gesture-based only.** The download endpoint runs on the explicit download click — no
  reactive persistence, no background pre-generation speculatively.
- **One intro, one outro, always at the whole-stitch boundary** — never per member. This is
  structural (the composer only ever sees one file in), not a rule to remember.
- **No schema/migration for the disposable cache** — R2 key only, no DB row, per Decision 3.

## Tasks

Order = dependency: the mechanism ships first; access control (which gates whether the
mechanism is reachable at all) next; caching last, since it needs the credit model settled.

| ID | Task | Status |
|----|------|--------|
| T4945 | [Core stitch + owner download](T4945-core-stitch-owner-download.md) | DONE |
| T4946 | [Access control (permission + sign-in only, free)](T4946-access-control-and-credits.md) | DONE |
| T4947 | [Cache stitched downloads](T4947-cache-stitched-downloads.md) | DONE |

## Completion Criteria

- [x] A collection can be downloaded as one MP4 whose segment order matches playback order
- [x] The file ends with exactly one branded outro; flag off → no outro; one intro card at the
      front when the collection has one, never per member
- [x] Mixed-resolution member reels produce a valid (non-corrupt) stitched file
- [x] Stitch/outro/cache failure never corrupts or loses a member reel
- [x] Compute location honors `MODAL_ENABLED` — local ffmpeg in dev, Modal-routed in prod
- [x] Access is gated on collection permission + sign-in (free — no credit check, Decision 4)
- [x] Repeat downloads of an unchanged collection serve from cache (no charge to skip — free)
- [x] Tests pass; knowledge doc (`export-pipeline.md`) updated with the new entry point + cache
      key pattern
