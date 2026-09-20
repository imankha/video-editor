# T10730: "Details" disclosure label lost its tag/note count (Master CI red)

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-09-19
**Updated:** 2026-09-19

## Problem

Discovered while investigating T10720 (Frame Now/Later): Master CI is currently RED at HEAD
(`2ad605d9`), independent of and predating T10720. `AnnotateFullscreenOverlay.details.test.jsx`
expects the "Details" disclosure to read `Details (2 tags, note)` once the play has tags/a note
(so an edit-mode user knows there is hidden content behind the collapsed disclosure — see the
test file's T8600/T10290/T10580/T10620 history comment). It currently just renders the literal
string `Details` always:

```js
// AnnotateFullscreenOverlay.jsx:351
const detailsLabel = ANNOTATE.DETAILS;  // ANNOTATE.DETAILS = 'Details' (config/displayNames.js:105)
```

`detailsLabel` is a static constant, not derived from `existingClip.tags`/`existingClip.notes` at
all — the tag/note counting logic that must have existed at some point (per the test's own
history comment chain T8600 -> T10290 -> T10580 -> T10620) is gone. Unclear yet whether T10620's
relabel (static "Details" wording) accidentally dropped the count suffix, or whether an even later
same-day change did.

## Impact

This blocks Master CI (and therefore Branch CI on every future PR, since Branch CI running "in
full" per-layer means any frontend PR inherits this failure) from going green until fixed. It is
NOT caused by T10720 — reproduced failing on unmodified master at `2ad605d9`
(`gh run view 35489566531`, job `frontend`, same test/assertion).

## Suggested Fix

Restore a `detailsLabel` computed from `existingClip.tags.length` and whether `existingClip.notes`
is non-empty, matching the test's expected format `Details (N tags, note)` /
`Details (N tags)` / `Details (note)` / bare `Details` when neither. Check whether T10620's diff
intentionally simplified this (in which case the TEST is stale and should be updated instead) or
accidentally lost it (in which case restore the count). `git log -p -S"detailsLabel" -- src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx`
is the fastest way to find the exact commit that changed this.

## Acceptance Criteria

- [ ] `AnnotateFullscreenOverlay.details.test.jsx` passes (both label tests)
- [ ] Master CI frontend job green
