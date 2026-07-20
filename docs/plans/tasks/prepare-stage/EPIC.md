# Multi-File Ingest & Prep (Large & Messy Footage)

**Status:** TODO (design spike COMPLETE)
**Started:** 2026-07-20
**Aggregate Impact:** 6
**Aggregate Complexity:** 8

## Goal

Let users bring in **large, multi-file, non-Veo footage** (e.g. a 62GB folder of 8K DJI Action
clips) without uploading the raw monster or suffering complexity they don't need. A single game's
"relevant" video drops **50-200x** (50GB to under 1GB) via **edit-on-proxy + manual trim +
conform-crop-from-master**, using a new optional **client-side Prep** stage that only appears for
inputs that demand it.

## Origin & evidence

- User feedback 2026-07-20 (same thread as [T5640](../T5640-framing-rotation-horizon-straighten.md)
  rotation): a 62GB DJI Action 6 folder needs crop/trim/assemble before it's usable; issues (tilt)
  found too late (in Framing); "only make users suffer this complexity if they need to."
- **Empirical study (hands-on ffmpeg + YOLO on the real footage):**
  [research/T5650-dji-8k-ingest-reduction-study.md](../../research/T5650-dji-8k-ingest-reduction-study.md).
  Read it first - it has the measured reduction table, the DJI `.LRF` proxy discovery, the
  intelligent-crop/trim prototype results, the library list, and **the locked design decisions in
  study section 0.**

## Locked design decisions (see study section 0 - do NOT re-derive)

1. **Manual client-side trim** (intelligent auto-trim dropped - headcount/motion can't separate
   warm-up from play; the user knows the junk). Auto-**crop** survives as a Framing assist.
2. **Dual-asset pipeline:** upload BOTH proxy (LRF) + master (MP4). *Proxy drives every
   decision/scrub surface; master supplies every output-pixel surface; upscale only fills the gap.*
   - Annotate + Framing live preview -> **LRF**
   - Framing export/conform -> **MP4** (crop ROI x clip window, native; never whole 8K)
   - AI upscale -> **only when native crop < target** (8K crops are usually already >=1080p, so
     upscale becomes the exception)
3. **New `VideoMode.MULTI_FILE` ("Multiple Files")** beside `PER_GAME`/`PER_HALF` -> folder pick ->
   full-screen client-side **Prep**: assemble (auto-order + drag) -> manual multi-range trim ->
   low-fi **LRF preview** with **"annotate this" markers** (seed Annotate) -> stream-copy
   trim+concat both assets -> resumable dual-asset upload.
4. **Proxy source:** use the shipped camera proxy (DJI `.LRF`, frame-accurate 720p) when present;
   else generate one (client downscale, or server-side after master upload).

## Tasks (dependency order - implement top to bottom)

| ID | Task | Impact | Cmplx | Status |
|----|------|--------|-------|--------|
| T5651 | [Proxy/master asset pairing data model + credit accounting](T5651-proxy-master-data-model.md) | 6 | 5 | TODO |
| T5652 | [`MULTI_FILE` mode + client-side Prep workspace shell](T5652-multifile-mode-prep-shell.md) | 6 | 5 | TODO |
| T5653 | [Client assemble/trim/concat + resumable dual-asset upload](T5653-client-assemble-trim-upload.md) | 7 | 8 | TODO |
| T5654 | [Annotate reads the proxy (LRF)](T5654-annotate-on-proxy.md) | 6 | 4 | TODO |
| T5655 | [Framing conform-from-master + upscale-only-as-needed](T5655-framing-conform-upscale-as-needed.md) | 7 | 6 | TODO |
| T5656 | [Prep markers -> Annotate clip candidates](T5656-prep-markers-to-annotate.md) | 5 | 4 | TODO |
| T5657 | [Fisheye de-warp + horizon level](T5657-fisheye-dewarp-level.md) | 5 | 6 | TODO |

## Completion Criteria

- [ ] A user can pick a folder of large 8K clips, trim/assemble/mark in a client-side Prep stage,
      and create a game without uploading the raw footage.
- [ ] Annotate runs on the proxy; Framing conforms crops from the master; upscale runs only when
      the native crop is below target.
- [ ] Measured: a real multi-file 8K game uploads at <1GB of relevant video (50-200x reduction).
- [ ] Clean single-file (Veo) uploads are byte-identical to today's flow (zero added friction).
- [ ] Prep markers arrive in Annotate as pre-seeded clip candidates.
