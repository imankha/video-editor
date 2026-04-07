# T1060: Coaches View

**Status:** TODO
**Impact:** 9
**Complexity:** 9
**Created:** 2026-04-07
**Updated:** 2026-04-07

## Problem

The app is currently player-only. Coaches are a natural power user — they film games, review footage, and need to communicate specific moments to specific players. There's no way for a coach to assign annotations to players or track which clips were reviewed.

## Solution

A "Coach" account type with its own flow, distinct from the player flow:

### Coach-Specific Features

1. **Roster management** — coaches upload/manage a roster for each of their profiles (teams). Each roster entry is a player name + optional email/phone.

2. **No Projects** — coaches don't create personal highlight reels. Their workflow is: upload game → annotate clips → assign clips to players. The "Projects" concept is replaced by roster-based clip assignment.

3. **Clip assignment** — when annotating, coaches can tag which players should see each annotation. Players are selected from the roster.

4. **Review tracking** — coaches see feedback on which assigned clips each player has viewed. Dashboard shows: player name, clips assigned, clips viewed, last active.

5. **Coach NUF flow** — separate onboarding/quest flow tailored to the coach workflow: upload game → annotate → assign to player → see review status.

### Account Type

- New `account_type` field: `player` (default) or `coach`
- Chosen during signup or switchable in settings
- Coach accounts see different UI: roster tab instead of projects, assignment UI in annotate mode
- Same underlying data model (games, clips, annotations) but different presentation and workflow

### Player Side

- Players receive notifications when coach assigns clips
- Assigned clips appear in a "From Coach" section
- Viewing a clip sends a read receipt back to the coach's review dashboard

## Context

### Relevant Files
- `src/frontend/src/components/HomeScreen.jsx` — Main navigation (Projects tab would be hidden for coaches)
- `src/frontend/src/modes/annotate/` — Annotation workflow (needs clip assignment UI)
- `src/backend/app/services/user_db.py` — User database (needs account_type)
- `src/backend/app/quest_config.py` — Quest definitions (needs coach quest variant)
- New files needed for roster CRUD, clip assignment, review tracking

### Related Tasks
- T1050 (Team Invitations) — coaches also invite players, but through roster upload
- T1070 (Team & Profiles Quest) — player-side quest to learn about profiles/teams
- T85 (Multi-Athlete Profiles) — DONE — profiles infrastructure exists

### Technical Notes
- Roster could be stored in user.sqlite (coach-scoped) or a shared DB
- Clip assignments need cross-user data sharing — coach assigns clip, player sees it
- Review tracking: when player views assigned clip, record timestamp + mark as viewed
- Coach dashboard is read-heavy: aggregate view counts across all players and clips
- This is a large feature — likely needs to be broken into sub-tasks when implementation begins

## Implementation

### Steps (high-level — needs breakdown)
1. [ ] Add account_type to user model (player/coach)
2. [ ] Build roster CRUD (coach uploads player list per profile)
3. [ ] Build clip assignment UI in annotate mode
4. [ ] Build review tracking (player viewed clip → coach sees it)
5. [ ] Build coach dashboard (assigned clips, review status per player)
6. [ ] Build coach NUF/quest flow
7. [ ] Hide Projects UI for coach accounts
8. [ ] Build player "From Coach" section
9. [ ] Notification system for clip assignments

## Acceptance Criteria

- [ ] Coach can create roster for each profile
- [ ] Coach can assign annotations to specific players
- [ ] Coach sees which players have reviewed assigned clips
- [ ] Coach has own onboarding flow (no Projects)
- [ ] Players see assigned clips in dedicated section
- [ ] Account type switchable or set during signup
