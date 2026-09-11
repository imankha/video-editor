# T9410: Guide shows 5/5 while Continue rejects 'watch_annotate_tutorial'

**Status:** STAGING
**Impact:** 8
**Complexity:** 5
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **B3, UX-15 (handoff E2-01)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

Andrew's screenshot shows all five Get Started items checked, including **Watch Your Clips Back**,
with Continue still present. Clicking it produced:

> Something went wrong. Quest not complete: step 'watch_annotate_tutorial' is incomplete.

Separately, the original walkthrough saw **Continue** turn to *Saving...* and return without
advancing, silently. **These may be two symptoms of one cause or two different faults** - the
handoff explicitly does not claim they are the same, and neither should we.

The onboarding funnel dead-ends here: the user cannot finish setup, and the report they tried to
file about it also failed (T9400).

## This is a recurrence, not a new bug class

`src/backend/tests/test_delete_reregister_newuser_flow.py` documents **prod bug 35p** with the
*exact* same message. Its root cause was a delete-then-reregister account whose restored
user-scoped quest state disagreed with a fresh profile's step data: `GET /progress` reported the
quest complete while `POST /claim-reward` re-derived the steps and 400'd. That was fixed by making
deletion cache-safe and by having claim-reward honor the same completed set `/progress` uses.

Andrew hit it on staging on 2026-09-09, so either his account went through that path, or **a second
route produces the same disagreement between the displayed and the authoritative state.** Start by
determining which - reproducing on a genuinely fresh account is the discriminator.

## Solution

1. Reproduce on staging. Establish whether Andrew's account had been deleted/reregistered.
2. Trace the authoritative completion state for `watch_annotate_tutorial`
   (`routers/quests.py:197` derives it from `'watched_annotate_tutorial' in achieved`) against what
   the panel renders. **The displayed 5/5 and the rejected claim must not be able to disagree** -
   that is the invariant, whatever the mechanism.
3. Fix the established cause. Do not add a defensive reconciliation that papers over an internal
   state disagreement (CLAUDE.md: no defensive fixes for internal bugs).
4. User-facing copy: name the human task that is actually incomplete, never the internal step id.
   Keep the step id in expandable diagnostic detail (N39, N40).
5. If playback completed but the progress write failed, say *that* - do not tell the user to redo
   work they already did.

## Context

### Relevant Files
- `src/backend/app/routers/quests.py` - progress derivation and claim-reward
- `src/backend/app/quest_config.py` - step definitions
- `src/frontend/src/config/questDefinitions.jsx`, `src/data/questDefinitions.js`
- `src/frontend/src/components/QuestPanel.jsx`
- `src/backend/tests/test_delete_reregister_newuser_flow.py` - the 35p regression net

### Related Tasks
- T9400 - the report that would have told us about this also failed
- T9440 - the stale first-play guidance is the same "displayed state is not derived from saved
  progress" family, but a separate surface
- T8690 gated the *watch tutorial video* quest steps behind `TUTORIAL_VIDEOS_ENABLED=false`;
  confirm what that leaves live on staging before reproducing.

### Technical Notes
Bug-reproduction discipline: **failing test first**, then fix. The 35p test file is the model.

## Acceptance Criteria

- [ ] The mechanism behind the 5/5-versus-rejected disagreement is established and documented
- [ ] A displayed 5/5 and a rejected completion cannot coexist
- [ ] The original silent Saving... non-advance is either explained by the same cause or filed separately
- [ ] Error copy names the human task, never the internal step id
- [ ] A failing regression test exists before the fix and passes after
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
