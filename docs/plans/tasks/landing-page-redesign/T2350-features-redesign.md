# T2350: Features Section Redesign

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-04-30
**Updated:** 2026-04-30

## Problem

Current page has six feature tiles with two redundancies: "Dynamic Player Framing" and "AI Player Highlighting" are the same feature. "Clip Library" and "Tag & Rate Clips" are workflow features, not value props. The four that remain each map to a specific competitive gap against Veo and Trace.

## Solution

### Section Header

```
## What we actually do
```

### Layout
- Desktop: 2x2 grid
- Mobile: single column

### Feature 1 -- We follow your player
- **Icon:** Person silhouette inside soft elliptical ring, mid-stride. Custom illustration (reference: existing green-ellipse overlay). Not a Lucide/stock icon.
- **Heading:** We follow your player.
- **Body:** Not the ball. Not the team. Your kid. Our tracking holds the frame on the player you marked, not the action that happens to be center-screen.

### Feature 2 -- Sideline footage that doesn't look like sideline footage
- **Icon:** Pixel grid on left transitioning to clean rendered frame on right. Show the transformation, not a generic "sparkle" icon.
- **Heading:** Sideline footage that doesn't look like sideline footage.
- **Body:** 4x neural upscaling cleans up the grain you get when you crop into a wide Veo or Trace shot. The output is 1080p, sharp enough to post.

### Feature 3 -- Vertical for IG. Horizontal for coaches.
- **Icon:** 9:16 phone outline next to 16:9 rectangle. Plain geometric.
- **Heading:** Vertical for IG. Horizontal for coaches.
- **Body:** One-click export to 9:16 for Instagram, TikTok, and Shorts. Or 16:9 for the recruiting reel a college coach is going to open on a laptop.

### Feature 4 -- Pay for what you make
- **Icon:** Single coin/credit chip. Not a dollar sign or calculator.
- **Heading:** Pay for what you make.
- **Body:** No subscription. Credits never expire. A 30-second reel costs about $2.50.

### Icon Style Guide
- Custom illustrations or single-weight line icons (not Material, not Font Awesome)
- Same stroke width and visual weight across all four
- Single accent color per icon (brand primary)
- Each readable at 48px

### Why These Four
Each maps to a competitive *gap*: Trace/Veo don't follow individual players this way, don't upscale, don't make vertical default, don't sell pay-as-you-go. "AI" appears nowhere in headings -- the audience cares about what the AI lets them do, not the AI itself.

## Context

### Relevant Files
- `src/landing/src/App.tsx` -- current 6-tile feature section to replace

### Related Tasks
- Depends on: T2300 (Visual Foundation)

## Implementation

1. [ ] Remove current 6-tile feature section
2. [ ] Create Features component with 2x2 grid layout
3. [ ] Write copy for all 4 features (headings + body)
4. [ ] Design/source 4 custom icons matching style guide
5. [ ] Responsive: 2x2 on desktop, single column on mobile
6. [ ] Ensure icons work at 48px and use accent color

## Acceptance Criteria

- [ ] Exactly 4 feature tiles (not 6)
- [ ] No mention of "AI" in headings
- [ ] Custom icons (not stock Material/Font Awesome)
- [ ] 2x2 grid on desktop, single column on mobile
- [ ] Copy matches spec verbatim
