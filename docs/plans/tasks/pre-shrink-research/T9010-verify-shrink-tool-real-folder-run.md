# T9010: Run T8840's test recipe on the real 50 GB DJI folder and a second machine (T8840's open acceptance)

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-09-08
**Updated:** 2026-09-08

## Problem

T8840 (the standalone browser shrink tool, `scripts/shrink-tool/`) merged in PR #368 with
34/34 unit tests and a 32/32 headless smoke test green, but its ACCEPTANCE was never a
test suite: it is "the user has run the full test recipe on the real 50 GB DJI folder and
on at least one other machine, and says the tool works". That criterion is still open, and
T8840 sits at WAITING ON USER. Every later research task in this epic (auto-crop tuning,
the benchmark, the cost model) needs the numbers that only this run produces - the real
Sharp-preset wall-clock, the real output size, A/V sync by ear, the R11 quality A/B on
real grass/motion/skin, and whether checkpoint/resume survives a real reload.

`formal annotations/u14 adonis/DJII Compressed/` already holds four `*.shrunk.mp4`
outputs (one per DJI segment), so at least one run has produced output - but the README's
"Results per machine" table is still empty, and no verdict is recorded anywhere. Evidence
that is not written down is not evidence.

## Solution

Do NOT re-specify the recipe here. The recipe lives in
`scripts/shrink-tool/README.md` ("The user test recipe") and in the task file
`docs/plans/tasks/universal-upload/T8840-shrink-pipeline-core.md` ("User test recipe" +
"Acceptance Criteria"). This task is the bookkeeping and triage wrapper around the
user's run:

1. The user runs steps 1-7 on the dev laptop and on a second ordinary machine.
2. Each run gets a row in the README results table (machine, browser, steps 1-7 result,
   Sharp time, notes).
3. Every defect found becomes its own task filed into this epic (or into
   Pre-Shrink Integration if it is integration-only), with the reproduction from the run.
4. T8840's acceptance checkboxes are ticked from the recorded rows; its status change
   to DONE remains the user's gesture (board Resolve or `/deploy`) - AI never sets it.

## Context

### Relevant Files (REQUIRED)
- `scripts/shrink-tool/README.md` - the recipe + the empty "Results per machine" table
  (fill it); "Known limitations" section (check each against what the run shows)
- `docs/plans/tasks/universal-upload/T8840-shrink-pipeline-core.md` - acceptance
  criteria to tick; Progress Log to append the run summary to
- `docs/plans/tasks/T8840-design.md` - §4.2 (probe cutoffs 0.5x/0.25x, 4 h comfort
  guard, EWMA thermal re-check), §9 risks R1 (mdat >4 GB at Sharp for the 24-minute
  segment: CHECK the output file is not silently corrupt), R3 (BT.2020/HLG color into
  sRGB canvas), R6 (OPFS quota for ~12.6 GB of Sharp output), R7 (estimator +/-15%),
  R10 (`.LRF` field of view vs `.MP4`), R11 (H.264 vs HEVC quality at matched bpp)
- `scripts/shrink-tool/tool.js` - the page; `autoCropAllSegments` (~L430) runs on
  folder load, so the run also exercises auto-crop (note whether the suggested rects
  looked right - that observation seeds T9020)
- `formal annotations/u14 adonis/ECNL Test - DJI Action 6/` - the real folder (4 x 8K
  HEVC segments + `.LRF` proxies, ~50 GB)
- `formal annotations/u14 adonis/DJII Compressed/` - the four existing shrunk outputs;
  note which preset/version produced them if known, or treat as unrecorded

### Related Tasks
- Depends on: T8840 merged (done, PR #368); nothing else
- Blocks: T9020 (auto-crop tuning runs on the same tool + folder), T9040 (benchmark
  needs the real Sharp timing + output size), and the whole Pre-Shrink Integration epic
  (T8845 starts only after the user's sign-off recorded here)
- Related: T8830 (1.4-1.5x realtime on 8K HEVC, 25 s trim), T8832 (17.2 GB streaming
  decode at 4.4x realtime, flat 200 MB heap), T8834 (faststart 6-15 ms)

### Technical Notes
- The tool needs the repo root served (`npx serve .`) and Chrome; `file://` does not
  work (README "How to run").
- Second machine: any ordinary laptop, ideally integrated GPU and a Mac if available -
  the interesting outcome there is likely `isConfigSupported: false` on 8K 10-bit HEVC
  (capability gate), not "slow" (speed gate). Record whichever it is.
- Sharp is the default preset (EPIC decision 5, amended 2026-09-08 to two tiers,
  Sharp / Small). Expect ~92 min and ~12.6 GB for the full folder on the reference
  laptop (design R11); a large miss on either is a finding, not noise.
- Do not fix defects inside this task. File them. A run that surfaces three bugs is a
  successful run.
- The user's verdict is the acceptance. If the user says "it works", record it and
  tick; if not, record what failed and leave T8840 at WAITING ON USER.

## Implementation

### Steps
1. [ ] Confirm the tool builds and opens from master (`npm install` in
   `scripts/shrink-tool`, `npx serve .` from the repo root).
2. [ ] User runs recipe steps 1-7 on the dev laptop; record a README results row with
   Sharp wall-clock, output bytes per segment, estimator error %, A/V sync verdict,
   crop verdict (incl. whether auto-crop's suggested rects were usable), resume/cancel
   verdict, and any banner text seen (probe verdict, thermal re-check, OPFS quota).
3. [ ] Check design R1 explicitly on the longest segment's Sharp output (24 min at
   24 Mbps exceeds a 32-bit mdat): file plays to the END in a normal player, and
   `ffprobe` reports the full duration.
4. [ ] R11 quality A/B: source frame vs Sharp output at matched viewing size on grass
   texture, motion, skin tones; user judges. Record the verdict and keep the stills.
5. [ ] User repeats on a second machine; record its row (capability or speed verdict).
6. [ ] File one task per defect found; link them in the Progress Log.
7. [ ] Tick T8840's acceptance boxes that the recorded rows prove; append a Progress
   Log entry to T8840 pointing at the README rows. Leave T8840's status to the user.

### Progress Log

**2026-09-08**: Filed to carry T8840's open real-hardware acceptance into the Pre-Shrink
Research epic so nothing dangles. T8840 itself stays WAITING ON USER.

## Acceptance Criteria

- [ ] README "Results per machine" has at least two filled rows (dev laptop + one other
      machine) covering recipe steps 1-7
- [ ] Sharp-preset wall-clock, output size per segment and estimator error are recorded
      (these feed T9040)
- [ ] R1 (mdat >4 GB), R3/R11 (color + compression A/B) and R10 (LRF vs MP4 framing)
      each have a recorded verdict
- [ ] Every defect found is filed as its own task and linked here
- [ ] T8840's acceptance checkboxes reflect the recorded evidence; T8840's status was
      not changed by AI
