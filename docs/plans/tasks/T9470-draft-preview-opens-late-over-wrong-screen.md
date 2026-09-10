# T9470: Draft Preview appears to do nothing, then opens a dialog over a different screen

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **B6, UX-13 (handoff E7-02)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

Saving a rendered highlight with Publish Later, reopening the app, going to In Progress Clips and
clicking **Preview** left the library visible with no player and no loading feedback. After a retry
and navigating to other views, **a preview dialog eventually appeared over the Annotate screen.**

Limits: two clicks in one sequence, not two independent reproductions. Timing was not instrumented.
The screenshots show a delayed dialog, **not proof the render was broken.**

## Solution

1. Open the dialog shell **immediately** with a loading state, so the click always has a visible
   consequence.
2. Deduplicate in-flight requests so a second click does not queue a second dialog.
3. **Scope the async result to the item and page that asked for it** - if the user has navigated
   away, the result is cancelled or discarded, never rendered over an unrelated screen.
4. Provide a retry path on a slow or failed load.

## Context

### Relevant Files
- In Progress Clips panel / `DraftTile` preview action
- `DraftReelPreview` (T8535 consolidated the separate draft-preview modal into it)
- The preview fetch hook and its cancellation

### Related Tasks
- T9600 - the status labels on the same card
- T8535 (STAGING) consolidated these modals; **verify against the consolidated component**, not the
  pre-T8535 structure

### Technical Notes
"Cancel or scope the result when navigating away" is the substantive half. An immediate shell alone
would hide the late-dialog bug rather than fix it.

## Acceptance Criteria

- [ ] The preview shell opens immediately with a loading state on every click
- [ ] Navigating away while loading produces no late popup on another screen
- [ ] Repeat clicks do not queue duplicate requests or dialogs
- [ ] A slow or failed load offers retry
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
