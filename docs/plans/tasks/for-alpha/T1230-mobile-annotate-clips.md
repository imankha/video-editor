# T1230: Mobile Annotate Clips

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-04-08
**Updated:** 2026-04-08

## Problem

The mobile Annotate experience has two remaining issues after the T335 branch was partially merged:

1. **ClipDetailsEditor lacks compact mode on mobile.** When the mobile sidebar shows clip details (via the "info" button), the `ClipDetailsEditor` renders at full desktop size. The `ClipScrubRegion` component (added post-T335) takes significant vertical space, and tags/controls are sized for desktop. On a phone screen, users must scroll excessively to see all clip details.

2. **Dead `compact` parameter in `TagSelector`.** The `TagSelector` component already accepts a `compact` prop (smaller text, tighter padding), but `ClipDetailsEditor` never passes it through because it doesn't accept `compact` itself. This is leftover from the partial T335 merge.

## Solution

Add a `compact` prop to `ClipDetailsEditor` that:
- Passes `compact` through to `TagSelector` (wiring up the existing dead code)
- Makes `ClipScrubRegion` more compact (smaller height or collapsible)
- Reduces vertical spacing in the details panel
- Pass `compact` from `ClipsSidePanel`'s mobile detail view

## Code Changes

### File: `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx`

**What exists now (master):**
- `ClipDetailsEditor` accepts: `region`, `onUpdate`, `onDelete`, `maxNotesLength`, `videoDuration`, `onSeek`, `videoRef`, `onScrubLock`, `onScrubUnlock`
- No `compact` prop
- `TagSelector` already supports `compact` (smaller text at `text-[11px]`, tighter padding at `px-1.5 py-1`, smaller check icon at `size={10}`) but it's never activated
- `ClipScrubRegion` is rendered unconditionally with no size variants
- Spacing uses `space-y-3` and `p-3` throughout

**Changes needed:**

1. Add `compact = false` to the component's destructured props.

2. Pass `compact` to `TagSelector`:
   ```jsx
   <TagSelector
     selectedTags={region.tags || []}
     onTagToggle={handleTagToggle}
     compact={compact}
   />
   ```

3. When `compact` is true, reduce overall spacing:
   - Change outer `<div className="p-3 space-y-3">` to use `p-2 space-y-2` when compact
   - Example: `className={\`${compact ? 'p-2 space-y-2' : 'p-3 space-y-3'}\`}`

4. When `compact` is true, consider hiding or collapsing `ClipScrubRegion`. Options:
   - **Option A (simpler):** Hide it entirely on compact -- mobile users set clip timing via the timeline overlay, not the sidebar detail view
   - **Option B:** Wrap it in a collapsible section with a "Timing" toggle button (this was the original T335 branch approach, but `ClipScrubRegion` didn't exist then)
   - Recommendation: Start with Option A. The mobile sidebar detail view is for rating, tagging, and notes -- timing adjustments happen on the main timeline.

5. When `compact` is true, reduce the notes textarea from `rows={3}` to `rows={2}`.

### File: `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx`

**What exists now (master):**
- Mobile detail view (lines 106-131) renders `ClipDetailsEditor` without `compact`
- Already passes `onSeek`, `videoRef`, `onScrubLock`, `onScrubUnlock` to the mobile detail editor

**Changes needed:**

Add `compact` prop to the mobile detail view's `ClipDetailsEditor`:

```jsx
// In the mobileShowDetail branch (around line 120):
<ClipDetailsEditor
  region={selectedRegion}
  onUpdate={(updates) => onUpdateRegion(selectedRegion.id, updates)}
  onDelete={() => { onDeleteRegion(selectedRegion.id); setMobileForceList(true); }}
  maxNotesLength={maxNotesLength}
  videoDuration={videoDuration}
  onSeek={onSeek}
  videoRef={videoRef}
  onScrubLock={onScrubLock}
  onScrubUnlock={onScrubUnlock}
  compact
/>
```

The desktop `ClipDetailsEditor` (around line 244) should NOT get `compact` -- it stays full-size.

## Notes on Divergence from T335 Branch

The original T335 branch (5 weeks old) made these changes that are **already on master**:
- VideoPlayer: `h-[40vh] sm:h-[60vh]` responsive heights
- Breadcrumb: `min-w-0`, `text-sm sm:text-lg` responsive text
- AnnotateModeView: video metadata hidden on mobile, controls bar hidden on mobile, reduced padding, export settings hidden on mobile
- ClipListItem: `isMobile` prop with Info/Play action buttons, larger touch targets
- ClipsSidePanel: `isMobile`/`onJumpToClip` props, mobile detail view with back button, full-width on mobile, import/export hidden on mobile
- ClipRegionLayer: `ResizeObserver`-based dynamic marker sizing for mobile
- AnnotateScreen: mobile sidebar overlay, breadcrumb wrapping with `min-w-0`, jump-to-clip handler

The only piece NOT merged was the `compact` behavior in `ClipDetailsEditor` because:
1. The timing section (End Time input, Duration slider, Start Time display) was replaced by `ClipScrubRegion` after the branch diverged
2. The branch's collapsible timing approach doesn't map directly to the new `ClipScrubRegion` component

## Acceptance Criteria

- [ ] `ClipDetailsEditor` accepts a `compact` prop
- [ ] When `compact=true`, `TagSelector` renders with smaller text and tighter padding (existing code, just needs wiring)
- [ ] When `compact=true`, `ClipScrubRegion` is hidden or collapsed to save vertical space
- [ ] When `compact=true`, overall spacing is reduced (padding, gaps)
- [ ] Mobile sidebar detail view passes `compact` to `ClipDetailsEditor`
- [ ] Desktop sidebar detail view remains unchanged (no `compact`)
- [ ] Mobile detail view is usable without excessive scrolling on 360px-wide screens
- [ ] All existing clip editing functionality (rating, tags, name, notes, delete) works in compact mode
