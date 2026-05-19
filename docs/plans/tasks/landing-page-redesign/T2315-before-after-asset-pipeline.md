# T2315: Before/After Asset Pipeline

**Status:** TESTING
**Impact:** 8
**Complexity:** 4
**Created:** 2026-05-19
**Updated:** 2026-05-19

## Problem

The landing page before/after slider (T2310) needs two separate videos -- `before.mp4` (wide-angle source footage) and `after.mp4` (cropped/upscaled reel) -- but currently only a merged `before_after.mp4` exists. The admin "Create Before and After" button in My Reels creates a single merged video. We need it to output two separate files, plus a script to concatenate multiple pairs into final landing page assets.

## Changes

### 1. Modify Admin "Create Before and After" Button

Current behavior: creates a single `before_after.mp4` that plays "before" then "after" sequentially.

New behavior: creates two separate files:
- `before_{clip_id}.mp4` -- the wide-angle source footage segment
- `after_{clip_id}.mp4` -- the cropped/upscaled reel segment

Both files should have the same duration, synced to the same moment in the game. Output as downloads (or upload to R2 for retrieval).

### 2. Concatenation Script

Script to combine multiple before/after pairs into final landing page videos:

```
python scripts/concat_before_after.py \
  --input-dir ./before_after_clips/ \
  --output-dir src/landing/public/
```

Input: directory containing `before_*.mp4` and `after_*.mp4` pairs
Output: `before.mp4` and `after.mp4` -- all clips concatenated in sequence

Requirements:
- Match before/after pairs by clip ID
- Concatenate all "before" clips into one video, all "after" clips into one video
- Maintain same clip order in both outputs so they stay in sync
- Use FFmpeg concat demuxer (no re-encoding if formats match)

### 3. Update Landing Page Source

After assets are created:
- Upload `before.mp4` and `after.mp4` to R2 public bucket
- Update `BeforeAfterSlider` props in `App.tsx` to point to the R2 URLs
- Remove the TODO comment

## Relevant Files

- Admin button: find "Create Before and After" or "before_after" in `src/frontend/` and `src/backend/`
- Landing page slider: `src/landing/src/components/BeforeAfterSlider.tsx`
- Landing page: `src/landing/src/App.tsx` (TODO comment marks where to update sources)

## Depends On

- T2310 (Nav, Hero & CTA Improvements) -- slider component already built

## Implementation

1. [ ] Find the admin "Create Before and After" button and its backend handler
2. [ ] Modify to output two separate video files instead of one merged
3. [ ] Create `scripts/concat_before_after.py` concatenation script
4. [ ] User creates multiple before/after pairs via admin
5. [ ] Run concat script to produce final `before.mp4` and `after.mp4`
6. [ ] Upload to R2 public bucket
7. [ ] Update `App.tsx` slider sources to R2 URLs

## Acceptance Criteria

- [ ] Admin button downloads/creates two separate files per clip
- [ ] Concat script produces two synced videos from multiple pairs
- [ ] Landing page slider shows real before vs. after content
- [ ] Both videos loop and stay visually in sync
