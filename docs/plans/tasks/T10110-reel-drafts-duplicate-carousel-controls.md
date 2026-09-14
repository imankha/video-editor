# T10110: Reel Drafts "By Phase" view renders duplicate/overlapping carousel controls

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-09-14
**Updated:** 2026-09-14

## Problem

Bug 51 (`bug_reports`, sarkarati@gmail.com, 2026-09-01, build `d9621161`): "Having multiple
carousels on the same row is confusing UI for the user." `page_url`: `/home/reels`.

Screenshot (viewport 2224x1221) confirms this is a real layout defect, not just a preference: the
Reel Drafts "By Phase" view's "Not Started" row shows **two separate sets of prev/next arrow
controls** in the same visual row — one pair around x=427/799 (in the ~2000px-scaled screenshot)
and a second pair around x=821/1196, both apparently scoped to the same card row. It's not
resolvable at a glance which arrows scroll which cards, and the cards themselves appear to belong
to one continuous "Not Started" collection (4 cards visible, badge says "6" total) rather than two
distinct groups that would justify two carousels.

Not yet root-caused. Likely candidates to check first:
1. The "By Phase" grouping renders one carousel component per phase, but a phase group name
   header (e.g. "Vs LA Breakers Belmar May 2") is being mis-rendered as its own sub-carousel
   instead of a label within the single "Not Started" carousel.
2. Two carousel component instances are mounting for the same data (e.g. a stale/duplicate render
   from a keyed-list bug) rather than the grouping logic being wrong.

## Solution

Not yet investigated — reproduce first (Reel Drafts, "By Phase" tab, an account with several
Not-Started drafts), then find the Reel Drafts carousel/grouping component and determine which of
the two candidates above (or another cause) is correct. This is a straightforward frontend layout
fix once the actual cause is identified; no backend involvement expected.

## Context

### Relevant Files (REQUIRED)
- Reel Drafts / "By Phase" grouping view — not yet located, needs a repro pass first
  (likely `src/frontend/src/components/gallery/` or a drafts-specific directory; search for
  "By Phase" / "Not Started" / carousel component names)

### Related Tasks
- Same reporter as T10070/T10080/T10090, unrelated bug — filed together from the same triage pass

## Implementation

### Steps
1. [ ] Reproduce: open Reel Drafts, "By Phase" view, with 4+ Not-Started drafts.
2. [ ] Identify why two carousel control sets render in the same row.
3. [ ] Fix so each logical group has exactly one set of controls.

### Progress Log

**2026-09-14**: Filed from `bug_reports` #51 during a full bug-report triage pass. Not started.

## Acceptance Criteria

- [ ] Each Reel Drafts group/row shows exactly one carousel control set, unambiguous which cards
      it scrolls.
