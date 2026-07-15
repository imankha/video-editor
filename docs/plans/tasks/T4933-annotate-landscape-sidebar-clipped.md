# T4933: Annotate clip-editor sidebar controls unreachable on phone landscape

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-15
**Updated:** 2026-07-15

## Problem

Found by the T4930 mobile/viewport usability matrix on its first run (this is exactly
the class of bug T4930 was built to surface). On a phone in **landscape** wide enough
(>= 640px, the Tailwind `sm` breakpoint) to render the desktop Annotate clip-editor
sidebar (`AnnotateFullscreenOverlay`, `hidden sm:flex`, `w-[352px]`), the sidebar's
content is ~546px tall while the landscape viewport is only ~390-412px. The app shell
is `h-dvh overflow-hidden` ([App.jsx:726](../../src/frontend/src/App.jsx#L726)) with
**no inner scroller for that sidebar**, so the controls at the bottom — **Save /
Update, Delete Clip, Distribution** — are clipped below the fold and cannot be
scrolled into view or clicked. Same failure class as T4880 (which fixed Framing/Overlay
by defaulting mobile to an inline scrollable layout) but T4880 did not cover Annotate's
landscape sidebar path.

**Reproduces:** iPhone 14 (844x390 landscape) and Pixel 7 (915x412 landscape).
**Does NOT reproduce:** iPhone SE (568px landscape width < 640, so the sidebar stays
`hidden`), tablet/desktop (portrait height fits the 546px content).

Evidence: `screen-usability.spec.js` fails the Annotate landscape audit with
`[usability] dead scroll trap: <button> "Save" is clipped inside a non-scrolling
container (content 546px in a 390px clip box)`. Currently tracked as a
`knownIssues` entry (task `T4933`) in
[screenManifests.js](../../src/frontend/e2e/manifests/screenManifests.js) so the audit
suite stays green; the entry SELF-HEALS (the audit throws if the failure stops
reproducing, forcing removal when this task lands).

## Solution

Give the Annotate clip-editor sidebar its own scroll region so its controls are
reachable when its content exceeds the viewport height, mirroring T4880's Framing/
Overlay fix (inline scrollable pane inside the `h-dvh overflow-hidden` shell). Likely:
make the sidebar column `min-h-0 overflow-y-auto` within the shell (or cap it to the
visible viewport and scroll internally). Verify Save/Delete Clip/Distribution are
reachable + clickable in landscape on iPhone 14 and Pixel 7.

## Acceptance Criteria

- [ ] Annotate clip-editor sidebar Save/Delete Clip/Distribution reachable + clickable
      on iPhone 14 and Pixel 7 in landscape.
- [ ] Remove the `T4933` entry from `screenManifests.js` `knownIssues` — the audit's
      self-heal check confirms the fix (it throws if the entry is stale).
- [ ] No regression to portrait Annotate or desktop.

## Context

### Relevant Files
- `src/frontend/src/App.jsx` (~726) — `h-dvh overflow-hidden` shell
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` — the sidebar/panel
- `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` — renders the panel
- `src/frontend/e2e/manifests/screenManifests.js` — remove the knownIssues entry on fix

### Related Tasks
- Found by: T4930 (usability matrix). Same class as: T4880 (Framing/Overlay reachability).
