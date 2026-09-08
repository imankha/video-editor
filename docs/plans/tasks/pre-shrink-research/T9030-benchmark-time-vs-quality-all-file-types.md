# T9030: Benchmark shrink-time + upload-time vs visual quality across ALL file types (with a production file-type survey)

**Status:** TODO
**Impact:** 9
**Complexity:** 6
**Created:** 2026-09-08
**Updated:** 2026-09-08

## Problem

The pre-shrink thesis is a numbers claim: for a given file on a given connection, TOTAL
time (shrink + upload of the shrunk file) must be LOWER than uploading the original, and
the visual quality on the PLAYERS must not be sacrificed. So far we have fragments, all
from one dev laptop and one folder: T8830 measured 1.4-1.5x realtime for 8K HEVC into a
2688 x 1512 @ 12 Mbps target (1080p control 1.9-4.1x); T8832 proved a 17.2 GB stream
decodes at 4.4x realtime with a flat 200 MB heap; the R11 quality A/B moved the default
preset to Sharp at the cost of ~92 min and ~12.6 GB for the 50 GB folder (vs ~45 min /
~6.3 GB); design §4.2 derived a 0.23x economic floor assuming a 20 Mbps uplink. None of
this covers a Trace export, a phone clip, a second machine, or the connection speeds
real users actually have. And nobody has surveyed what production actually uploads
(codecs, resolutions, bitrates, sizes) to weight the matrix by what matters.

## Solution

Two deliverables, both numbers:

1. **Production file-type survey** (no new telemetry): the distribution of uploaded
   files by resolution bucket, fps, duration, size and derived bitrate from per-profile
   `games` rows, joined with the T8838 capability census
   (`capability_impression:shrink_*` rows in `user_actions`) for the share of uploaders
   whose browser can decode/encode each codec family + resolution bucket.
