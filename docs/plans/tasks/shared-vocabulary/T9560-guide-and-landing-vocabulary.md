# T9560: Onboarding guide, error and landing vocabulary

**Status:** WIP
**Impact:** 5
**Complexity:** 4
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 parent walkthrough of staging. Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
Handoff item(s): **N34, N38-N40, N45, N47, UX-01 (handoff E1-03)**.

> Child of the [Shared Vocabulary epic](EPIC.md). The epic's two binding overrides apply:
> mode names stay **AI Focus** / **Spotlight** (N16/N18 overridden), and statuses are not
> re-modelled (N22 overridden, T8470's Draft/Shared stands). Internal APIs, routes, store keys and
> analytics vocabulary are never renamed for UI consistency.

## Problem

The onboarding system calls itself three things ("quests" internally, "Get Started" on screen,
"Quest not complete" in errors) and **introduces the word "quest" to the user only at the moment
something fails.** The failing step is named by its internal id (`watch_annotate_tutorial`) rather
than by the task the user can see ("Watch Your Clips Back"), so the error names a thing that is not
on screen. Sharing controls state an action and a state in the same words.

## Rename table

| Group | Observed | Becomes |
|-------|----------|---------|
| N34 | Shared / Shared w/ Tagged Teammates / Share Annotations | **Sharing settings** / **Share plays** - never imply sharing that has not occurred |
| N38 | Get Started / Help 5/5 / Continue / Now cut your first play | **Getting started** -> next step derived from saved progress |
| N39 | quests / Get Started / "Quest not complete" | **Getting started** / **Step not complete** - never introduce "quest" only on failure |
| N40 | watch_annotate_tutorial / Watch Your Clips Back / Playback Annotations | **Preview your plays** - one label in guide, action and error; internal id in expandable detail only |
| N45 | Failed to send report / Try again | **Report not sent** / **Retry report**; claim content is preserved only if it is |
| N47 | fullscreen legacy labels | same action vocabulary in both modes |
| UX-01 | landing copy | division of work plus a policy-accurate cost example |

## Context

### Relevant Files
- `src/frontend/src/config/questDefinitions.jsx`, `src/data/questDefinitions.js`
- `src/frontend/src/components/QuestPanel.jsx`
- `src/backend/app/routers/quests.py` - the user-facing error strings
- `src/frontend/src/components/ReportProblemButton.jsx`
- `src/landing/` - separate Astro deploy

### Related Tasks
- T9410 owns the quest completion **bug**; this task owns its **words**. Sequence after it so the
  copy describes real behavior.
- T9400 owns the report-send failure; N45's wording lands with it or here, not twice
- T9500 owns fullscreen parity (N47's actual work)
- T9650 owns the landing copy's policy content; **depends on T9680** for verified rules

### Technical Notes
Internal ids stay internal but stay reachable - keep them in expandable diagnostic detail, since
they are what makes a user's screenshot actionable for us.

## Acceptance Criteria

- [ ] The onboarding system has one name in guide, action and error copy
- [ ] Errors name the visible task, never an internal step id in primary copy
- [ ] Internal ids remain available in expandable diagnostic detail
- [ ] Sharing controls distinguish the action from the current state
- [ ] No landing copy ships ahead of T9680's confirmed rules
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
