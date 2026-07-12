# T3950: "Made with Reel Ballers" Outro on Exports

**Status:** IN PROGRESS
**Impact:** 7
**Complexity:** 5
**Created:** 2026-06-25
**Updated:** 2026-06-25

## Problem

Every reel a parent exports and shares to Instagram/TikTok/WhatsApp is free organic
reach for us — but right now there's nothing on the video that says where it came from.
CapCut's single biggest growth lever is the "Made with CapCut" end card: every shared
clip is an ad. We have the same distribution (T442 Web Share API ships reels straight to
social) with none of the attribution.

## Solution

Append a short branded outro (~1.5–2s) — "Made with Reel Ballers" + logo (+ URL) — to the
end of exported videos, rendered at export time. Must cover both export paths and all
aspect ratios so it looks right wherever the reel is shared:

- **Single-clip / reel export** (the main framing→overlay→export flow)
- **Collection / compilation export** (stitched multi-clip videos)
- **Aspect ratios:** 9:16, 1:1, 16:9 (the outro asset must match the reel's ratio)

The outro is added by the render pipeline (FFmpeg concat), NOT stored in the working
clip/keyframe data — it's a presentation step at export, like a watermark.

## Context

### Relevant Files (REQUIRED)
*(Code Expert to confirm exact functions; these are the entry points.)*
- `src/backend/app/modal_functions/video_processing.py` — Modal/FFmpeg render pipeline (single-clip render + collection/compilation concat). Primary change: append the outro segment before final encode.
- Clip-export finalize path (export worker / `_sync_after_export` area) — where the rendered MP4 is produced and uploaded to R2.
- Collection/compilation export path (the stitched-MP4 render for collections).
- Frontend export trigger (e.g. `useExport` / export button) — only if we add a toggle.
- **New asset(s):** branded end-card source (logo + wordmark), or a programmatic FFmpeg-drawtext/overlay card, rendered/cropped per aspect ratio.

### Related Tasks
- Related: T442 (Web Share API — shared reels go straight to social, so attribution compounds)
- Related: T2680 (we model CapCut's user-upload liability profile; the end card mirrors their growth model too)
- Touches the same render pipeline as the auto-export recap (T1583) — apply consistently if recaps are shared.

### Technical Notes
- **Render-time only, no reactive persistence** (CLAUDE.md): the outro is added during export; do not write it into segments/keyframes or trigger any state write-back.
- **Aspect ratios:** generate or select the matching end-card per ratio; don't letterbox a 16:9 card onto a 9:16 reel.
- **Audio:** the reel's audio should end cleanly; the outro can be silent or a short sting — fade to avoid a hard cut.
- **Duration budget:** for collections that are duration-capped, decide whether the outro counts toward or sits outside the budget (recommend: outside — it's chrome, not content).
- **No double-outro:** ensure re-export / collection-of-already-exported-clips doesn't stack multiple end cards (the outro is added once, at the outermost render).
- **Future hook (out of scope here, note only):** a paid "remove branding" toggle later — keep the outro behind a single flag so it's easy to gate.

## Implementation

### Steps
1. [ ] Decide end-card design + produce the asset(s) per aspect ratio (or a programmatic FFmpeg card).
2. [ ] Add the outro concat to the single-clip / reel render in `video_processing.py`.
3. [ ] Add the outro to the collection / compilation export path (once, at the stitch step).
4. [ ] Handle all three aspect ratios + a clean audio transition.
5. [ ] Guard against double-outro on re-export and collection stitching.

## Acceptance Criteria

- [ ] Exported single-clip reels end with the "Made with Reel Ballers" outro, correct for the reel's aspect ratio.
- [ ] Exported collections/compilations end with exactly one outro.
- [ ] All three aspect ratios (9:16, 1:1, 16:9) render the card correctly (no letterboxing/stretch).
- [ ] No outro data leaks into working clip/keyframe state; it's purely render-time.
- [ ] Existing export tests pass; a test asserts the outro is appended for each path/ratio.

---

## Design Pivot (2026-07-12) — burn-in REJECTED, playback-composited CHOSEN

**User decision:** do NOT burn the card into the exported MP4. Composite it at playback
time on public/shared viewer surfaces. Rationale: no re-encode, no migration, every
existing reel gets attribution for free on next view.

**Approach chosen:**
- `BrandedEndCard.jsx` — single React component (dark bg, wordmark, URL, Replay button),
  only renders when `visible=true`. Prop-gated: never shown in editor/ranker/My Reels.
- `SharedVideoOverlay` — shows BrandedEndCard on `MediaPlayer.onEnded`.
- `SharedCollectionView` — shows BrandedEndCard on `CollectionPlayer.onEnded`; `playerKey`
  remount on Replay resets the sequential story player to index 0.
- Edge function `[token].js` — inline DOM end-card (`#end-card` div) shown via a
  `v.ended` listener; replay clears the class and resets `v.currentTime=0`.
- Gate: `BRANDED_OUTRO_ENABLED` constant in `src/frontend/src/constants/brandedOutro.js`.
- No backend changes, no migration, no ffmpeg dependency.

**Also: download-time burn-in (scope addition 2026-07-12):**
Downloaded files must carry attribution even though playback is composited. Approach:
- `app/services/branded_outro.py` KEPT (not burned into stored final_videos; invoked at serve time)
- `GET /api/downloads/{id}/file` downloads original from R2 → `append_branded_outro(original, out)` → stream result → cleanup in `finally`. Non-fatal: failure logs loudly + serves original (HTTP 200 always).
- Card cached per (width×height, fps, pix_fmt, audio layout) in `/tmp/rb_outro_cards/` (MD5 key, atomic rename). No per-download re-encode after first request for a given resolution.
- Compilation download investigated: NO compilation download path exists in downloads.py — future feature, not wired.
- Gate: `BRANDED_OUTRO_ENABLED` env var (backend, default true) — same flag name as frontend constant.

## Implementation notes (T3950 — original burn-in approach, SUPERSEDED)

**Where the outro is appended — decided WITH EVIDENCE (kickoff instruction).** The
kickoff sketch listed the framing render + multi-clip stitch as append points, but
tracing the pipeline shows those steps produce the intermediate **`working_videos/*`**
object, NOT the published artifact:

- `/api/export/render` (single-clip) and `/api/export/multi-clip` both funnel through
  `multi_clip._export_clips`, which writes a **working video** (`working_videos/…`).
- The overlay step (`/api/export/render-overlay` → `_finalize_overlay_export`, and
  `/api/export/final`) re-renders/copies that working video into the **`final_videos/*`**
  object. Overlay ALWAYS runs before a reel is shareable — the no-keyframes case is a
  copy path, not a skip — and `publish` 404s without a `final_videos` row. Sharing /
  My Reels / downloads read `final_videos` only; a working video is never shared.

So the **final published artifact for every flow is `final_videos/*`**, and the outro is
appended there — exactly once, by the ONE step that produces it. Appending at framing
would (a) pollute the editing preview with a branded card and (b) rely on overlay
faithfully carrying it forward. Appending at the final step is the governing invariant
the kickoff itself named ("the step that produces the FINAL published artifact").

**Append sites (all router-level in `overlay.py`, above the Modal/local dispatch):**

| Flow | Producer of `final_videos/*` | Outro hook |
|------|------------------------------|------------|
| Single- & multi-clip, with highlights | `_run_overlay_export_background` (Modal or local overlay render) | `apply_branded_outro_to_r2_object` on the final key, before `_finalize_overlay_export` |
| No highlights | `render_overlay` no-keyframes R2 copy | same helper on `dest_key` |
| E2E test mode | `render_overlay` test-mode R2 copy | same helper on `dest_key` |
| Frontend-rendered final | `export_final` (`/final`) | `apply_branded_outro_to_bytes` before the single upload |

Because the hook is at the router layer (operating on the R2 `final_videos/*` object /
in-memory bytes), it covers **both Modal and local engines with ZERO Modal edits** — the
concat runs on the Fly backend after the engine returns. **No Modal redeploy is required
for this feature.** (Framing / multi-clip stitch / `video_processing.py` were deliberately
NOT touched.)

**No double-outro / re-export:** re-export re-renders from SOURCE into a NEW working
video (no outro) → NEW final (one outro). Nothing stacks because the working video the
overlay consumes never carries a card. Sync-then-announce (T4110/T4200) is preserved:
the outro rewrite happens BEFORE `_finalize_overlay_export` and the sync gate.

**Card:** programmatic FFmpeg (`branded_outro.py`) — dark card + `drawtext` wordmark +
URL, faded in, ~1.75s, sized per output resolution (wordmark width-constrained so 9:16
doesn't clip), silent audio matching the reel's layout. Bundled font
(`app/assets/fonts/DejaVuSans-Bold.ttf`) referenced by absolute `fontfile=` since the Fly
image ships ffmpeg but no fontconfig fonts. Append is a fast concat-demuxer stream copy
(`-c copy`; only the card is encoded), with a re-encode concat fallback if the copy join
fails validation. Flag: `BRANDED_OUTRO_ENABLED` (env, default true) gates the whole
feature for a future paid branding-removal tier.

**Failure = non-fatal (external-boundary choice):** a card/concat failure logs loudly and
ships the card-less final; the outro must never sink a (possibly paid) export.

**Duration budget:** the outro sits OUTSIDE the recorded `final_videos.duration` (that
column is frozen from working-clip content by `compute_project_metadata`), so the card is
chrome, not counted against duration-capped collections.

**Sweep note:** `auto_export` no longer publishes (T4175 — it drafts); its dormant
`final_videos` writer is intentionally NOT wired for an outro. If the sweep ever publishes
a shareable reel again, it must call the same helper.
