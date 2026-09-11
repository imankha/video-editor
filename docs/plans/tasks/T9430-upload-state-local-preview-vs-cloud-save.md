# T9430: Upload shows real Preparing/Uploading/Saved/Failed state; a local preview never implies saved

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **UX-04, B1, N37 (handoff E3-02)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

During the failed upload the parent could see their video playing while being told the game did not
upload. A visible local preview reads as "it worked". The progress copy ("Computing hash",
"Hash complete", "15%") is engineering vocabulary that offers no recovery guidance, and the failure
text ("Failed to fetch") names a fetch API, not a thing the parent can act on.

## Solution

Render four explicit states from the real upload state machine, next to the preview:

- **Preparing** (local work: probe, hash)
- **Uploading** with honest progress
- **Saved** - only after server acknowledgement
- **Upload failed** - with the file, name and metadata still held, a **Retry upload** action, and a
  **Choose another file** escape

Label the preview itself as local until persistence is confirmed ("Local preview - not saved online
yet"). Disable duplicate submissions while one is in flight. Surface actionable network/size/format
causes **only when known**; never invent a diagnosis.

## Context

### Relevant Files
- Add Game modal and its upload hook (frontend)
- `src/frontend/src/config/displayNames.js` - if new copy constants are needed, they belong here
  (single source, per T8555/T8380 precedent)

### Related Tasks
- Depends on: T9420 (the state machine should reflect what the diagnosis finds, not guesses)
- T9540 owns the N37 progress vocabulary (Preparing video / Uploading / Rendering)

### Technical Notes
Persistence rule (CLAUDE.md): the "Saved" transition is driven by the gesture's own response, never
by a `useEffect` watching state.

## Acceptance Criteria

- [ ] Preparing, Uploading, Saved and Upload failed each reflect real upload state
- [ ] A visible local preview is labelled as not-yet-saved until the server acknowledges
- [ ] A failure keeps the file and metadata and offers Retry upload
- [ ] Duplicate submissions are blocked while an upload is in flight
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
