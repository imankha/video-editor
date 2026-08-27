# T7840: Quest "Add Your First Game" step is inert + zero-games triple prompt (bug 46p)

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-08-27
**Updated:** 2026-08-27

## Classification

**Tier:** M (bug-fix-sized UX fix: 3 files, 1 layer, no new abstractions, no schema change)
**Stack Layers:** Frontend
**Files Affected:** ~3 files (QuestPanel.jsx, questStore.js, ProjectManager.jsx)
**LOC Estimate:** ~40-60 lines
**Test Scope:** Frontend Unit (QuestPanel step-row behavior; curated relevant set, not a layer sweep)
**Knowledge Docs:** none - the quest/home surface has no `.claude/knowledge/` doc; the audit
in this file's Context section stands in for it (entry points and patterns already mapped)

| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | No | Audit already done at task creation; entry points, idioms, and line refs are in this file |
| Architect | No | Follows two existing in-file patterns (WatchTutorialButton store-action idiom, detectionAssignProgress ephemeral state); no new abstractions |
| Tester | No (Phase 1) | M tier; one new unit test written alongside implementation |
| Reviewer | Yes | M-tier default: one fresh-context Reviewer on the diff before commit |
| Migration | No | No schema change |

## Problem

Bug 46p (prod, 2026-08-24): a brand-new user on a 320px iPhone logged in, stared at the
zero-games home screen for ~2 minutes, and filed a wordless bug report without ever tapping
a real action. Their only breadcrumb is `login`. (The NULL-description half of this report
was already fixed by T7560; this task is the UI-confusion half.)

Two concrete confusions on the zero-games home screen:

1. **The "Get Started" quest's current step row looks tappable but does nothing.** The step
   rows in QuestPanel are plain `<div>`s, yet the current step ("Add Your First Game") gets a
   highlight, a pulsing checkbox, and a ChevronRight - every mobile affordance for "tap me".
   A new user taps the most visually dominant element on the screen and nothing happens.
2. **Three stacked prompts for the same single action** on a 320px screen: the green
   "Add Game" button, the "No games yet / Add a game to annotate your footage" empty state,
   and the quest card's "Add Your First Game / Add a game to start clipping highlights".
   The most prominent of the three is the inert one.

(The scrambled header in the bug screenshot is an html2canvas capture artifact, not a real
layout bug - out of scope.)

## Solution

1. **Make the current quest step actionable where it has an obvious gesture.** Follow the
   existing WatchTutorialButton idiom (quest UI triggers a store action; the owning component
   responds). ProjectManager registers its existing `handleAddGameClick` (auth-gated) as an
   ephemeral opener in questStore while mounted; QuestPanel renders the `upload_game` current
   step as a real button invoking it. Mirrors the existing ephemeral `detectionAssignProgress`
   pattern (never persisted).
2. **Chevron only on actionable rows.** The ChevronRight renders only when the row actually
   does something on tap; non-actionable steps (including tutorial steps, which carry their own
   embedded CTA button) lose the false affordance.
3. **Dedupe the zero-games empty state.** Drop the "Add a game to annotate your footage"
   sub-line; keep the muted "No games yet" status line. The green button + quest card carry
   the CTA.

Related: the Tutorial Redesign epic (T7620-T7640) will eventually replace quest_1's
watch-video flow with a guided tour; this is the cheap immediate fix and does not conflict
(it touches step-row interactivity, not quest structure).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/QuestPanel.jsx` - step row rendering (rows are divs, chevron at ~line 360)
- `src/frontend/src/stores/questStore.js` - add ephemeral addGameOpener registration
- `src/frontend/src/components/ProjectManager.jsx` - register handleAddGameClick; empty-state copy (~line 1166)

### Related Tasks
- T7560 (DONE) - required a description on bug reports; cites this same prod row #46
- Tutorial Redesign epic T7620-T7640 - future overhaul of the same surface, sequenced later

### Technical Notes
- Opener is registration-on-mount, cleared on unmount; NOT included in questStore.reset()
  (component-lifetime wiring, not user data). Never persisted.
- `handleAddGameClick` already wraps `requireAuth`, so the pre-login quest panel (T1330)
  gets the login modal first - correct.
- `upload_game` can only be the current step on the home screen (no game means no editor
  modes), so the floating editor-mode QuestPanel never needs the opener; when unregistered
  the row simply stays non-actionable.

## Implementation

### Steps
1. [ ] questStore: `addGameOpener` + `setAddGameOpener` (ephemeral, commented)
2. [ ] ProjectManager: register/unregister opener; trim empty-state sub-line
3. [ ] QuestPanel: current-step row becomes a button when actionable; chevron only then
4. [ ] Unit test: upload_game row invokes opener; no chevron when not actionable
5. [ ] Reviewer pass on diff; commit

## Acceptance Criteria

- [ ] Tapping "Add Your First Game" on the zero-games home screen opens the same
      Game Details modal as the green Add Game button (auth-gated identically)
- [ ] Non-actionable current steps render no chevron
- [ ] Zero-games games tab shows a single status line, not two CTA-duplicating lines
- [ ] Relevant frontend unit tests pass
