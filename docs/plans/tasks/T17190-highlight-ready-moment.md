# T17190: Highlight ready: point to it, say you can leave

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

While a highlight sharpens, the progress card says "Time remaining varies." and floats over the preview video; only the coach mentions that the parent may leave. When sharpening finishes while the parent is on Home, the coach says "Every play is finished. Open a game to mark more plays." and lights up Games, pointing away from the highlight the parent just paid for. Done when the parent sees the change described below.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f). The owner agreed in the confusion review (https://claude.ai/artifact/QDjidEXfCW1HuNXby2RYLC, finding U03, U10), and a UX expert review (Fable model, same day) settled the final change below. Screenshots: `qa/qa-pass-2026-11-17/ux/` (local, not in git).

This is a confusion finding the owner agreed to fix, not a breakage, so there are no repro logs.

## Solution

- Progress card: "Sharpening your highlight... 15%. You can leave. It will be in Highlights when it is ready." Show "About N minutes" only from a real estimate; otherwise "Usually a few minutes". Place the card below the video. Drop the word "Generating" (retired by the glossary).
- New Home coach rule that outranks `home.clips.all-done` while the ready message is showing: "Your highlight is ready. Tap Go to Highlights to watch or share it." It pulses and keeps clear "Go to Highlights".

## Relevant Files

Names in the Solution come from the UX expert's code read; otherwise not investigated.

## Acceptance Criteria

- [ ] C1: At 390x844 during a sharpen, the card is below the video and says the parent can leave.
- [ ] C2: When a sharpen finishes on Home, the coach names and lights up "Go to Highlights".
