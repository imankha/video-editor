# T6830: New-user home screen: default to Games tab, disable Reel Drafts when it's a dead end

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-08-11
**Updated:** 2026-08-11

## Problem

For a brand-new user who has never uploaded a game, the home screen (Project Manager) can land
on or invite them into the Reel Drafts tab, which is a dead end: there are no draft reels to
show, and the "New Reel" button is disabled (it requires at least one game with extracted
clips — `hasClips`). Two rules should hold:

1. **A user who has never uploaded a game defaults to the Games tab** — that is the only tab
   with an actionable next step ("Add Game").
2. **When there are no draft reels AND "New Reel" is disabled, the Reel Drafts tab button
   itself should be disabled** — clicking into it can only present an empty list with a
   disabled action button.

## Solution

In `ProjectManager.jsx`:

- **Default-tab rule:** the bare-`/home` default already picks `games` when
  `projects.length === 0` (`initialTab`, ~line 135) and only flips to `projects` once projects
  load (`hasSetInitialTab` effect, ~line 517). Verify the never-uploaded case end to end
  (including the `sessionStorage` tab hint and `/home/reels` deep-link paths) and close any
  path that lands a gameless user on Reel Drafts. A deep link to `/home/reels` for a user in
  the disabled state should fall back to Games rather than render a dead tab.
- **Disabled tab rule:** compute the same condition the New Reel button uses
  (`projects.length === 0 && !hasClips`) and set `disabled` + disabled styling + a tooltip
  (mirroring the New Reel button's `title` hint, e.g. "Extract clips from a game first using
  Annotate mode") on the Reel Drafts tab button (~line 816). Keep it purely derived — no new
  state, no persistence (view state is never persisted).

Note the asymmetry is intentional: with clips extracted but zero drafts, Reel Drafts stays
enabled (New Reel is the actionable step there). The tab is disabled only when BOTH are true.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx` — `initialTab` derivation (~135), initial-tab
  effect (~517), tab buttons (~796-834), New Reel button + `hasClips` gate (~132, ~848-858)
- `src/frontend/src/components/ProjectManager.publishRetry.test.jsx` — existing test harness
  pattern for this component (mocking pattern reference; add a new focused test file)

### Related Tasks
- T5677 — made the active tab URL state (`/home/games`, `/home/reels`); URL-named tabs are
  authoritative over the count-based default. The disabled-state fallback must not regress the
  deep-link behavior for users who DO have games/clips.
- T5673/T5681 — poster-tile home rework this sits on top of.

### Technical Notes
- `hasClips = games.some(g => g.clip_count > 0)` is the existing New Reel gate — reuse it,
  don't invent a second condition.
- Disabled condition is derived per render from `projects` + `games`; both lists load async,
  so make sure the tab doesn't flash disabled->enabled in a jarring way while loading
  (`loading`/`gamesLoading` are available).
- No backend work; no persistence (per no-persisted-view-state rule).

## Implementation

### Steps
1. [ ] Add derived `reelDraftsDisabled` condition (no drafts && !hasClips), wire `disabled` +
       styling + tooltip on the Reel Drafts tab button
2. [ ] Guard tab-selection paths (initial default, sessionStorage hint, `/home/reels` deep
       link) so a disabled-state user lands on Games
3. [ ] Unit tests: default tab for never-uploaded user; Reel Drafts disabled when
       (no drafts && no clips); enabled when clips exist or drafts exist; deep-link fallback
4. [ ] Lint + relevant test set green

### Progress Log

**2026-08-11**: Task filed under new "Deploy Candidate" milestone.

## Acceptance Criteria

- [ ] Fresh account (no games, no drafts): home lands on Games tab, Reel Drafts tab is
      visibly disabled with an explanatory tooltip
- [ ] `/home/reels` deep link in that state falls back to Games (no dead tab)
- [ ] User with a game + extracted clips but no drafts: Reel Drafts tab enabled (New Reel is
      the next step)
- [ ] User with drafts: unchanged behavior, drafts-count default still works (T5677 intact)
- [ ] Tests pass
