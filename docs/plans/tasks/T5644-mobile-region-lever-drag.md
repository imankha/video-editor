# T5644 — Can't drag region begin/end levers on mobile (+ re-added region not persisting)

**Tier:** M · Frontend (overlay timeline). **Model:** Opus.
**HARD RULE (memory: real_browser_for_pointer_fixes):** pointer/touch/drag fixes MUST be verified
in a REAL MOBILE browser (or Playwright with touch emulation + real pointer events). jsdom gives
false confidence — a prior pointer fix (T5380) shipped non-working because it was only jsdom-tested.
Parse Playwright's own summary, not the bash-wrapper exit code.

## Symptom (from the user, on mobile)
In Overlay, after **deleting an overlay region and re-adding it**, the user could **not drag the
begin and end levers** (the region start/end trim handles) on mobile. Two possibly-linked bugs:
1. The begin/end levers don't respond to touch drag on mobile (desktop mouse may work).
2. The re-added region **did not persist** — the backend `[Overlay Data] project=31: 0 regions`
   confirms proj 31 shows 0 regions after the re-add. So either the re-add gesture didn't fire
   the surgical create-region persistence, or it was created then lost.

## Files (own these; isolated from sibling tasks)
- `src/components/timeline/RegionLayer.jsx` — the region + its begin/end lever handles.
- `src/components/timeline/TimelineBase.jsx` — the timeline pointer/drag plumbing.
- `src/hooks/useHighlightRegions.js` — addRegion / restoreRegions / region persistence (the
  re-add-not-persisting half). Confirm the create-region GESTURE fires a surgical backend call
  (`create_region`, `overlay.py:496`) — per CLAUDE.md persistence rules, a gesture must POST the
  single change; a reactive/effect write is banned.

## Investigate
- **Touch drag:** do the levers use `onMouseDown`/`onPointerDown`? On mobile, touch needs
  `onPointerDown` + `touch-action: none` (CSS) on the draggable handle so the browser doesn't
  hijack the gesture for scroll/zoom. Check for `touch-action` and pointer-event capture
  (`setPointerCapture`). This is the most likely root cause of "can't drag on mobile".
- **Re-add persistence:** trace the delete-region -> add-region gesture path. After re-add, is a
  `create_region` POST fired? Does it survive a reload (R2 sync)? The "0 regions" suggests the
  create either didn't persist or was overwritten. Do NOT add a reactive useEffect to persist —
  fix the gesture handler to fire the surgical call (CLAUDE.md: gesture-based, never reactive).

## Acceptance criteria
- Begin and end levers drag smoothly on a real mobile browser (touch), not just desktop mouse.
- Deleting then re-adding a region persists the new region (survives reload; overlay-data shows
  the region), via a surgical gesture call — no reactive persistence.
- No regression to desktop drag or to existing region editing.

## QA (mandatory, REAL MOBILE)
Reproduce on a real mobile browser or Playwright touch emulation: delete a region, re-add it,
drag both levers, reload, confirm the region persists. Live-drive as
`loginAsRealUser(ctx,'imankh@gmail.com','9fa7378c')`. Add/adjust tests for the timeline drag +
the create-region gesture persistence. Map evidence to every acceptance criterion. If you can't
fully verify touch in-harness, say so explicitly and hand the user a precise manual test script.
Update `.claude/knowledge/keyframes-framing.md` if the region model/persistence path changed.
