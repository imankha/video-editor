# T10650: Focus CTA becomes "Back to Preview" when the current framing is already rendered

**Status:** STAGING
**Impact:** 7
**Complexity:** 3
**Created:** 2026-09-19
**Updated:** 2026-09-19
**Tier:** M (frontend only, ~6 files, no schema, one new pure util)

## Problem

User, 2026-09-19:

> If I hit Edit Framing after I already exported the clip, until I make any changes the
> "Generate Framing" button should actually say "Back to Preview" and if I click that, it
> just goes back to the already generated video. Once I make a change I get "Generate
> Framing", but I should still have the option to go back to the preview I already
> generated.

Today every path back into Focus after a render (the completion preview's "Edit framing"
card, the Focus tab in the mode switcher, a draft re-open, a page reload) lands on an action
band whose only primary action is "Generate Framing". The already rendered working video is
sitting on the server and is reachable in one HTTP call (`resolveWorkingVideoPreviewUrl`),
but the UI offers no way back to it. The only way to see your own video again is to pay
credits to re-render byte-identical framing.

Current mechanics, verified 2026-09-19:

- `FocusPublishActionBar`'s tertiary "Edit framing" card calls `FocusScreen.handleRefocus`,
  which only does `closePreview()`. The preview payload in `focusCompletionStore` is
  discarded and nothing can reopen it.
- `FocusScreen` already holds everything needed to reopen it: `openPreview` from
  `focusCompletionStore`, `projectId`, `project`, `projectAspectRatio`, and the render block
  at the bottom of the file is gated purely on
  `completionPreview?.projectId === projectId`.
- The CTA label comes from `EXPORT_JOBS[isFramingMode ? 'framing' : 'overlay'].action` in
  `ExportButtonView.jsx` and has no other state.

## Decisions (user, 2026-09-19)

| # | Question | Ruling |
|---|----------|--------|
| D1 | Where does "Back to Preview" live once framing HAS changed? | Ghost button in the action band's LEFT status cell, beside the primary CTA. Inherits T10630's mobile stacking. |
| D2 | When nothing changed, is "Generate Framing" still reachable? | No. "Back to Preview" fully REPLACES the primary CTA, and the credit-estimate cell is replaced by a "No credits needed" note. Any edit instantly restores "Generate Framing". |

## Solution

### 1. One pure derivation, one greppable module

New `src/frontend/src/utils/framingCtaState.js`:

```js
/** Returns 'generate' | 'preview' plus whether the secondary back-link shows. */
export function deriveFramingCtaState({ workingVideoId, clips, framingChangedSinceExport }) {
  const hasRender = !!workingVideoId;
  // Durable staleness: clips.py creates a NEW working_clips version with
  // exported_at NULL whenever an exported clip's framing is edited, and a freshly
  // added clip starts NULL. So a NULL in the latest-version list means the render
  // does not reflect current framing. This survives a reload; the in-memory
  // framingChangedSinceExport flag does not.
  const hasUnrenderedEdits = Array.isArray(clips) && clips.some((c) => !c.exported_at);
  const stale = framingChangedSinceExport || hasUnrenderedEdits;
  return {
    mode: hasRender && !stale ? 'preview' : 'generate',
    showBackToPreview: hasRender && stale,   // secondary ghost button (D1)
    renderedAt: hasRender ? maxExportedAt(clips) : null,
  };
}
```

