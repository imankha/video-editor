# T2330: Curate Before/After Content

**Status:** TODO
**Impact:** 10
**Complexity:** 3
**Created:** 2026-04-30
**Updated:** 2026-05-20

## Problem

The landing page already has a working before/after slider (`BeforeAfterSlider` component) pulling videos from R2. But the current clips were grabbed quickly as a proof of concept — they aren't the strongest representation of what the product does. The slider is the single most persuasive element on the page, so the content needs to be deliberately chosen.

What makes a great before/after pair:
- **Clear transformation** — the "before" must look obviously raw/wide/hard-to-watch, and the "after" must look obviously better
- **Recognizable action** — the play should be easy to follow (goal, save, dribble) so the viewer understands what happened even without context
- **Diverse positions** — not just forwards scoring; show keepers, defenders, build-up play to signal "this is for every parent"
- **Clean loop** — the clip should loop smoothly for the autoplay slider

## Solution

### Content Curation Process

1. **Audit existing exported reels** for the strongest before/after candidates
2. **Process multiple pairs** using the existing before/after asset pipeline (T2315's admin "Create Before and After" flow)
3. **Select the best pair** for the primary slider position
4. **Optionally add 2-3 more pairs** that rotate or that users can swipe through

### Selection Criteria

Each candidate pair should be evaluated on:

| Criterion | Weight | Notes |
|-----------|--------|-------|
| Transformation clarity | High | Wide panoramic → tight follow should be dramatic |
| Play readability | High | Viewer should understand what happened in 3 seconds |
| Visual quality | Medium | After clip should look sharp, smooth tracking |
| Position diversity | Medium | Ideal: 1 goal/dribble, 1 defensive play or save |
| Loop cleanliness | Medium | No jarring cut when the clip restarts |

### Target: 3-4 pairs processed, best 1-2 deployed

- **Primary:** The single strongest transformation (likely an action play — goal or brilliant dribble)
- **Secondary (optional):** A defensive play or keeper save to show breadth
- Multiple pairs could rotate on refresh or be swipeable

### Asset Pipeline

Use the existing T2315 pipeline:
1. Pick a source clip from an exported reel
2. Run admin "Create Before and After" to generate separate before/after files
3. Upload both to the public R2 bucket (`pub-8fd2fb93bbed4535849c27ec673e7905.r2.dev`)
4. Update `beforeSrc`/`afterSrc` URLs in `App.tsx` (or add multiple pairs)

## Context

### Relevant Files
- `src/landing/src/App.tsx` — `BeforeAfterSlider` with `beforeSrc`/`afterSrc` props (line ~46)
- `src/landing/src/components/BeforeAfterSlider.tsx` — the slider component (already built)
- `before_after/` — T2315 asset pipeline output directory

### Related Tasks
- T2315 (Before/After Asset Pipeline) — DONE, provides the tooling to generate pairs
- T2360 (Annotation Showcase) — companion section showing the process; this shows the output

## Implementation

1. [ ] Review all exported reels across test accounts for strong before/after candidates
2. [ ] Shortlist 3-4 clips that meet selection criteria
3. [ ] Process each through the before/after asset pipeline
4. [ ] Compare pairs side-by-side, pick the strongest 1-2
5. [ ] Upload winning pairs to public R2 bucket
6. [ ] Update App.tsx with new URLs (swap current pair or add rotation)
7. [ ] Test on landing page — verify loop, load time, visual impact

## Acceptance Criteria

- [ ] Primary before/after pair is deliberately chosen (not the first available clip)
- [ ] Transformation is immediately obvious to someone who has never seen the app
- [ ] Play is readable without context (viewer knows what happened)
- [ ] Clips loop cleanly in the slider
- [ ] At least one candidate from a non-forward position was evaluated