2. **The benchmark matrix**: source type x preset x machine -> shrink wall-clock, output
   bytes, upload time at each target bandwidth (from T8990's buckets), total time vs
   upload-original time, and a quality score on player regions. Weighted by (1), this
   says whether the thesis holds where production lives, not just on the 8K corner case.

Recorded in `docs/plans/research/pre-shrink-benchmark.md` (numbers, method, stills) and
summarized in this epic's EPIC.md. No app code ships.

## Context

### Relevant Files (REQUIRED)
- `scripts/shrink-tool/` - the instrument. `pipeline/presets.js` (`PRESETS.sharp`
  3840-wide 24 Mbps, `PRESETS.small` 1920-wide 7 Mbps, `estimateShrinkSeconds`,
  `REFERENCE_ENCODE_PIXELS_PER_SEC = 185_000_000`, `estimateOutputBytes`),
  `pipeline/probe.js` (`runSpeedProbe`: 120 source frames, timing starts after frame 30,
  reports `realtimeMultiplier` + `pixelsPerSecond`), `tool.js` (per-segment progress
  log, EWMA thermal re-check)
- `scripts/shrink-spike/README.md` - T8830/T8832 numbers and method ("Verdict for
  T8840")
- `docs/plans/tasks/T8840-design.md` - §2.2 estimator, §4.2 economics (why 0.5x/0.25x),
  §9 R7 (`bitrateMode: 'variable'` may undershoot on static footage) and R11 (H.264 vs
  10-bit HEVC at matched bits-per-pixel; source ~0.098 bpp)
- `src/backend/app/database.py` - `games.video_size / video_duration / video_width /
  video_height / video_fps` per profile DB (the survey's raw rows; codec is NOT stored)
- `src/backend/app/analytics.py` (~L570-580) + `src/frontend/src/utils/shrinkCapability.js`
  (beacon vocabulary: `shrink_probe_total`, `shrink_decode_{yes|no|unavailable}_{family}_
  {bucket}`, `shrink_encode_{yes|no|unavailable}`, `shrink_probe_failed`; read via
  `LIKE 'capability_impression:shrink_%'`, platform column present)
- `scripts/analyze_upload_failures.py` - T8990's read-only fleet walk; EXTEND it with the
  survey columns rather than writing a second walker
- `docs/plans/analytics-playbook.md` - aggregates-only conventions
- `docs/plans/research/pre-shrink-benchmark.md` - NEW: the results doc
- Fixtures (never committed): DJI folder (8K HEVC 97 Mbps), Trace/Legends exports (1080p
  4.67 Mbps), phone clip (720p), `formal annotations/test.short/`; Veo if T9020 obtained
  one
- `docs/plans/tasks/upscale-quality/T4700-sr-quality-testbed.md` - the app's planned SR
  quality testbed (PSNR/SSIM/LPIPS + blind A/B). Do NOT build it here; borrow its
  metric choices so the two efforts stay comparable

### Related Tasks
- Depends on: T8990 (target bandwidth buckets + goal statement), T9000 (real Sharp
  timing on two machines; the second machine's row is this benchmark's "ordinary
  laptop" column), T9010/T9020 (crop rects per source, since crop changes output
  pixels and therefore time)
- Blocks: T9040 (the cost model is fitted to these numbers)
- Related: T8950 (credits for high-res sources - output bytes here feed that audit),
  T8838 (census is an input, not something to extend)

### Technical Notes
- **Time model**: the pipeline is encode-bound (T8830 caveat 4), so shrink time keys
  off OUTPUT pixels x fps x duration / `pixelsPerSecond`, not input resolution. Measure
  `pixelsPerSecond` per machine per preset with the tool's own probe and confirm against
  the full-segment wall-clock from T9000 (this also validates the estimator's +/-15%
  bar, R7).
- **Upload time**: computed, not measured, per bandwidth bucket: `bytes * 8 / mbps`.
  Use T8990's buckets. Total = shrink + upload(shrunk) vs upload(original). Report the
  break-even bandwidth per source type: above it, shrinking loses.
- **Quality on players, not whole-frame**: crop a player/ball region from the source
  and from each output at matched viewing size; compute SSIM/VMAF on those regions
  (ffmpeg `libvmaf`/`ssim` filters) AND keep the stills for a blind side-by-side the
  user judges, as done for R11. Whole-frame PSNR on grass rewards blur; do not report
  it alone.
- **Low-bitrate sources**: the Legends export (4.67 Mbps) is already below the Small
  preset's 7 Mbps; re-encoding it can only grow the file or lose quality. Include it in
  the matrix anyway so the cost model has the negative case with numbers, not an
  assumption.
- **Survey**: bitrate = `video_size * 8 / video_duration`; bucket resolution as the
  census does (`deriveResBucket`). Exclude test accounts (imankh prod payment test,
  e2e@test.local, fixture clones). Pair tries and successes where a count is shown.
- Machines: the dev laptop (RTX 4060) and T9000's second machine at minimum; a third
  (integrated GPU Windows laptop) if available. Record CPU/GPU/OS/browser per row.

## Implementation

### Steps
1. [ ] Extend T8990's script with the survey columns; run on prod (read-only); write
   the distribution tables (resolution bucket x bitrate bucket x count; codec family
   capability share from the census).
2. [ ] For each source type and preset (Sharp, Small), on each machine: run the
   tool's probe to get `pixelsPerSecond`; shrink a representative segment end to end;
   record wall-clock, output bytes, estimator error.
3. [ ] Compute upload time per bandwidth bucket and the break-even bandwidth per
   source type; tabulate total time vs upload-original.
4. [ ] Quality: player-region SSIM/VMAF per source x preset + stills for the user's
   blind A/B; record verdicts.
5. [ ] Weight the matrix by the survey; write `docs/plans/research/pre-shrink-benchmark.md`
   and the one-paragraph summary into [EPIC.md](EPIC.md) ("Does the thesis hold, and
   where").

### Progress Log

**2026-09-08**: Filed.

## Acceptance Criteria

- [ ] Production survey tables exist (size/duration/resolution/bitrate distribution +
      census capability share), test accounts excluded, no new telemetry added
- [ ] Benchmark matrix covers every fixture source type x both presets x at least two
      machines with shrink time, output bytes, estimator error, and per-bandwidth total
      time vs upload-original
- [ ] Break-even bandwidth stated per source type
- [ ] Player-region quality scores + stills recorded per source x preset with the
      user's blind verdict
- [ ] `docs/plans/research/pre-shrink-benchmark.md` written; EPIC.md summary states
      whether the thesis holds where production lives
