# T6660: Rename the feature to "Athlete Intro Card" everywhere user-facing

**Status:** TODO
**Impact:** 5 | **Complexity:** 3
**Epic:** [Player Intro + Rich Text](EPIC.md)
**Follows:** [T6530](../T6530-intro-card-discoverability-ux.md) — UX proposal, approved 2026-08-08

## Problem

T6530's research found the feature calls itself two different things on the same screen, same
scroll: `ProfileIntroSection.jsx` renders `<h3>Player intro card</h3>` as a section heading, and
four fields later `ManageProfilesModal.jsx` renders a button labeled `Intro cards` for the exact
same feature. T6530 proposed standardizing on "Player Intro." **The user reviewed the proposal
2026-08-08 and picked a different, final name: "Athlete Intro Card."** This task renames every
user-facing surface to that term.

## Solution

Sweep every user-facing string (headings, buttons, empty-state copy, modal titles, toast/error
text, the exposure-warning copy, tooltips, aria-labels) referring to the feature and standardize
on **"Athlete Intro Card"** (singular concept name) / **"Athlete Intro Cards"** (plural, library
view where the user manages multiple instances — matches the precedent set for "cards" in the
plural grid, per T6530 Q5). This is copy-only:

- **Do NOT rename internal identifiers** — `intro_cards` table, `IntroCardCarousel.jsx`,
  `IntroCardsModal.jsx`, `intro_card_id`, `player_intro.py`, route paths (`/api/intro-cards`),
  etc. all stay exactly as they are. CLAUDE.md's refactoring rules treat renaming stable internal
  names as a separate, unrequested refactor — this task is UI copy only.
- Grep every literal string containing "intro card", "Intro Card", "Player intro", "Player Intro"
  in `src/frontend/src/components/**` (ManageProfilesModal.jsx, ProfileIntroSection.jsx,
  IntroCardsModal.jsx, IntroCardCarousel.jsx, IntroCardEditor and its slot controls,
  IntroExposureNotice.jsx, ShareModal.jsx) and the edge function
  `functions/shared/[token].js` (if it renders any label text, per T5220).
- `docs/legal/privacy-policy.md` / `PrivacyPolicy.jsx` (T5230 just added draft copy referring to
  "player photos"/intro cards) — update the feature name reference there too so the policy
  matches the shipped UI; this is copy-only, does not change the legal analysis.
- Check `.claude/references/ui-style-guide.md` for a naming-conventions note; update it if the
  old name is recorded there.

## Context

### Relevant Files
- `src/frontend/src/components/ManageProfilesModal.jsx` (button label)
- `src/frontend/src/components/ProfileIntroSection.jsx` (section heading — the exact
  inconsistency T6530 found)
- `src/frontend/src/components/introcards/` — `IntroCardsModal.jsx`, `IntroCardCarousel.jsx`,
  the card editor and its empty/consent-gate states
- `src/frontend/src/components/introcards/IntroExposureNotice.jsx`
- `src/frontend/src/components/ShareModal.jsx`
- `docs/legal/privacy-policy.md`, `src/frontend/src/components/PrivacyPolicy.jsx`

### Related Tasks
- [T6530](../T6530-intro-card-discoverability-ux.md) — the research this decision came out of
- [T6670](T6670-card-selector-inline-create-flow.md), [T6690](T6690-nonactive-profile-dead-end-fix.md) —
  sibling tasks from the same feedback round; if any land first, this rename must sweep whatever
  new copy they introduced too (check merge order before starting)

### Technical Notes
Run last among the T6530-feedback siblings if possible (or re-grep after they land) — T6670 adds
a new inline "create" affordance and T6680 (if landed first) adds default-card copy, both of
which will introduce fresh strings that also need the final name applied. If T6660 lands first
instead, the other tasks should just use "Athlete Intro Card" in their own new copy directly
rather than needing a second pass.

## Classification hint
S/M-tier, frontend-only, mechanical. No schema change, no new abstraction — literal string
sweep + a docs/legal copy edit. Single Reviewer pass is enough; no Architect.

## Acceptance Criteria
- [ ] Every user-facing string for this feature reads "Athlete Intro Card" (singular) or
      "Athlete Intro Cards" (plural library view) — verified in a real browser, not just grep.
- [ ] No internal identifier (table name, component file name, route, prop name) was renamed.
- [ ] `docs/legal/privacy-policy.md` / `PrivacyPolicy.jsx` copy uses the same name.
- [ ] Screenshot diff or live-drive confirms `ProfileIntroSection`'s heading and
      `ManageProfilesModal`'s button now agree.
