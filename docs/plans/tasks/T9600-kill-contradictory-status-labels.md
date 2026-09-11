# T9600: One private draft must not read Complete, Ready to share and Ready to Publish at once

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **UX-13, N22 (handoff E7-01, narrowed)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

The walkthrough found the **same** private draft labelled **Complete**, **Ready to share** and
**Ready to Publish** across the card, the detail view and the guide. Three vocabularies for one
state, one of which ("Ready to share") implies an audience that does not exist yet.

## Scope decision (user, 2026-09-10)

The handoff proposed replacing the model with **Draft -> Rendering -> Ready to publish ->
Published**. **We are not doing that.** T8470 ("One status story for a reel", STAGING) already binds
status to a **Draft/Shared** collapse with `draftStage.js` as the single source, and that decision
stands.

This task is narrowed to **removing the contradictions**: every surface reads its status from the
single source, and no surface invents a fourth word. Publication status follows server success,
never render completion.

## Solution

1. Inventory every status string rendered for a clip or reel (card, detail, toast, guide, menu).
2. Route them all through `draftStage.js`.
3. Delete the strays ("Complete", "Ready to share", "Ready to Publish" where they are not the single
   source's word). Editing stage, where it needs showing, is shown *separately* from status.
4. Confirm a private draft is never described in terms that imply it is already shared.

## Context

### Relevant Files
- `src/frontend/src/**/draftStage.js` - the single source (T8470)
- `DraftTile.jsx`, `SegmentedProgressStrip`, `PublishedReelsPanel.jsx`, `ProjectManager.jsx`
- `src/frontend/src/config/displayNames.js`

### Related Tasks
- T8470 (STAGING) - the binding decision. **Verify against it on staging first**: it may already
  have removed some of these strings, in which case this task shrinks to the survivors.
- T9530 - tab and object naming, same surfaces

### Technical Notes
If T8470 turns out to have fixed all of this already, close the task with that finding recorded
rather than implementing redundantly (the T8400 precedent).

## Acceptance Criteria

- [ ] Every status string for a clip or reel derives from the single source
- [ ] No surface shows a status word the single source does not define
- [ ] A private draft is never labelled in terms implying it is shared
- [ ] Publication status follows server success, not render completion
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
