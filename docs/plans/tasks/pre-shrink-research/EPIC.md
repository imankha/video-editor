# Pre-Shrink Research

**Status:** TODO
**Started:** 2026-09-08
**Impact:** 8 | **Complexity:** 6 (aggregate)

Epic 1 of 2 in the **Video Pre-Shrink** milestone. Epic 2 is
[Pre-Shrink Integration](../pre-shrink-integration/EPIC.md), which does not start until
this epic is complete.

## Goal

Finish the research behind client-side pre-shrink so that integration is a port of a
PROVEN pipeline, not a bet. "Proven" means, with numbers:

1. We know which file-size x connection-speed combinations stop real users uploading,
   and have written the concrete goal the shrink must hit (T8990).
2. The standalone tool (`scripts/shrink-tool/`, T8840) has been run by the user on the
   real 50 GB DJI folder and a second machine, and the run is recorded (T9000).
3. Auto-crop reliably keeps the field + players + ball and drops dead space on the DJI
   footage (T9010), and we know what it does on every other camera source (T9020).
4. Total time (shrink + upload) goes DOWN while player-region quality is NOT sacrificed,
   across all file types, weighted by what production actually uploads (T9030).
5. A cost model says when NOT to shrink and how to pick the output size from a hard
   upload cap and a quality floor (T9040).
6. The crop can follow the play (tweened path) if the numbers justify it (T9050).
7. T8836's two undecided cheap wins are either filed or vetoed (T9060, T9070).

## Milestone goal (filled by T8990)

_Pending T8990._ Format: "A {X} GB game must become uploadable on a {Y} Mbps connection
in under {Z} hours, and the output must stay under {C} GB." Every later task in the
milestone designs toward this line.

## Inputs already in hand (do not re-derive)

| Source | What it settled |
|---|---|
| T8830 | GO WITH CAVEATS: 8K 10-bit HEVC 25 s trim shrinks at 1.4-1.5x realtime (Chrome + Edge) into 2688 x 1512 @ 12 Mbps; 1080p control 1.9-4.1x; encode-bound, not decode-bound |
| T8832 | Real 17.2 GB DJI file: 42,264/42,264 frames decoded at 4.4x realtime, peak JS heap 200.8 MB flat; T1380's faststart view + 32 MB forward chunks is the demux |
| T8834 | `analyzeMp4Faststart` 6-15 ms on 3.3 / 17.2 GB files; client-side moov relocation is invisible |
| T8836 | Decision table: client probe + `stss` index free (16-124 ms); `.LRF` posters 224 ms/frame; DJI metadata tracks 2.7% (folded into T8840 mux); Legends export 4.67 Mbps is below every preset (offer gate now bytes AND bitrate) |
| T8838 | Capability census live: `capability_impression:shrink_*` rows in `user_actions` count decode/encode support by codec family + resolution bucket + platform |
| T8840 (design R11 + EPIC decision 5) | Sharp (3840-wide, 24 Mbps) is the default after a real player-detail A/B; Recommended tier cut; ~92 min / ~12.6 GB for the 50 GB folder on the reference laptop; crop cannot recover width, so the resolution cap is width-driven |
| T8840 design §4.2 | Speed probe bands 0.5x go / 0.25x refuse; 0.23x is the economic floor at 20 Mbps; 4 h comfort guard; EWMA thermal re-check |
| T5650 study §9 | YOLO on the `.LRF` proxy detects the ball in every tested frame (0.16 s/frame); a follow-the-play crop needs a smoother, not a threshold |
| autoCrop.js (b8601797) | Per-cell luminance variance over 8 frames (160 x 90, middle 80%), 24 x 14 grid, 15% threshold, 3% padding, per-segment, automated on folder load |

## Tasks (strict order; each hands to its own agent)

