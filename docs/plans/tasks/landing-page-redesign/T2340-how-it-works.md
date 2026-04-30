# T2340: How It Works Section

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-30
**Updated:** 2026-04-30

## Problem

Users need to understand the workflow before committing. The current page doesn't explain the 3-step process clearly with visual proof from the actual UI.

## Solution

### Section Header

```
## Three steps. About five minutes.
```

### Layout
- Desktop: three numbered steps, horizontal row
- Mobile: vertical stack

### Step 1 -- Drop in your clip
- **Body:** Paste a Veo or Trace link, or upload a file. Most clips upload in under a minute.
- **Visual:** Short loop (~3s) of the upload UI

### Step 2 -- Mark the moments
- **Body:** Scrub through, star the plays you want. Five-star clips become their own reel automatically.
- **Visual:** Loop of the annotation UI showing star ratings being applied

### Step 3 -- Frame and finish
- **Body:** Pick the crop, add a name tag, choose vertical or horizontal. Export. Done.
- **Visual:** Loop of the framing UI with the tracked player ellipse

### Below Steps
Small text: *Total time: about five minutes.*

**No CTA in this section.** The next section (features) is the visual payoff -- let the user keep scrolling.

## Context

### Relevant Files
- `src/landing/src/App.tsx` -- will add new section

### Related Tasks
- Depends on: T2300 (Visual Foundation)

### Content Requirements
- Need 3 short screen recordings from the actual app UI (~3s loops each)
- Upload UI, annotation UI (star ratings), framing UI (player ellipse tracking)
- GIF or compressed video format for fast loading

## Implementation

1. [ ] Record 3 UI screen captures (upload, annotate, framing)
2. [ ] Convert to compressed loops (GIF or short mp4)
3. [ ] Create HowItWorks component with numbered steps
4. [ ] Add step headings, body text, and visual loops
5. [ ] Responsive: horizontal on desktop, vertical on mobile
6. [ ] Add "Total time: about five minutes." footer text

## Acceptance Criteria

- [ ] Three numbered steps displayed with headings and body text
- [ ] Each step has a real UI screen recording loop
- [ ] Desktop: horizontal layout; mobile: vertical stack
- [ ] No CTA in this section
