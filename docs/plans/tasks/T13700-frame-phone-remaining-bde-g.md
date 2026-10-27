# T13700: Frame on a phone, remaining items B, D, E, G (follow-up to T13580)

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Tier:** M (frontend layout)
**Created:** 2026-10-27
**Updated:** 2026-10-27
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Why this exists

T13580 (branch `feature/T13580-frame-phone-trim-lane`, commit `7fc7bf86d`) fixed A (bug 21 trim lane scroll), C (bug 23 loading state) and F (bug 26 Escape closes Settings), each with red/green tests. B, D, E and G were NOT fixed: they need a rendered browser to measure, and the dev session could not reach a working Frame screen. Do those here. Reference T13580's task file for the original repro text and screenshots (`BUG-20-landscape-switch-over-preview-844.png`).

## Items (each a separate check, Guidance on)

- **B. Phone landscape, 844x390 (bug 20).** The Guidance switch covers the top of Preview in the right rail, the clock at bottom-left is clipped, the "More room in landscape" tip (`FOCUS_HINTS.COCKPIT_INTRO_TITLE`) covers part of the crop box. Landscape uses the cockpit layout (T10840: cockpit shell covers `UnifiedHeader`), but `GuidanceToggle` is a fixed body-level portal that tracks its header slot every animation frame, so it still paints over the cockpit.
- **D. Rotate hint cut off, 390x844 (bug 24).** `RotateNudge` (`modes/focus/RotateNudge.jsx`) first words of "Optional: rotate your phone for a larger video / Everything here also works upright" are hidden behind the icon. Not reproduced yet: measure the title span against the icon at 390.
- **E. Switch over the crop status icon, 390x844 (bug 25).** Seen in a 390x844 screenshot of the Frame header: the Guidance switch (about 113 px wide, `components/instructions/GuidanceToggle.jsx`) starts at x=260, directly where the green check badge on the crop-status icon ends (x about 227-260), so the two touch or overlap. Same class as T13460. Candidate fixes: narrower phone switch (tighter padding/gap, shorter face) or giving the header slot room; verify with a bounding-box overlap check, not by eye.
- **G. Play starts late with no indicator, 1440x900 (bug 54).** Veo-made game in Frame, press Play: clock stays ~1.3 s for ~25 s with no spinner, then plays. Console: repeated `[VIDEO] Waiting ... (phantom)`. Needs the video buffering state surfaced as a spinner; find where the `(phantom)` wait is logged first.

## Dev-environment traps found (read before trying to reproduce)

- Account `imankh@gmail.com` profile `9fa7378c` on dev: the first Frame draft's source video is expired ("Source video expired"), and the other drafts never reached `.crop-handle` within 15 s while the app sat on its "Loading" screen. Use an account/profile with a draft whose source video is live (a recently uploaded game), via `E2E_REAL_EMAIL` and `E2E_PROFILE_ID`.
- On a phone viewport the Guidance coach shade (`data-testid="guide-shade"`) covers Home and blocks Playwright clicks (so `e2e/helpers/framingDraft.js` `openFramingDraft` times out). Either turn Guidance off for the test account, or click with `locator.dispatchEvent('click')`.
- A cold first load can hold the `#preloader` for a long time; warm the stack first.
- Run live checks with `bash scripts/dev-verify.sh e2e/<spec>` (long: run it in the background, a foreground call over 120 s is cut off).
- Test helpers for overlap checks: read `getBoundingClientRect()` of `guidance-toggle`, `rotate-nudge`, the header status icon, `trim-slowmo-button`; `saveEvidence(page, name)` from `e2e/helpers/qa.js`.

## Relevant files

- `src/frontend/src/components/instructions/GuidanceToggle.jsx` (+ `.phone.test.jsx`, `.follow.test.jsx`)
- `src/frontend/src/modes/focus/RotateNudge.jsx` (+ `__tests__/RotateNudge.test.jsx`)
- `src/frontend/src/modes/FocusModeView.jsx` and `modes/focus/cockpit/` (landscape cockpit)
- `src/frontend/src/config/displayNames.js` (`FOCUS_HINTS`)
- `.claude/knowledge/keyframes-framing.md` (T10840 cockpit, T10850 rotation hints, T11720 locked band)

## Verify the fix (required, before and after)

1. Before: measure each failure at the stated size (bounding boxes / screenshot) and add a test that fails for B, D, E (layout contract) and G (spinner shown while video is waiting).
2. After: rerun on the same draft at the same sizes and attach results.

## Acceptance Criteria

- [ ] B: at 844x390 nothing overlaps (switch, clock, tip vs preview and crop box)
- [ ] D: full hint sentence visible at 390x844
- [ ] E: switch and crop-status icon bounding boxes do not intersect at 390x844
- [ ] G: a spinner shows while Play waits on video buffering
- [ ] Tests fail before, pass after
