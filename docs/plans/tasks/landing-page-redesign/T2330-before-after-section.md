# T2330: Before/After Section

**Status:** TODO
**Impact:** 10
**Complexity:** 5
**Created:** 2026-04-30
**Updated:** 2026-04-30

## Problem

The most persuasive thing about Reel Ballers is the output. The current page has no visual proof -- no before/after comparison. A parent who sees this section and gets it has converted. A parent who misses it hasn't.

This is "the most important section on the page."

## Solution

### Section Header

```
## Same moment. Different reel.
```

### Layout
- Desktop: side-by-side tiles
- Mobile: stacked with clear visual divider

### Left Tile
- Raw Veo/Trace panoramic frame -- wide, player tiny
- Caption: *"What you have."*
- Autoplay, looped, silent

### Right Tile
- Reel Ballers vertical output of the **same moment**
- Player followed, frame upscaled
- Caption: *"What you get."*
- Autoplay, looped, silent

### Sync
- Both clips autoplay in sync, showing the same moment
- A "Same moment." caption sits centered between them

### CTA Below

```
[ Try it on your own clip -> ]
```

Secondary button style, centered.

## Context

### Relevant Files
- `src/landing/src/App.tsx` -- will add new section
- `src/landing/public/before_after_demo.mp4` -- existing demo asset (may need replacement with separate before/after clips)

### Related Tasks
- Depends on: T2300 (Visual Foundation), T2320 (Hero -- comes right after)
- Supersedes: T445 (Landing Page Before/After Clips)

### Content Requirements
- Need one strong before/after pair from real game footage
- Before clip: raw panoramic Veo/Trace frame
- After clip: same moment, vertically framed, player tracked, upscaled
- Both clips must loop cleanly and be short (5-10s)
- Compress for web (lazy load since below fold)

## Implementation

1. [ ] Source before/after clip pair from real exported reels
2. [ ] Prepare clips for web (compressed, short loops, silent)
3. [ ] Create BeforeAfter component with side-by-side layout
4. [ ] Add synced autoplay with IntersectionObserver (play when visible)
5. [ ] Add captions: "What you have." / "What you get."
6. [ ] Add "Same moment." centered divider text
7. [ ] Add secondary CTA button: "Try it on your own clip"
8. [ ] Responsive: stack vertically on mobile with visual divider
9. [ ] Lazy load videos (below fold)

## Acceptance Criteria

- [ ] Before/after clips show the same moment from real footage
- [ ] Both clips autoplay silently and loop when section is visible
- [ ] Desktop: side-by-side layout
- [ ] Mobile: stacked with clear divider
- [ ] CTA "Try it on your own clip" visible below comparison
- [ ] Videos lazy-loaded (don't block page load)
