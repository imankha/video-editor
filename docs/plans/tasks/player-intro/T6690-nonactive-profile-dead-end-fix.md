# T6690: Non-active-profile card management — replace the dead grey text with a real action

**Status:** TODO
**Impact:** 6 | **Complexity:** 2
**Epic:** [Player Intro + Rich Text](EPIC.md)
**Follows:** [T6530](../T6530-intro-card-discoverability-ux.md) — UX proposal, approved 2026-08-08

## Problem

Confirmed live by T6530's research: editing a profile that isn't the currently active one
renders one line of plain `text-gray-500` — "Switch to this profile to manage its intro cards."
— with no button, no link, no affordance at all (`ManageProfilesModal.jsx:433`). On mobile
(375px) it's even easier to miss. This is a genuine dead end, not a judgment call.

Root cause (traced, don't re-derive): `intro_cards.py` resolves scope entirely from
`get_current_profile_id()`, which reads the `X-Profile-ID` request header — stamped by a single
**global** module variable (`_currentProfileId` in
`src/frontend/src/utils/sessionInit.js`), updated only by `reinstallProfileHeader()` on an actual
profile switch. There is no per-request override today, so "view another profile's card library
without switching" is a real backend-plumbing gap, not a copy/CSS fix. The sibling
`ProfileIntroSection` (photo, full name, position/class/team, consent) directly above this
button has NO such gate — only the card library itself is current-profile-scoped.

## Solution

Replace the grey text with a real button that chains two gestures the app already has — do not
add new plumbing (`X-Profile-ID` per-request override is explicitly out of scope):

```
On click: switchProfile(p.id) [existing gesture, already used by the profile-row click]
          -> once the switch resolves, open the card library (IntroCardsModal) for the now-active profile
```

Button copy: "Switch to '{profile name}' & manage cards" (or the final "Athlete Intro Card"-name
equivalent — coordinate with T6660 on exact wording/merge order). Style it as a real control
matching the existing "Athlete Intro Card(s)" button's visual weight, not another line of muted
text.

## Context

### Relevant Files
- `src/frontend/src/components/ManageProfilesModal.jsx:433` — the exact site
- `switchProfile` — existing gesture, already invoked by profile-row clicks in the same modal
- `src/frontend/src/utils/sessionInit.js` — where `_currentProfileId` / `reinstallProfileHeader`
  live, for reference only (not being changed by this task)

### Related Tasks
- [T6530](../T6530-intro-card-discoverability-ux.md) — Q4, the source of this fix
- [T6660](T6660-rename-athlete-intro-card.md) — button copy should use the final name; check
  merge order so this doesn't ship with a name that immediately needs a second edit

## Classification hint
S/M-tier, frontend-only, single component. No schema/backend change — chains two existing
gestures. Low risk, ship independently, no need to wait on any other T6530-feedback sibling.

## Acceptance Criteria
- [ ] Non-active-profile edit view shows a real, clickable control instead of plain grey text.
- [ ] Clicking it switches to that profile AND opens its card library in one action.
- [ ] Verified live at desktop and 375px (T6530's screenshots `06-...` and `21-...` are the
      "before" reference — take matching "after" shots).
- [ ] `ProfileIntroSection`'s existing no-gate behavior (photo/name/facts editable on any
      profile) is unchanged — this task only touches the card-library row.
