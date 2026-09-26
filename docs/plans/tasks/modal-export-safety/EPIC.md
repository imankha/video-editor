# Modal Export Safety & Capacity

**Status:** TODO
**Started:** -
**Completed:** -

## Goal

Filed from investigating Bug 58p (production, 2026-09-25): a user with a
16:9, full-frame (uncropped) 14-clip export hit the exact same hard failure 4 times in a row —
`process_clips_ai` (`video_processing.py:2789`, single T4 GPU, `timeout=3600`) ran for exactly
60:00/60:01 every time and was cancelled by Modal's own timeout. Root cause: the crop input for
this project was the full 1920x1080 source frame (no crop reduction), and the GAN-skip gate that
exists specifically for near-1:1-enlargement crops (`should_skip_gan`, T10160) ships INERT
(`GAN_MIN_ENLARGE=0.0`), so every frame paid for a full Real-ESRGAN 4x enhance (~28x more input
pixels than the pipeline's benchmarked default crop) only to be Lanczos-resized back down to
source resolution. There is no chunking/parallelism in this path (unlike
`process_framing_ai_parallel`), so no amount of waiting would have let this job finish.

The user (imankh@gmail.com) got 4 blind hour-long waits with zero feedback on what was wrong or
what to change, before reporting the bug. Credits were correctly auto-refunded each time
(verified against `credit_transactions`), so this epic is entirely about the export experience
and pipeline capacity, not billing.

Closing this epic means: the UI can no longer let a user submit an export Modal cannot finish, a
rejected export tells the user exactly what to change, and the actual ceiling for legitimate
large/uncropped exports is meaningfully higher than it is today.

See [modal-gpu.md](../../../../.claude/knowledge/modal-gpu.md) for `process_clips_ai` /
`should_skip_gan` / GPU-selection background.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T11320 | [Preflight export-size guard](T11320-modal-export-preflight-guard.md) | STAGING |
| T11330 | [Explanatory rejection popup](T11330-modal-export-rejection-popup.md) | STAGING |
| T11340 | [Parallelize multi-clip export across GPUs](T11340-modal-multiclip-parallel-chunking.md) | ICE (deferred) |
| T11350 | [Enable GAN-skip gate for near-1:1 crops](T11350-modal-gan-skip-gate-enable.md) | TODO |
| T11370 | [Calibrate T11320's export-cost-guard constant](T11370-export-cost-guard-calibration.md) | TODO |

Order: T11320 -> T11330 (the popup needs the guard's structured rejection reason to exist first).
T11370 follows T11320's landing (calibrates its uncalibrated cost constant, accepted as a known
risk at landing time per user decision 2026-09-25) and doesn't block anything else in the epic,
but shouldn't sit indefinitely either.

**T11340 deferred 2026-09-26** — the single-clip-editor epic (priority 1.1, underway) is removing
multi-clip export entirely, which cut T11340's design down to "parallelize ONE long clip via
time-chunking." With T11320's guard already turning Bug 58p's silent hour-long failure into a
fast, informative rejection, the user judged that remaining scope (letting a few oversized
single clips succeed instead of being rejected) not worth the complexity it turned out to need
(frame-cadence continuity across chunk seams, speed-segment restrictions, a new Modal deploy).
Full design preserved at
[T11340-design-DEFERRED.md](T11340-design-DEFERRED.md) if revisited.

## Completion Criteria

- [x] A user cannot dispatch a multi-clip export whose estimated GPU-seconds exceeds Modal's
      timeout budget (T11320)
- [x] A rejected export shows a popup naming concrete levers: crop in tighter, reduce clip count /
      split into batches (T11330)
- [ ] ~~Multi-clip export (`process_clips_ai`) can use more than 1 GPU for large jobs~~ — dropped;
      T11340 deferred, not required to close this epic
- [ ] Near-1:1-enlargement crops (like this user's full-frame 16:9 case) skip the GAN pass instead
      of paying for enhance-then-shrink (T11350)
