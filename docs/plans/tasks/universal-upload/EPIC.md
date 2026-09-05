# Universal Upload & Angles

**Status:** IN_PROGRESS
**Started:** 2026-09-05

## Goal

Replace the Per Game / Per Half upload with one universal intake (any number of files or a
whole camera folder, auto-ordered on the timeline), offer a client-side shrink step (crop +
re-encode) for huge camera files, and support OVERLAPPING footage (sideline phone clips
during the main camera's game) as switchable "angles" in Annotate, including adding footage
from inside Annotate.

**Full approved concept with mockups and real-footage analysis:**
https://claude.ai/code/artifact/3a4411ea-3034-4235-a6fe-078f73b61e9b
(sections 01-06 = intake + shrink; 07-09 = overlap/angles; 10 = rollout. The mockup copy
strings in the artifact are the approved microcopy - use them verbatim unless a task file
overrides.)

## Evidence base (real files, all probed 2026-09-05)

| Sample | What it proves |
|---|---|
| `formal annotations/u14 adonis/ECNL Test - DJI Action 6/` | 4x 8K 10-bit HEVC ~97 Mbps segments (50 GB/game) + `.LRF` 720p proxies. Embedded `creation_time` chains perfectly: segments 1-2 continuous, 9-min halftime gap, segments 3-4 continuous. |
| `formal annotations/u14 phillips/9.20.LEGENDS/` | Trace-camera exports where `creation_time` is the EXPORT time - taken literally the halves overlap by 32 min. Filenames (`1st-half`/`2nd-half`) are the trustworthy signal. |
| `formal annotations/u14 adonis/Capo 8-22-2026/VID_20260905_094101.mp4` | Phone clip: filename date = the COPY date (useless), embedded `creation_time` survived transfer and matches the game weekend. Placement evidence works but needs a user-adjustable escape hatch (clock skew). |

## Settled design decisions (approved with the concept, 2026-09-05)

1. **Ordering rule:** sort by embedded recording time, then sanity-check the chain (each
   segment starts at or after the previous one ends, small tolerance). Chain implies
   overlap -> timestamps are export times -> discard them WHOLESALE and fall back to
   filename heuristics (half words, camera counters, trailing numbers). Neither works ->
   name order + yellow "please check" state. NEVER block submit on ambiguity.
2. **Junk filter:** `.LRF`/`.THM`/`.SRT`/images/hidden files silently excluded, disclosed
   in a quiet gray collapsible line. `.LRF` proxies are kept CLIENT-SIDE as preview
   sources for the shrink crop UI, never uploaded.
3. **Trust-building confirm strip:** chips show their evidence (recorded clock time, or
   filename), gaps render as labeled connectors ("9 min break"), one plain-language trust
   line. Single file = today's exact two-gesture flow, zero new UI (acceptance bar).
4. **Shrink offer threshold:** total selected bytes > `SHRINK_OFFER_MIN_BYTES = 3 GB`.
   Below it the offer never renders. The offer NEVER gates Add Game.
5. **Shrink presets:** Sharpest (~4K-class crop, ~24 Mbps) / Recommended (default,
   ~2.7K-class, ~12 Mbps) / Smallest (1080p-class, ~7 Mbps). Names never expose
   resolution/bitrate. One STATIC crop rect for all segments in v1, verified via a
   filmstrip of per-segment preview frames. Audio copied through, never re-encoded.
6. **Shrink capability gating:** `VideoDecoder.isConfigSupported()` with the file's actual
   codec string decides whether the offer renders at all. Firefox/mobile/unsupported GPUs
   silently get today's plain upload. Mid-shrink failure falls back to uploading originals
   with a toast, never a dead end.
7. **Overlap model:** every video gets `recorded_at` (evidence) + `offset_seconds`
   (canonical position, computed once at attach, changed ONLY by the Fix-timing gesture).
   Lanes/layers are DERIVED at render time (greedy: sort by start, lowest non-overlapping
   lane - provably minimal for intervals), never stored. Lane 0 = backbone, keeps today's
   concatenation math; no overlap anywhere = timeline pixel-identical to today.
8. **Vocabulary:** overlapping footage is an "angle" in ALL user-facing copy. Never
   "lane", "layer", "overlay", "wall-clock", "offset". Angle UI color = violet family
   (only unclaimed color on the Annotate screen).
9. **Coverage extensions: YES.** Where footage exists only on an angle (past backbone end,
   or no main camera at all), the timeline domain grows a hatched "no main camera" stretch
   so the footage is playable/clippable. Inert when everything is lane 0.
10. **Clip model untouched:** a clip is always cut from ONE source video
    (`video_sequence` + file-relative times). Active source is ephemeral view state
    (never persisted). Clips clamp to their source's bounds.
11. **v1 exclusions:** no clip re-assignment between angles; no per-segment crops; no
    audio-fingerprint auto-align; no real game-clock display ("52:10" incl. halftime) -
    the DATA for it ships here, display is a later task.

## Tasks (strict order; each hands to its own agent)

| ID | Task | Status |
|----|------|--------|
| T8800 | [Footage intake logic: probe + order inference](T8800-footage-intake-inference.md) | STAGING |
| T8810 | [Universal dropzone replaces Per Game / Per Half](T8810-universal-dropzone.md) | WIP |
| T8820 | [Confirm strip + reorder editor](T8820-confirm-strip-reorder.md) | TODO |
| T8830 | [Shrink spike: WebCodecs 8K benchmark (go/no-go)](T8830-shrink-spike-benchmark.md) | TODO |
| T8840 | [Shrink pipeline core (worker transcode)](T8840-shrink-pipeline-core.md) | TODO |
| T8850 | [Shrink UI: offer card + crop step + presets](T8850-shrink-ui-crop-step.md) | TODO |
| T8860 | [Shrink upload integration + fallback](T8860-shrink-upload-integration.md) | TODO |
| T8870 | [Overlap schema: recorded_at + offset_seconds](T8870-overlap-schema-placement.md) | TODO |
| T8880 | [Game timeline v2: lanes, backbone, extensions](T8880-game-timeline-lanes.md) | TODO |
| T8890 | [Angle strip UI + source switching](T8890-angle-strip-source-switching.md) | TODO |
| T8900 | [Fix timing: nudge an angle into alignment](T8900-fix-timing-alignment.md) | TODO |
| T8910 | [Add footage from inside Annotate](T8910-add-footage-in-annotate.md) | TODO |

Dependency notes: T8800 -> T8810 -> T8820 complete the intake. T8830 gates T8840/T8850/
T8860 (its verdict can re-scope them). T8870 -> T8880 -> T8890 -> T8900 build angles in
order. T8910 needs T8810 (picker) and benefits from T8870 (placement) - it is last.
If T8830's benchmark says NO-GO for client-side 8K, tasks T8840-T8860 return to the user
for a re-scope decision (server-side alternative is NOT viable - upload is the bottleneck).

## Test fixtures

Use the probed real folders (paths above) for manual verification. For unit tests, DO NOT
commit multi-GB videos: tests build synthetic descriptor lists (name/duration/creation_time
tuples) mirroring the three real cases, recorded in each task file.

## Completion criteria

- [ ] One dropzone ingests 1 file, N files, or a folder; halves toggle deleted
- [ ] DJI folder auto-orders with gap annotation; Legends folder falls back to names
- [ ] A >3 GB upload on a capable browser gets a working crop+preset shrink that uploads
- [ ] Phone clip overlapping the main camera becomes a switchable angle; clips can be cut
      from it; no-overlap games render pixel-identical to before
- [ ] Footage can be added from inside Annotate and lands placed by recorded time
- [ ] Migrations ship for the schema change; knowledge docs updated (annotate.md,
      keyframes-framing.md untouched, persistence-sync.md if sync paths change)
