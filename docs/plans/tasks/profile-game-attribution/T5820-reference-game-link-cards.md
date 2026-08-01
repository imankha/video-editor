# T5820: Games tab: reference game link cards

**Status:** WAITING ON USER — branch pushed, Branch CI green; waiting on user to fetch/test/merge
**Impact:** 5
**Complexity:** 3
**Created:** 2026-07-24
**Updated:** 2026-07-31
**Epic:** [Cross-Profile Game Attribution](EPIC.md) — task 3 of 4. Read EPIC.md for design decisions.

## Problem

T5800/T5810 put reference `games` rows in the target profile. The Games tab must render them
per the user's decision: "show it but more as a link since there should only be one source of
truth." A reference is not an editable game in this profile — it's a signpost to the real game
in the owning profile.

## Solution

Frontend rendering of games with `is_reference: true` (field shipped by T5800's `list_games`):

1. **Link-card treatment** on the games list/grid: visually distinct from real games (e.g.
   subdued style + a "in {source profile name} profile" badge with a link glyph). Shows the
   frozen metadata (name/opponent/date) and poster if resolvable. NO expiry chip, NO annotate /
   add-clips / delete-video / recap actions — none of the real GameCard action set.
2. **Click gesture** = switch to the owning profile and open that game: set the pending-game
   breadcrumb (`setPendingGame(source_game_id)` pattern) then `profileStore.switchProfile(source_profile_id)`
   — verify ordering against `_resetDataStores` (the switch resets data stores and navigates to
   Project Manager; the breadcrumb must survive the reset, or be applied after it).
3. **Degraded link**: if the owning game no longer exists (deleted after the move), the click
   surfaces a small "This game is no longer in {profile}" notice; card remains for grouping
   context. Detection is at click time (navigate and let the owning profile 404/absent-handle),
   NOT a cross-profile existence check on list render.
4. Coordinate with the T5681 poster grid (ui-pass epic, in flight): reference cards are new
   card variants in whatever Games-tab layout lands there. If T5681 has landed, reuse its tile;
   if not, style the current GameCard. Poster for a reference: the recap poster is keyed by the
   OWNING profile's game — resolve via `source_profile_id`/`source_game_id` if the poster proxy
   allows, else branded fallback (do not fabricate).

UI Designer input on the card variant (badge copy, affordance) — lightweight pass, not a full
gate, unless classification says otherwise.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/... (GameCard / games list in ProjectManager.jsx or T5681's grid)` — card variant
- `src/frontend/src/stores/profileStore.js` — `switchProfile` (read; ordering with breadcrumb)
- `src/frontend/src/stores/gamesDataStore.js` — game fields passthrough
- `src/frontend/e2e/` — spec for link navigation
- NOTE: ProjectManager.jsx is contended by ui-pass tasks (T5672/T5675) — check what's landed before branching; never run concurrently with them.

### Related Tasks
- Depends on: T5800 (API fields), T5810 (references actually exist to render)
- Coordinate with: T5681 (Games tab poster grid), T5672/T5675 (same file)

### Technical Notes
- Profile switch + deep-link to a game is a NEW composite gesture — the pendingGame breadcrumb
  (annotate.md: `setPendingGame`) currently deep-links into Annotate. Opening the game's normal
  Games-tab context in the other profile may be the better landing (decide with UI Designer);
  don't force Annotate.
- No persistence anywhere in this task — pure view + navigation. No view state saved
  (no-persisted-view-state rule).

## Implementation

### Steps
1. [x] Card variant + badge (mobile 360-428 AND desktop, per ui-pass standard)
2. [x] Click → profile switch + game landing; breadcrumb survives store reset
3. [x] Degraded-link notice
4. [x] Real-browser verification (drive-app-as-user) + e2e spec

### Progress Log

**2026-07-31 — WIP in container worker `t5820`.**

Based on the **unmerged** `feature/T5800-game-reference-attribution` branch (via `TASK_BASE`), not
master, so the card is built against the real `is_reference` API and real reference rows rather than
a stub — the acceptance criteria here are all real-browser, so stubbed evidence would prove nothing.

In flight: new `components/ReferenceGameCard.jsx` + `__tests__/ReferenceGameCard.test.jsx` +
`e2e/T5820-reference-link-cards.qa.spec.js`; `ProjectManager.jsx` and `utils/pendingNavigation.js`
modified.

**USER DECISION (locked 2026-07-31) — resolves this task file's open question.** The task file left
the landing target undecided ("don't force Annotate"). The user chose: **clicking a reference card
lands on the owning profile's GAMES TAB, with that game's card scrolled into view and briefly
highlighted.** Rationale: you clicked a game card, you should get the game card — the reference is a
signpost, so the landing must show the real game's full context (actions, recap, expiry), not an
editor. Options rejected: reusing `setPendingGame` as-is (cheapest, but jumps into the Annotate
editor unasked), and Games-tab-without-highlight (you'd hunt for the game in a long season list).

Consequence: `setPendingGame` (`utils/pendingNavigation.js`) only feeds the Annotate deep-link, so a
**new breadcrumb path** is required. Constraints given to the worker: it must survive
`_resetDataStores()` (`profileStore.js:211`, awaited in `switchProfile:61/94`), and it is
consumed-once transient navigation intent modelled on the `projectManagerTab` sessionStorage hint
(`ProjectManager.jsx:497-499`, read-then-`removeItem`) — **never persisted view state**.

Note: `gamesDataStore.pendingGameIds` is about pending **uploads**, unrelated to navigation — the
worker was told explicitly not to overload it.

Backend contract confirmed shipped by T5800 (consume, don't change): `is_reference`,
`source_profile_id`, `source_game_id`, and `source_profile_name` already resolved server-side in one
`profiles` read — no per-card lookup. References carry no expiry state by design.

**2026-07-31 (later) — DONE, pushed, CI green.** Branch `feature/T5820-reference-game-link-cards`
(commits `0b2e2374`, `10bde7eb`), Branch CI run 30675917326 green. 8 files, +694/−12,
**frontend-only — zero backend files touched**. Branch is based on
`feature/T5800-game-reference-attribution`.

What landed:
- `ReferenceGameCard.jsx` — dashed subdued tile, `↗ In {source_profile_name}` badge, whole card is
  one keyboard-accessible `<button>`. "Not editable here" reads through **absence**: no kebab, no
  expiry chip, no actions, and no clip count ("0 clips" would mislead). No poster fetch at all, so
  reference cards make **zero network calls**.
- **`GameTile.jsx` was not modified** — references route to a separate component, so real games are
  structurally incapable of regressing. Its 13 unit tests are unchanged and green.
- `setPendingGameReference` in `pendingNavigation.js` — sessionStorage, consumed-once, cleared on
  read. Survives `_resetDataStores()` because that only resets Zustand + refetches.
- **`referenceLoadStartedRef` load-cycle guard.** `switchProfile` flips `currentProfileId` *before*
  the refetch, so there is a stale window where the previous profile's game list is still in the
  store. The guard waits for `gamesLoading` to go true→false on the target profile before matching,
  so the breadcrumb can never resolve against the stale list.

**A real contract defect was found and fixed mid-task.** The first implementation had to locate the
owning game by frozen `blake3_hash`, because `/api/games` SELECTed `source_game_id` but never
projected it. That hash is **NULL for multi-video games**, so those references would have landed
with no highlight — quietly undoing part of the user's locked decision. Fixed on the T5800 branch
(commit `16679992`, gated + test-pinned), then this task rebased and switched to **exact
`source_game_id` matching** (commit `10bde7eb`). Multi-video highlighting is now pinned by e2e
criterion 2b (game id 301 with `blake3_hash: null` → `ring-green-400` after the cross-profile click).

Evidence: 26 unit tests green (exit 0); **5/5 real-browser Playwright criteria** green (`[verify]
PASS`) — both-direction kid↔default navigation with a real Chromium profile switch, degraded notice,
real-tile parity, `responsiveSweep` at 375/1280 with no horizontal overflow, and warm navigation at
158 ms against a 3 s budget.

**QA caveat worth remembering:** a leftover Vite dev-server process (~5 h old, not caught by
`pkill -f vite`) served a **stale transform** of `ProjectManager.jsx` and made a correct
implementation look broken; clearing `node_modules/.vite` alone did not fix it. Traced via `/proc`
cmdline inspection and `kill -9` on the real PIDs, after which a genuinely fresh stack went green.
The authoritative 5/5 run is post-kill. Recorded in `annotate.md`.

**Scope note:** the two-profile navigation, `switchProfile`, `_resetDataStores`, breadcrumb,
scroll+highlight and degraded notice all ran for real in Chromium; only the `/api/games` payloads
were injected (the T5880-established pattern), because no test seam can attribute `game_ids` to a
seeded reel, so a move cannot materialize a reference without the full pipeline. The backend
materialization itself is covered by `test_t5800_game_reference.py` / `test_t5810_move_attribution.py`.

## Acceptance Criteria

- [ ] Reference games render as link cards with owner-profile badge; no expiry/edit/annotate affordances
- [ ] Click lands on the game in the owning profile (real-browser evidence, both directions kid↔default)
- [ ] Owning game deleted → visible notice, no crash, no silent no-op
- [ ] Real games' cards byte-identical (no regression to GameCard)
- [ ] Mobile + desktop screenshots attached
