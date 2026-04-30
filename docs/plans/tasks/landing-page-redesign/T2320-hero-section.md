# T2320: Hero Section

**Status:** TODO
**Impact:** 10
**Complexity:** 4
**Created:** 2026-04-30
**Updated:** 2026-04-30

## Problem

The current hero ("Share Your Player's Brilliance") has no CTA above the fold. This is the single biggest conversion killer on the page. The headline is generic and doesn't communicate speed or workflow.

## Solution

### Layout
- Desktop: two-column (copy left, phone mockup right)
- Mobile: single-column stacked (copy on top, phone below)
- Phone mockup sized so it doesn't dominate above the fold on mobile -- copy must be visible without scrolling

### Copy

```
# From Upload to IG in 5 minutes.

Drop in your Veo or Trace clip. We follow your player, upscale the footage,
and hand you back a vertical reel worth posting.

[ Make my first reel -- free ]

Already have an account? Sign in ->
```

### Proof Points (below CTA, small text or icon row)

```
* Vertical, by design     * Follows your player     * Upscaled, not cropped
```

### Phone Mockup (right column)
- Real, looped, silent finished reel (not a still)
- Loops cleanly (no jarring cut)
- Player being followed is clearly the focal point
- 8-15 seconds
- No music (silent -- IG handles that)
- Keep existing green-ellipse visual concept

### Why This Works
- Headline is short, action-oriented, names two anchors the audience knows ("Upload" + "IG")
- Period at the end gives finality. No exclamation mark.
- Subhead names Veo and Trace -- keeps both user bases in the tent
- CTA is specific: "Make my first reel -- free" tells them there's no commitment

## Context

### Relevant Files
- `src/landing/src/App.tsx` -- current hero section
- `src/landing/public/` -- video/image assets

### Related Tasks
- Depends on: T2300 (Visual Foundation), T2310 (Nav)

## Implementation

1. [ ] Create Hero component with two-column layout
2. [ ] Add headline, subhead, CTA button, sign-in link
3. [ ] Add proof points row (3 items with checkmarks or icons)
4. [ ] Source/create looping phone mockup video (real reel, 8-15s, silent)
5. [ ] Responsive: stack on mobile, ensure copy visible without scrolling
6. [ ] Add "Watch a 30s demo" link for mobile (opens fullscreen modal) -- P1
7. [ ] Background: deep dark navy with optional faint pitch-line pattern at 3% opacity

## Acceptance Criteria

- [ ] CTA visible above the fold on desktop and mobile
- [ ] Headline reads "From Upload to IG in 5 minutes."
- [ ] CTA reads "Make my first reel -- free" and routes to upload flow
- [ ] Phone mockup shows a real looping reel (not a still image)
- [ ] Three proof points visible below CTA
- [ ] Mobile: copy visible without scrolling, phone mockup below
