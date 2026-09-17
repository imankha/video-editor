# T10280: Home tab guidance: one structure for all four tabs, new copy, drop the flow strip

**Status:** WIP
**Impact:** 7
**Complexity:** 3
**Created:** 2026-09-17
**Updated:** 2026-09-17

## Problem

User, 2026-09-17 staging: "The instruction text under each Menu category should be consistent. I
like how Reels and Published look, they have a header, then description, and better font
centering, and size choices. The text for Games and Clips should match that forward." Plus new
copy for all four tabs, "I actually don't like the Games > Clips > Reels · optional > Published
diagram. It looks redundant with the menu above", and "I don't like the open clip button in
Reels. I don't like it telling me how many clips I have in progress."

Why Games/Clips look different (trace 2026-09-17): two copy systems are in play. All four tabs
share `EmptyTabGuide.jsx` (centered `h2 text-lg` headline + `p text-sm` body from
`config/emptyStates.js`), but Games and Clips ALSO get a bare `p.text-xs.text-gray-500` hint
line under the CTA on the POPULATED tab (`UPLOAD_ENTRY_HINT` in `displayNames.js:183-186`,
rendered at `ProjectManager.jsx:1505,1527`), which Reels/Published never get. The "open clip"
button + "You have N clips in progress." are the **Published** tab's empty state
(`EmptyTabGuide.jsx:256-267`, `emptyStates.js:81-82`), not Reels.

## Solution

1. **One structure**: every tab, empty or populated, shows the same centered
   headline + body block (`EmptyTabGuide` styling: `text-lg font-semibold` + `text-sm
   text-gray-400`). Delete `UPLOAD_ENTRY_HINT` and its two render sites; the populated Games and
   Clips tabs render the same headline/body above their CTA instead. Keep `PARTIAL_TAB_GUIDE`
   only if it collapses into the same component (no third style).
2. **Copy** (user's words, spelling normalized; headline = first sentence, body = the rest;
   route through `emptyStates.js`, no literals in JSX):
   - Games: headline "Review game footage for highlights and learning opportunities." body "Mark
     plays from game video you want to review with your athlete. Create clips you want to use in
     highlights."
   - Clips: headline "Focus the action on your athlete." body "Clips you marked can be framed.
     Framing focuses the camera on your player and lets you trim and add slo-mo to key moments. A
     short clip can also skip straight to Framing, no game needed." (`Framing` via
     `MODE_NAMES.FRAMING`.)
   - Reels: headline "Build a highlight reel." body "You can also combine clips together to make
     a full highlight reel." (User gave one line and asked for whatever makes sense; every other
     tab has headline + body, so it gets a short headline. Ruled 2026-09-17.)
   - Published: headline "View your completed work." body "Download or share links with family,
     coaches, and recruiters. If you install the app on your phone you can even post to social
     directly." The user has done this on a phone (ruled 2026-09-17), so the sentence stands.
     Include a **code audit** as part of this task: confirm the PWA share path hands the VIDEO
     FILE to the OS share sheet (`navigator.share` with `files`, share-target manifest) on iOS and
     Android and note where it degrades to a link. A finding is a follow-up task, not a gate on
     this copy.
3. **Remove `FlowStrip`** (`EmptyTabGuide.jsx:113-159`, `FLOW_STEPS` in `emptyStates.js:34-39`)
   and its `STEP_COLORS`; delete, don't hide.
4. **Published empty state**: drop `draftsText(n)` ("You have N clips in progress.") and the
   "Open Clips" button; the headline/body plus the existing `noClipsGamesText` fallback is enough.
   Check `CollectionsTab.jsx:155-163` for the now-unused `clipCount` prop and remove it.
5. Update `EmptyTabGuide.test.jsx` / `emptyStates` tests to the new copy (tests asserting old
   copy get updated, not deleted, per the Shared Vocabulary rule).

## Context

### Relevant Files
- `src/frontend/src/config/emptyStates.js`, `src/frontend/src/config/displayNames.js:183-186`
- `src/frontend/src/components/shared/EmptyTabGuide.jsx` (+ test)
- `src/frontend/src/components/ProjectManager.jsx:1505,1527,2087-2144`
- `src/frontend/src/components/collections/CollectionsTab.jsx:155-163`

### Related Tasks
- Follows T9390 (four-tab guidance screens) and T9860 (copy sweep); this is the user's final
  pass on those screens
- T7630's guided mode anchors to these tabs; land this first so the tour targets stable copy

## Acceptance Criteria

- [ ] All four tabs use one guidance component/style, empty and populated
- [ ] Copy matches the Solution verbatim (after the "post to social" verification)
- [ ] No flow strip, no "Open Clips" button, no in-progress count anywhere on the home tabs
- [ ] 320px and 1280px screenshots attached; tests updated
