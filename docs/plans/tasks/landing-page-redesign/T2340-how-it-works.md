# T2340: How It Works Section

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-30
**Updated:** 2026-05-20

## Problem

Parents see the before/after slider and think "that looks great" — but they don't understand how they'd actually use the product. The current page has no explanation of the workflow. Without it, the gap between "cool demo" and "I should sign up" is too wide.

The steps need to reflect the actual user experience accurately: annotate first, review with your athlete, then create and share highlights.

## Solution

### Section Header

```
## How it works
```

### Layout
- Desktop: three numbered steps, horizontal row
- Mobile: vertical stack

### Step 1 — Annotate your game

- **Heading:** Upload & annotate
- **Body:** Upload your game video and mark the key moments — goals, saves, tackles, assists. Tag teammates and rate each clip.
- **Visual:** Short loop (~3-5s) of the annotation UI: clip selected on timeline, tags being applied, star rating

### Step 2 — Review with your athlete

- **Heading:** Play it back together
- **Body:** Sit down with your kid and play back the annotated clips. Relive the game, talk through the moments, learn from each play.
- **Visual:** Loop of the playback annotations view — clips playing in sequence with annotation labels

### Step 3 — Share the highlights

- **Heading:** Create & share highlights
- **Body:** Turn your best clips into a polished highlight reel. Frame the action, upscale the quality, and share it with coaches, teammates, and family.
- **Visual:** Loop showing the framing/export flow or a finished reel being shared

### Below Steps
Small text: *From upload to highlight reel in about five minutes.*

**No CTA in this section.** Let the user keep scrolling to the next section.

## Context

### Why this ordering matters

The product's value isn't just the output — it's the full loop:
1. **Annotate** is the core action. This is what the parent actually *does*.
2. **Review together** is the emotional hook. This is what makes the product meaningful — parents and kids reliving the game together.
3. **Share highlights** is the viral output. This is what spreads to coaches and other parents.

Most competitors skip straight to "upload → get highlights." Our differentiator is that the parent is actively involved in marking the moments that matter to *their* kid, and then reviewing those moments together as a learning and bonding tool. The highlights are a byproduct of that process, not the sole point.

### What NOT to say

- Don't say "AI tracks your player" — the technology does not auto-track. The parent chooses the framing.
- Don't say "automatic highlights" — the parent annotates and rates clips manually. That's the value.
- Don't imply it's passive — the whole point is active involvement.

### Relevant Files
- `src/landing/src/App.tsx` — will add new section

### Related Tasks
- Depends on: T2300 (Visual Foundation)
- Complements: T2360 (Annotation Showcase) — that section shows the annotation UI in detail; this section shows the overall workflow

### Content Requirements
- 3 short screen recordings from the actual app UI (~3-5s loops each)
- Step 1: Annotation UI — timeline with clips, tags, star ratings
- Step 2: Playback annotations — clips playing with labels/names visible
- Step 3: Framing/export or sharing flow — finished reel, share button
- Compressed for web (short mp4 or animated webp)

## Implementation

1. [ ] Record 3 UI screen captures (annotate, playback, share/export)
2. [ ] Convert to compressed loops (short mp4 or animated webp)
3. [ ] Create HowItWorks component with numbered steps
4. [ ] Add step headings, body text, and visual loops
5. [ ] Responsive: horizontal on desktop, vertical on mobile
6. [ ] Add footer text: "From upload to highlight reel in about five minutes."

## Acceptance Criteria

- [ ] Three numbered steps: annotate, review together, share highlights
- [ ] Each step has a real UI screen recording loop
- [ ] Copy accurately reflects the user experience (no auto-tracking claims)
- [ ] Desktop: horizontal layout; mobile: vertical stack
- [ ] No CTA in this section
