# T8430: Link the header wordmark on the game-link and teammate-tag pages

**Status:** TODO
**Impact:** 3
**Complexity:** 1
**Created:** 2026-09-03

## Problem

`SharedGameView.jsx:73` and `SharedAnnotationView.jsx:73` both render:

```jsx
<span className="text-xs font-bold text-cyan-400 tracking-wide whitespace-nowrap">REEL BALLERS</span>
```

Plain text, no link. The reel and collection share pages treat their brand mark as passive
too (per T7690's audit), so this isn't a regression fix — it's a small, zero-risk addition
of the habitual "logo goes home" pattern to the two pages that currently have no path back
to `reelballers.com` at all besides their primary CTA button.

## Solution

Wrap both spans in a link to `https://www.reelballers.com/` (match the same UTM convention
used by `BrandedEndCard` if one is already established for passive brand-mark clicks;
otherwise a plain link with no UTM is fine — this is a minor, low-traffic click path, not
the primary conversion surface). Keep the exact same visual styling; this is a link wrapper,
not a redesign.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/SharedGameView.jsx:73`
- `src/frontend/src/components/SharedAnnotationView.jsx:73`

### Related Tasks
- See [EPIC.md](EPIC.md) for the full decision record and shared context.
- Touches the same header block as T8420 on `SharedGameView.jsx` — land this one first
  (it's a 1-line change) to avoid a merge conflict.

### Technical Notes
- No backend changes. Two-line frontend diff.

## Implementation

### Steps
1. [ ] Wrap the wordmark span in an `<a>` tag pointing at `https://www.reelballers.com/` on
   both files, preserving existing classes
2. [ ] Verify the link doesn't break the flex layout or introduce unwanted underline/focus
   styling inconsistent with the rest of the header

## Acceptance Criteria

- [ ] Clicking "REEL BALLERS" in the header of either page navigates to reelballers.com
- [ ] No visual change to the wordmark's appearance
