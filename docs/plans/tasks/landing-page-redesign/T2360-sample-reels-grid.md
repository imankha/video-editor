# T2360: Annotation Showcase Section

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-04-30
**Updated:** 2026-05-20

## Problem

The landing page already shows final exported reels (before/after slider), but doesn't communicate the core differentiator: the annotation workflow. Parents don't understand what "annotate" means or why it matters. Competitors show polished output — we need to show the *process* that makes our output possible in 5 minutes.

The annotation UI is visually rich (tags, star ratings, teammate tagging, clip timelines, "My Athlete" toggle) but none of that appears on the landing page. A parent seeing the screenshot of the annotation screen would immediately understand what the product does — "oh, I mark the moments and it builds the reel."

## Solution

### Section Purpose

Show the annotation workflow as a visual story: "Here's what it looks like to mark your kid's best moments." The goal is to make parents think "I could do that" — not "that looks complicated."

### Content: Annotated Screenshots / Screen Recordings

Show the annotation UI in action with real game footage. Key elements to highlight:

1. **Clip creation** — the timeline with clip markers, showing how a parent marks a moment
2. **Tagging** — sport-specific tags (Goal, Assist, Dribble, Save, Tackle) that categorize the clip
3. **Star rating** — the 5-star system that determines which clips auto-export
4. **Teammate tagging** — "Tag a teammate..." input showing the social/sharing angle
5. **My Athlete toggle** — showing this is personalized per kid
6. **Clip details panel** — name, notes, the full context of a single annotated moment

### Layout Options

**Option A: Annotated screenshot walkout**
- Large screenshot of annotation UI (like the one in the task screenshot)
- 3-4 callout annotations pointing to key features with short labels
- e.g., arrow to tags → "Tag the play type", arrow to stars → "Rate the moment", arrow to teammates → "Share with teammates"

**Option B: Step sequence**
- 3 panels side by side: (1) Full game timeline → (2) Clip marked with tags → (3) Finished reel
- Shows the transformation from raw footage to annotated clip to output

**Option C: Short screen recording**
- 10-15s looping video of someone annotating a clip: click timeline, add tags, rate 5 stars
- Autoplay, muted, looping — like a product demo GIF

### Section Header

```
Mark the moments that matter.
```

or

```
5-star the saves. Tag the goals. Share with the team.
```

### Caption / Supporting Text

Short line under the visual:
```
Clip, tag, and rate your kid's best plays. We turn them into a shareable reel.
```

## Context

### Relevant Files
- `src/landing/src/App.tsx` — will add new section
- Screenshot reference: annotation UI with clip details, tags, star rating, teammates, timeline

### Related Tasks
- Depends on: T2300 (Visual Foundation) for design system
- Complements: before/after slider (T2315) which shows output; this shows process

### Content Requirements
- High-quality screenshot(s) of annotation UI with real game footage
- May need to stage a "perfect" annotation state for the screenshot (all features visible)
- If using screen recording: capture smooth annotation flow, compress for web

## Implementation

1. [ ] Decide layout approach (annotated screenshot vs step sequence vs screen recording)
2. [ ] Capture annotation UI screenshot/recording with real game footage
3. [ ] Stage annotation state: clip selected, tags applied, 5-star rating, teammate tagged
4. [ ] Design callout annotations or step labels
5. [ ] Create AnnotationShowcase component
6. [ ] Responsive: full-width on mobile, centered with callouts on desktop
7. [ ] Lazy load images/video
8. [ ] Position in page flow after hero, before or near the before/after slider

## Acceptance Criteria

- [ ] Landing page shows the annotation UI in a way that communicates the workflow
- [ ] At least 3 key features are visually highlighted (tags, rating, teammate sharing)
- [ ] A parent who has never seen the app can understand the annotation concept from this section
- [ ] Responsive on mobile and desktop
- [ ] Assets lazy-loaded
