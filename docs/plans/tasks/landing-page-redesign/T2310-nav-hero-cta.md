# T2310: Nav, Hero & CTA Improvements

**Status:** TODO
**Impact:** 10
**Complexity:** 4
**Created:** 2026-04-30
**Updated:** 2026-05-19

## Problem

Three measurable conversion problems on the current landing page:

1. **No persistent CTA** -- user scrolls past the hero and loses access to the signup button
2. **Generic headline** -- "Share Your Player's Brilliance" doesn't name what the product does or how fast it works
3. **Generic CTA text** -- "Get Started Free" doesn't tell the user what they'll get
4. **No sign-in link** -- returning users can't get to their account from the landing page

## Scope

Only changes with clear, measurable upside. No visual redesign, no layout restructuring, no polish animations. Ship this, get real user feedback, then iterate.

## Changes

### 1. Sticky Nav with CTA Button

Current nav has just the logo. Add:

- **Desktop:** Logo (left), "Sign in" text link + "Make Your Reel" primary button (right). Sticky on scroll, simple background transition (transparent -> dark with border).
- **Mobile:** Logo (left), hamburger (right). Hamburger opens overlay with "Sign in" + "Make Your Reel" button.

### 2. Mobile Sticky Bottom Bar

- Full-width "Try it free" button, fixed to bottom of viewport
- Visible throughout the entire page scroll
- Routes to app signup (same as hero CTA, passes `ref` param)
- Hide when hamburger menu is open

### 3. Hero Copy

Replace current:
```
Share Your Player's Brilliance
Higher quality highlights in minutes.
[Get Started Free]
```

With:
```
From Upload to IG in 5 minutes.
Tag your player's best moments from game footage.
Turn them into highlight reels ready for Instagram.
[Make my first reel -- free]
Already have an account? Sign in ->
```

**Two value props, in order of emotional importance to soccer parents:**
1. **Highlight reels** (the output they share) -- headline + second subhead line
2. **Annotation/clip tagging** (the workflow that saves hours) -- first subhead line

Keep the existing centered layout and phone mockup below. No layout change.

**No brand names** -- do not mention Veo, Trace, or any camera/platform brands in copy.

**No false speed claims** -- games take days to download from camera platforms. Don't imply users can create reels during halftime or immediately after a game. The speed claim ("5 minutes") refers to editing time once footage is on hand, not end-to-end turnaround.

### 4. Interactive Before/After Comparison

Replace the single sequential `before_after.mp4` with two separate clips and an interactive slider.

**Behavior:**
- Two phone mockups side by side (desktop) or a single phone with a swipe/toggle (mobile)
- Default state shows "Before" playing -- the wide-angle Veo/Trace footage
- User drags a slider or swipes to reveal "After" -- the cropped, upscaled, vertical reel
- Both clips loop simultaneously and stay in sync (same moment in the game)
- Clear "Before" / "After" labels on each side

**Ensuring users see the "After":**
- On load, auto-slide to "After" once after ~2 seconds, then slide back -- shows the user what's there
- Slider handle has a subtle pulse/glow animation to invite interaction
- On mobile: swipe gesture on the phone frame area, with a "Swipe to compare" hint that fades after first interaction

**Assets needed:**
- Split current `before_after.mp4` into `before.mp4` (wide-angle source) and `after.mp4` (cropped/upscaled reel), same duration, synced to the same moment

### 5. Sign-in Link

Add "Already have an account? Sign in" below the hero CTA, linking to `https://app.reelballers.com/login`.

### 6. Fix Testimonial Copy

Mike T. testimonial (App.tsx:182) says "now happens during halftime of the next game" -- this is inaccurate since game footage isn't available for days. Replace with realistic timing that still communicates the speed improvement.

## What This Does NOT Change

- Page layout (stays centered, no two-column)
- Background/colors (stays current purple gradient)
- Feature cards, testimonials, problem/solution sections
- Typography or font family

## Context

### Relevant Files
- `src/landing/src/App.tsx` -- current page (single file, ~220 lines)
- `src/landing/src/components/Logo.tsx` -- logo component

### Absorbed Tasks
- **T2310** (Sticky Nav & CTA System) -- nav sticky + mobile bar items
- **T2320** (Hero Section) -- headline, subhead, CTA copy items

### Related Tasks
- T2300 (Visual Foundation) -- NOT a dependency. This task works with current styles.

## Implementation

1. [ ] Create sticky NavBar: logo left, sign-in link + "Make Your Reel" button right
2. [ ] Add scroll listener: transparent bg -> `bg-slate-900/95 border-b border-white/10` on scroll
3. [ ] Create mobile hamburger menu (sheet overlay with nav items)
4. [ ] Create MobileStickyBar: fixed bottom, full-width "Try it free" button
5. [ ] Update hero headline to "From Upload to IG in 5 minutes."
6. [ ] Update hero subhead (no brand names -- generic "game footage" language)
7. [ ] Update hero CTA to "Make my first reel -- free"
8. [ ] Add "Already have an account? Sign in" link below CTA
9. [ ] Split before_after.mp4 into separate before.mp4 + after.mp4
10. [ ] Build interactive before/after slider component (synced video playback)
11. [ ] Add auto-peek animation (slides to "After" briefly on load, then back)
12. [ ] Add "Swipe to compare" hint on mobile, fades after first interaction
13. [ ] Fix Mike T. testimonial -- remove "during halftime" claim, use realistic timing
14. [ ] Ensure mobile bottom bar doesn't overlap footer
15. [ ] All CTA buttons pass through `ref` URL parameter

## Acceptance Criteria

- [ ] Nav sticks on scroll with background transition
- [ ] "Make Your Reel" button visible in nav on desktop at all times
- [ ] "Try it free" button visible at bottom of screen on mobile at all times
- [ ] Hamburger menu works on mobile with sign-in + CTA
- [ ] Hero headline reads "From Upload to IG in 5 minutes."
- [ ] Hero subhead contains no third-party brand names
- [ ] Hero CTA reads "Make my first reel -- free"
- [ ] "Sign in" link present in nav and below hero CTA
- [ ] Before/After shows two synced clips with interactive slider (not sequential video)
- [ ] Auto-peek animation plays once on load to reveal the "After"
- [ ] Mobile: swipe gesture works, "Swipe to compare" hint visible initially
- [ ] All CTAs route to app with `ref` param preserved
