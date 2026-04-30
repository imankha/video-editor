# T2360: Sample Reels Grid

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-04-30
**Updated:** 2026-04-30

## Problem

The current page shows no output examples. Every other product on the market shows only forwards scoring goals, which tells a defender's parent "this isn't for my kid." Showing diverse positions is a real opening to be the brand that respects the full squad.

## Solution

### Section Header

```
## Reels parents have made this season.
```

### Layout
- Desktop: 3-up grid
- Mobile: 2-up grid
- Each tile is a real vertical reel

### Interaction
- Desktop: silent autoplay on hover
- Mobile: plays on tap

### Required Diversity (8-12 reels)
- A U10 girl scoring a tap-in
- A U13 boy with a clean dribble + finish
- A U15 keeper making a save (keeper parents feel left out everywhere)
- A U16 center-back with a clearance and a header (defenders too)
- A U17 winger doing a one-v-one
- A U12 mixed gender clip
- At least one assist or build-up sequence (not just goals)
- At least one defensive play

### Caption Format (small, muted text under each reel)
```
U13 girls -- 2025 Surf Cup
Made in 4 minutes
```

The tournament name signals "this is from a real event your audience knows." The "Made in X minutes" line is a soft proof point for speed.

**No CTA in this section.** The reels themselves are the message.

## Context

### Relevant Files
- `src/landing/src/App.tsx` -- will add new section

### Related Tasks
- Depends on: T2300 (Visual Foundation)

### Content Requirements
- Need 8-12 real exported reels with permission to display
- Must include keeper saves, defensive plays, assists -- not just goals
- Each reel should be short (5-15s), compressed for web
- Need tournament/age-group metadata for captions

## Implementation

1. [ ] Source 8-12 real reels covering required diversity
2. [ ] Get permission to display (if not own footage)
3. [ ] Compress for web (short, small file size)
4. [ ] Create SampleReels component with grid layout
5. [ ] Add hover-to-play on desktop, tap-to-play on mobile
6. [ ] Add captions with age group, tournament, "Made in X minutes"
7. [ ] Responsive: 3-up desktop, 2-up mobile
8. [ ] Lazy load all videos

## Acceptance Criteria

- [ ] 8-12 real reels displayed in grid
- [ ] Includes at least 1 keeper, 1 defender, 1 assist/build-up
- [ ] Desktop: 3-up grid with hover autoplay
- [ ] Mobile: 2-up grid with tap-to-play
- [ ] Each reel has age/tournament caption + "Made in X minutes"
- [ ] No CTA in this section
- [ ] Videos lazy-loaded
