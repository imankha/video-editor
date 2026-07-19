# T5510: Create + Join UX

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-07-19
**Updated:** 2026-07-19

## Problem

T5500's backend exists but there is no way to create a shared game, send the link, or join
from it. See [EPIC.md](EPIC.md) § UX Flows 1-3 for the settled flows (create modal + share
sheet, `/shared-game/{token}` landing card, camera-slot status block).

## Solution

Frontend only (T5500's endpoints are the contract):

1. **Create entry points** — (a) in the Add Game flow: a low-key "Two cameras at this game?
   Invite the other team's camera" affordance; (b) on an existing game card's menu: "Invite
   the other camera" (passes `local_game_id`, pre-fills name/date from the game).
2. **Create modal** — fields: name (required), date (required, default today), time
   (optional), location (optional). Submit → `POST /api/shared-games/` → success state
   shows the link with `navigator.share` (mobile) / copy-to-clipboard (desktop) and a
   prefilled message. No backdrop-close (project rule).
3. **Landing route `/shared-game/{token}`** — SPA route rendering the game-info card from
   `GET /api/shared-games/token/{token}`: name, date/time, location, creator display name,
   slot statuses. CTA: signed-in → "Join this game" → `POST .../join` → navigate to the new
   game; signed-out → sign-up/sign-in (existing auth flow), join completes via T5500's
   deferred resolution, user lands on the game after auth. Revoked/unknown token → friendly
   dead-link state.
4. **Camera-slot status block** — on the game card (and/or game detail) for games with
   `shared_game_id`: two rows ("Your camera — 2 videos ✓" / "Sam's camera — waiting"),
   driven by `GET /api/shared-games/{id}`. Upload CTA appears on your own empty slot and
   routes into the EXISTING Add Game upload (binding is T5520's job — until it lands the
   CTA can navigate to plain upload).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/App.jsx` — route registration for `/shared-game/{token}`
- Game card / games list components (`src/frontend/src/components/` — locate GameCard + its menu; Code Expert confirms exact files) — create entry point (b) + slot status block
- Add Game / upload entry component — create entry point (a)
- NEW: `src/frontend/src/components/SharedGameCreateModal.jsx`, `src/frontend/src/screens/SharedGameLanding.jsx` (names per ui-style-guide conventions)
- `src/frontend/src/stores/gamesDataStore.js` — shared-game state lives HERE (selectors), not new component-local useState graphs
- `src/frontend/e2e/` — NEW spec for create→copy-link→join

### Related Tasks
- Depends on: T5500 (all endpoints)
- Blocks: T5520 (upload CTA binding target)
- Related: T4890/T4840 edge OG-unfurl pattern — optional stretch so the texted link unfurls with game name/date; do NOT block on it

### Technical Notes
- Knowledge docs: [annotate.md](../../../.claude/knowledge/annotate.md) (games store patterns), [backend-services.md](../../../.claude/knowledge/backend-services.md)
- **UI Designer pass required** before implementation (modal, landing card, slot block —
  match ui-style-guide.md; landing page is seen by brand-new users, it is a first
  impression).
- Auth-gated join: the landing page must survive the auth round-trip (token in the URL is
  the state carrier; after login/signup the app returns to `/shared-game/{token}` or the
  deferred resolution has already joined — handle both idempotently, T5500 join is
  idempotent by contract).
- No persisted view state; slot statuses are fetched, never cached to storage.
- E2E: use the real-auth helper (`e2e/helpers/realAuth.js`) + two test users to drive
  create-on-A / join-on-B; real browser verification for the share-sheet fallback path.

## Implementation

### Steps
1. [ ] UI Designer: modal + landing + slot block specs — user approval gate
2. [ ] Create modal + both entry points + share-sheet/copy success state
3. [ ] `/shared-game/{token}` landing route (signed-in, signed-out, revoked states)
4. [ ] Slot status block on shared game cards (gamesDataStore selector + component)
5. [ ] E2E: A creates → link → B joins signed-in; B' joins via signup (deferred); revoked link state

## Acceptance Criteria

- [ ] Create works from both entry points; existing-game entry pre-fills and binds slot 0
- [ ] Link share sheet works on mobile (navigator.share) and desktop (copy)
- [ ] Landing page renders game info without auth; join CTA behaves correctly signed-in, signed-out (via signup), and on revoked/unknown tokens
- [ ] After join, the joiner has the game in their account and both sides see two slot rows with correct statuses
- [ ] E2E specs pass; verified in a real browser on mobile viewport
