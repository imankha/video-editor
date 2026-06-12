# T3640: Season Highlights + Unlock Moment

**Status:** TODO
**Impact:** 9
**Complexity:** 5
**Created:** 2026-06-12

## Problem

The flagship artifact -- a self-assembling "best of the season" video with a user-set length -- does not exist, and the paradigm shift it introduces (rank instead of edit) needs a deliberate, celebratory introduction with explicit opt in/out rather than silently appearing.

## Solution

Season Highlights collection (scope = current season, per-ratio) + time-budget slider + the "Season Highlights Unlocked" moment. See [EPIC.md](EPIC.md) decisions #6, #7, #8; modal copy draft in spec section 5.

### Season collection (SEASON section atop Collections tab)

- Uses T3610's CollectionHeader; scope = current season via the existing season helper ([downloads.py:65-72](../../../../src/backend/app/routers/downloads.py), e.g. "Spring 2026"); one collection per ratio with content; single-game reels only (EPIC decision #11).
- Membership: reels in rank order (T3630 comparator), greedy-with-skip until the time budget is spent; "Max" = no cap. Playback = rank order.
- **Slider**: detents 30s / 1m / 2m / 3m / 5m / Max; `<input type="range">` styled per VideoControls track convention. Value persists to `collection_settings.season_target_duration` (table from T3630's v008) via a small surgical endpoint -- written on slider release gesture only.
- Past seasons: collapsed "Past seasons" group; their collections (and live links) stay reachable and naturally stop changing.
- Share verb passes `{scope: {type:'season', season_label}, ratio}` through T3620's pipeline -- zero new share plumbing.

### Unlock moment

- **Trigger**: active profile's `SUM(duration) WHERE published_at IS NOT NULL` crosses 30s. Checked (a) after each publish success, (b) once post-bootstrap on app load ([App.jsx:163-225](../../../../src/frontend/src/App.jsx), after stores hydrate, before preloader dismissal) so existing over-threshold users get it on their first session after release. Shown only when `pref.seasonHighlightsChoice` is unset. Threshold sum can ride the bootstrap/downloads payload -- derive, don't store.
- **Modal**: full-screen, standard pattern, **no backdrop close**; fanfare + celebration glow. Extract `playSound` from [QuestPanel.jsx:81-113](../../../../src/frontend/src/components/QuestPanel.jsx) into shared `utils/sounds.js` (QuestPanel consumes the util -- no behavior change there); reuse `quest-celebrate` CSS. **Autoplay rule**: publish-triggered opens may play fanfare immediately (recent gesture); load-triggered opens play it on the accept click.
- **Accept** -> `pref.seasonHighlightsChoice='enabled'` (settingsStore -> PUT /api/settings), record achievement `season_highlights_optin` (questStore.recordAchievement), open Collections with Season Highlights expanded, run T3630's batch swipe-through seeded by quality order.
- **Not now** -> `'declined'`: no prompts, no ranking UI; quiet locked "Season Highlights -- Enable" card stays at the top of Collections (one click re-opens the modal flow).
- This task owns the `seasonHighlightsChoice` flag (settingsStore defaults + gating helper consumed by T3630's prompts).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/collections/SeasonHighlightsSection.jsx` - NEW (header + slider + past seasons + locked card)
- `src/frontend/src/components/collections/SeasonUnlockModal.jsx` - NEW
- `src/frontend/src/utils/sounds.js` - NEW (extracted synth)
- `src/frontend/src/components/QuestPanel.jsx` - consume sounds util
- `src/frontend/src/stores/settingsStore.js` - `seasonHighlightsChoice` + `season_target_duration` is NOT here (per-profile, see backend)
- `src/frontend/src/App.jsx` - post-bootstrap trigger + modal mount
- `src/frontend/src/components/ProjectManager.jsx` - publish-success trigger (alongside T3630 hook)
- `src/backend/app/routers/downloads.py` (or collections router) - season membership query + `collection_settings` get/set endpoint
- `src/backend/app/routers/quests.py` - `season_highlights_optin` achievement key registration (full quest rework is T3660)
- `src/frontend/src/index.css` - celebration reuse

### Related Tasks
- Depends on: T3600 (durations for gate + budget), T3610 (CollectionHeader/Collections tab), T3620 (share pipeline), T3630 (rank order, batch prompt, v008 settings table)
- Blocks: T3660 (quest steps reference optin + 30s), T3670 (eligibility/locked-card pattern established here)
- Ships with: T3650 + T3660 (paradigm release, EPIC decision #12)

### Technical Notes
- Greedy-with-skip: walk rank order; if next reel exceeds remaining budget, keep walking for one that fits. Deterministic, unit-tested as a pure function shared with the share resolver (backend) -- membership must be identical in-app and behind links.
- NULL-duration reels: excluded from budget math, listed in the panel with a subtle "no duration" marker (no silent fallback).
- Per-profile vs per-user: opt-in flag is user-level (`pref.*`); slider is per-profile (`collection_settings`). Deliberate -- different athletes, different content volume.

## Implementation

### Steps
1. [ ] Backend: season membership query (shared pure budget function) + collection_settings endpoints
2. [ ] sounds.js extraction (QuestPanel regression-checked)
3. [ ] SeasonHighlightsSection with slider + past seasons + locked/declined card
4. [ ] SeasonUnlockModal + both triggers + flag persistence + achievement
5. [ ] Wire batch ranking swipe-through on accept
6. [ ] Season share via T3620 pipeline
7. [ ] Tests: budget function (skip, Max, NULL durations), gate triggers (fresh under-30s user; existing over-30s user on load; declined never re-prompts), Vitest slider gesture persistence, E2E unlock accept flow

### Progress Log

## Acceptance Criteria

- [ ] Crossing 30s published duration shows the unlock modal once; accept enables ranking UX + opens Season Highlights; decline leaves a locked card and suppresses all prompts
- [ ] Existing users over threshold get the moment on first load after release
- [ ] Slider changes membership live and persists per profile on release gesture
- [ ] Season Highlights membership identical in panel and share link (shared budget function test)
- [ ] Fanfare plays on publish-triggered opens; on accept-click for load-triggered opens
- [ ] Tests pass
