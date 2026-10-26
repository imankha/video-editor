# T13420: Guidance switch shows On before settings load, and a tap in that window saves the wrong value

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Tier:** S (frontend settings store)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Outside AI new-user QA run on staging, 2026-10-25/26, reported "Guidance turns back on after a reload". Reproduced on staging 2026-10-26 with Playwright on e2e@test.local.

## Problem

`settingsStore` starts from `DEFAULT_SETTINGS` (`guidance.coachEnabled: true`) and only replaces it when `GET /api/settings` returns. Until then the Guidance switch reads On for a user whose saved setting is Off, and the coach can render. Measured:

- toggle Off after load, reload: switch Off, server Off (persistence itself works)
- reload, then tap the switch as soon as it appears: the tap flips the DEFAULT (shown On) and the switch ends On with the server saved On, although the user had it Off. The user's choice is silently reversed.

So a user who turned guidance off sees it On again right after a reload, and a quick tap to turn it off actually turns it on.

## Solution

Do not show or act on a guidance value until settings have loaded for this profile: render the switch disabled (or as a neutral placeholder) and keep the coach hidden while `isInitialized` is false.

## Context

### Relevant Files
- `src/frontend/src/stores/settingsStore.js` (`DEFAULT_SETTINGS`, `loadSettings`, `setCoachEnabled`)
- `src/frontend/src/components/instructions/GuidanceToggle.jsx`, `GuideScope.jsx`
- `.claude/knowledge/guidance.md` (guidance is a profile-persisted setting)

### Related Tasks
- None

## Acceptance Criteria

- [ ] With the saved setting Off, the switch never shows On after a reload and no coach or shade appears
- [ ] The switch cannot be toggled before settings load
- [ ] A unit test covers both
