# T9510: Transient "Unable to play media" is exposed to assistive technology during a normal load

**Status:** WIP
**Impact:** 4
**Complexity:** 3
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **B5, UX-13 (handoff E2-04)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

Saving the first play, creating its draft and clicking Playback Annotations put the accessibility
state into **"Unable to play media"**. A later capture showed the video at 0:06/0:06 with playback
marked complete, so **this was not a persistent playback failure** - it is an error state exposed
during normal initialization, and it is an accessibility observation only.

## Solution

Keep normal media initialization in a **loading** state. Only expose an error once a real failure is
established, and pair it with a recovery action. Verify what assistive technology actually
announces during a slow load, rather than inferring it from the DOM.

## Context

### Relevant Files
- `src/frontend/src/hooks/useVideo.js` - media error mapping (`MEDIA_ERR_*` handling)
- Playback Annotations entry point

### Related Tasks
- T8310 (STAGING) deliberately distinguishes a reclaimed-source 404 from a format error in the same
  hook - align with the state model it introduced rather than adding a parallel one
- T9470 - the same "no feedback then a wrong signal" family on preview

### Technical Notes
Low priority and low confidence by design. Confirm the announcement is real before changing code.

## Acceptance Criteria

- [ ] Normal initialization stays in a loading state and announces no error
- [ ] A genuine failure announces once, with a recovery action
- [ ] The assistive-technology behavior is verified, not inferred
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