| ID | Task | Impact | Cmplx | Pri | Status |
|----|------|--------|-------|-----|--------|
| T8990 | [Upload-failure analysis: size x speed combinations that stop users (sets the milestone goal)](T8990-upload-failure-size-speed-analysis.md) | 8 | 3 | 2.7 | TODO |
| T9000 | [Run T8840's recipe on the real 50 GB folder + a second machine (T8840's open acceptance)](T9000-verify-shrink-tool-real-folder-run.md) | 8 | 3 | 2.7 | TODO |
| T9010 | [Tune auto-crop on the real DJI folder (sweep + ball-in-frame check)](T9010-tune-auto-crop-dji.md) | 7 | 4 | 1.8 | TODO |
| T9020 | [Trial auto-crop on other camera sources (Trace, Veo, iPhone, fixtures)](T9020-auto-crop-other-camera-sources.md) | 6 | 4 | 1.5 | TODO |
| T9030 | [Benchmark shrink + upload time vs quality across all file types + production survey](T9030-benchmark-time-vs-quality-all-file-types.md) | 9 | 6 | 1.5 | TODO |
| T9040 | [Cost model: when NOT to shrink + size-cap-driven bitrate rule](T9040-cost-model-when-not-to-shrink.md) | 8 | 5 | 1.6 | TODO |
| T9050 | [Tweening auto-crop: keyframed crop path that follows the play](T9050-tweening-auto-crop-follow-the-play.md) | 7 | 7 | 1.0 | TODO |
| T9060 | [Extract the `stss` keyframe index client-side (T8836 row 2)](T9060-stss-keyframe-index-client-side.md) | 4 | 2 | 2.0 | TODO |
| T9070 | [Poster + preview frames from the `.LRF` proxy (T8836 row 3)](T9070-lrf-proxy-poster-frames.md) | 4 | 3 | 1.3 | TODO |

## Why this order

Within an epic, order is dependency and "what defines success first", not raw priority
score:

1. **T8990 first** - it writes the goal line everything else is measured against. A
   benchmark without a target bandwidth and a cost model without a size distribution
   are decoration.
2. **T9000 second** - the tool's real-hardware acceptance is still open; its run
   produces the real Sharp timing, output sizes and quality stills every later task
   cites, and it is the gate for the Integration epic.
3. **T9010 then T9020** - prove the static crop on the footage it was built for, then
   on everything else. Both are preconditions for un-parking the size-cap bitrate idea.
4. **T9030 then T9040** - the numbers (time, bytes, quality per source and machine),
   then the rule fitted to them. T9040 also carries the parked size-cap-driven bitrate
   design.
5. **T9050** - the follow-the-play upgrade is the most complex item and only worth
   doing once the static heuristic's limits are recorded (T9010) and the sources in
   scope are known (T9020).
6. **T9060, T9070** - small, independent, filed provisionally from T8836 rows 2-3; the
   user may veto either. They sit last because nothing on the success path depends on
   them, but they should not dangle in T8836 any longer.

## Shared context for every child task

- **The tool is the instrument.** `scripts/shrink-tool/` is never imported by app code;
  `pipeline/*.js` is DOM-free ESM that T8845 ports mechanically. Any new pipeline logic
  filed here (decision rule, crop path) must keep that boundary (grep-confirmed).
- **Fixtures are real and never committed**: the DJI folder (`formal annotations/u14
  adonis/ECNL Test - DJI Action 6/`), the Legends/Trace exports and phone clip under
  `formal annotations/` (paths in each task). Only small ground-truth JSON and evidence
  tables go into git.
- **No new telemetry.** Production questions are answered from `user_actions`
  (milestones with reasons, `capability_impression:shrink_*` census), per-profile
  `games` / `pending_uploads` rows and the analytics playbook. Aggregates only; pair
  tries with successes; exclude test accounts (imankh prod payment test, e2e@test.local,
  fixture clones).
- **Quality rule (EPIC decision 5, Universal Upload)**: no visible quality loss on the
  player beats minimizing shrink/upload time; quality-neutral optimizations are silent;
  only framing is the user's call. Names never expose resolution/bitrate.
- **Statuses**: T8840 stays WAITING ON USER until the user's own gesture; T8836 stays
  WAITING ON USER until the user confirms or vetoes rows 2-3.
- **Report numbers, not adjectives.** Every task's acceptance names the table it fills.

## Completion Criteria

- [ ] Milestone goal line written above (T8990) with the production cells it rests on
- [ ] T8840's acceptance recorded on two machines (T9000); T8840 promoted by the user
- [ ] Auto-crop evidence tables filled for DJI and every other available source
      (T9010, T9020) with 100% ball-in-rect on DJI
- [ ] `docs/plans/research/pre-shrink-benchmark.md` written; the thesis verdict
      ("time goes down, player quality holds, where") stated per source type (T9030)
- [ ] `decideShrink` decision table in this file with numeric boundaries (T9040)
- [ ] Tweening verdict recorded (T9050): port it, or keep static, with numbers
- [ ] T9060/T9070 either done or vetoed; T8836 step 4 closed either way
- [ ] Hand-off note written for [Pre-Shrink Integration](../pre-shrink-integration/EPIC.md):
      what changed in `pipeline/` since T8840 merged, so the port is scoped correctly
