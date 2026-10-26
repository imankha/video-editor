# T13390: Annotate guide ignores a failed game upload and shades the Retry upload banner

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Tier:** S (frontend guide rules)
**Created:** 2026-10-25
**Updated:** 2026-10-25
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-10-25 ([RESULTS.md section 11](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)). Screenshots are local only (`r3-*.png` under `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/` on the host that ran the walk).

## Problem

With every write to storage blocked, a new game upload now fails visibly (T13010 holds: a red "Upload failed" banner with Retry upload, a toast with Retry and Dismiss, and no credits charged, 99 before and after). But the Annotate guide keeps saying "Tap Play to watch the game ... tap Mark play", pulses Play and Mark play, and the shade dims the failure banner and its Retry upload button. `GUIDE_PULSE.UPLOAD_RETRY` exists, but no Annotate rule uses it. Seen at 1440 (r3-upload-failed-1440). The failed games stay on the account as pending uploads (ids 8 and 9 on the staging e2e account, hidden from Home).

## Solution

Add an Annotate rule that outranks the watch rules when the open game's upload has failed: one sentence naming Retry upload, pulsing it, with the banner kept clear.

## Context

### Relevant Files
- `src/frontend/src/components/instructions/resolveGuide.js` (annotate rules, the `uploading` fact)
- `useIsGameUploading` and the upload store (failed state)
- `.claude/knowledge/guidance.md` invariant 8 (uploading games)

### Related Tasks
- Found by T12590 (2026-10-25 re-walk); related T13010

## Acceptance Criteria

- [ ] With the open game's upload failed, the Annotate guide names Retry upload and pulses it
- [ ] The failure banner is not shaded
- [ ] A rule test pins the precedence over the watch rules