No fallbacks: if `clips` is missing, the derivation returns `generate` (today's behavior)
rather than guessing.

### 2. Wiring (MVC, existing seams only)

- `FocusScreen.jsx` calls the derivation (memo over `project?.working_video_id`, `clips`,
  `framingChangedSinceExport`), owns `handleBackToPreview`, and passes new props to
  `FocusModeView`: `framingCtaMode`, `showBackToPreview`, `onBackToPreview`, `renderedAt`.
- `FocusModeView.jsx` threads them into `ExportButtonSection`, which passes them straight to
  `ExportButtonView` (presentational). `ExportButtonContainer` is NOT touched: the new action
  is not an export, and the container must stay mounted so `focusExportButtonRef` keeps
  working for the mode-switch dialog and the payment-return auto-export.
- `handleBackToPreview` (FocusScreen):
  ```js
  const url = await resolveWorkingVideoPreviewUrl(projectId);
  if (!url) { toast.error(FOCUS_PREVIEW.LOAD_FAILED); return; }  // loud, never a silent re-render
  openPreview({ projectId, previewUrl: url, openMode: EDITOR_MODES.FRAMING, jobId: null });
  ```
  A null `jobId` is already a no-op in `acknowledgeCompletionJob`, so reopening an
  acknowledged completion acknowledges nothing. Show a spinner on the button while the URL
  resolves.

### 3. Action band states (`ExportButtonView.jsx`)

| State | Primary CTA | Left status cell | Right cost cell |
|-------|-------------|------------------|-----------------|
| No render yet | "Generate Framing" (today) | today's warnings | credit estimate (today) |
| Render exists, nothing changed | "Back to Preview" | "Rendered {time}" when `renderedAt` is known | "No credits needed" |
| Render exists, framing changed | "Generate Framing" | ghost "Back to Preview" button above today's warnings | credit estimate (today) |
| Exporting (any) | in-progress copy (today) | progress (today), ghost button hidden | today |

All new strings live in `config/displayNames.js` (new `FOCUS_PREVIEW` group). No em dashes in
UI copy.

### 4. The reopened preview behaves exactly like the post-render one

`FocusPublishActionBar` renders unchanged: Add spotlight / Publish without spotlight / Edit
framing / Save draft. That is the correct menu for "here is your rendered video, what now",
and it means this task adds no second preview surface. "Edit framing" closes it again and the
CTA returns to "Back to Preview" because nothing changed.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/FocusScreen.jsx` -- derivation, `handleBackToPreview`, props out (SHARED with T10660, see order below)
- `src/frontend/src/modes/FocusModeView.jsx` -- thread the new props into `ExportButtonSection` -> `ExportButtonView`
- `src/frontend/src/components/ExportButtonView.jsx` -- the CTA state table above
- `src/frontend/src/config/displayNames.js` -- new `FOCUS_PREVIEW` strings
- `src/frontend/src/utils/framingCtaState.js` -- NEW, pure, unit tested
- `src/frontend/src/utils/resolveWorkingVideoPreviewUrl.js` -- read only, reused as-is
- `src/frontend/src/stores/focusCompletionStore.js` -- read only (`openPreview` is the reopen seam)
- `src/frontend/src/stores/focusStore.js` -- read only (`framingChangedSinceExport`, set true by every edit gesture in `FocusContainer.jsx`, reset by the post-export callback)

### Knowledge Docs
- `.claude/knowledge/export-pipeline.md` (working_videos, `export_finalize.upsert_working_video` stamps `working_clips.exported_at`, T4390)
- `.claude/knowledge/keyframes-framing.md` (Focus screen structure)

### Related Tasks
- T8390 / T9285 / T9790: the post-export completion preview this reuses.
- T10630 (merged): `ActionBand` stacks below `sm:`. The ghost button must stack with it.
- T10660: the other half of this report. SHARED FILE `FocusScreen.jsx`, so strict order T10650 then T10660.

### Technical Notes
- **Verify before relying on it:** that BOTH framing export paths stamp `working_clips.exported_at`
  (single clip via `export_worker.process_framing_export`, multi-clip via `multi_clip.py`), per
  export-pipeline.md's T4390 entry. If a path does not stamp, the durable half of the staleness
  check is wrong and the task must fix the stamp, not weaken the check.
- **Known gap, accept and state it:** deleting a clip after a render leaves no
  `exported_at IS NULL` row, so a cold reload would read "not stale". The in-session flag covers
  it while the tab lives. The mitigation is the "Rendered {time}" line, not a heuristic. Do not
  invent a clip-count comparison.
- `exported_at` already ships to the client in `WorkingClipResponse` (`clips.py:1790`), so no API change.
- Persist none of this. It is all derived (no redundant state).

## Acceptance Criteria

1. Render a clip, take "Edit framing" from the completion preview: the primary CTA reads
   "Back to Preview" and the cost cell reads "No credits needed".
2. Clicking it reopens the same preview player with the four-choice action bar, with no render
   and no credit spend (assert: no POST to any `/api/export/*` endpoint).
3. Move a keyframe: the CTA flips to "Generate Framing" within the same gesture, and a ghost
   "Back to Preview" appears in the left cell and still opens the previous render.
4. Reload the page into Focus on a project with a working video and no edits: the CTA reads
   "Back to Preview" (durable path, the in-memory flag is false on a cold load).
5. A project with no working video is byte-identical to today.
6. `resolveWorkingVideoPreviewUrl` returning null shows an error toast and does NOT start a render.
7. At 393x852 the band still stacks per T10630 with the ghost button visible and tappable.

## Test Scope (curated, ~10)
- NEW `utils/framingCtaState.test.js` (the four states plus the missing-clips guard)
- NEW/extended `components/ExportButtonView.test.jsx` (label swap, ghost button, cost cell copy, `onBackToPreview` fires and `onExport` does not)
- `components/ActionBand.test.jsx` (T10630 stacking still holds)
- FocusScreen unit coverage for `handleBackToPreview` including the null URL path
- e2e: extend the existing Focus export spec with re-entry after a render (no new POST)

## Agents
| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | No | Seams are mapped above |
| Architect | No | M-tier, design settled here |
| Tester | No | Curated set above |
| Reviewer | YES | Mandatory M-tier review on the diff |
| Migration | No | No schema change |

## Implementation

(worker fills in)
