# T5330: Email game-share recipient skips the new-user flow

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-07-17
**Updated:** 2026-07-17

## Problem

When a user shares a game via email, the recipient who signs up **does not get the new-user
flow (NUF) onboarding**. Reported by the user 2026-07-17.

Share-via-email recipients are the app's primary organic/viral acquisition channel, and they are
*exactly* the cohort that most needs onboarding — they arrive into an app pre-populated with
someone else's game, having never created their own content. Instead of the guided quest_1
("Get Started") walkthrough, the onboarding checklist reads as already complete and they are
dropped past it with no direction. The entire NUF investment (T4780 tutorials, the T5150–T5195
quest polish) is silently bypassed for this cohort.

## Root Cause (confirmed by code read)

Onboarding visibility is a **pure function of quest_1 step booleans**, and several quest_1 steps
are **derived from profile DB state** (games/clips/reels), not just explicit achievements
([quests.py:171-184](../../../src/backend/app/routers/quests.py#L171-L184)):

```python
steps["upload_game"]        = SELECT 1 FROM games LIMIT 1          # any game exists
steps["add_clip"]           = 'add_clip_opened' in achieved or rc["total"] >= 1   # any raw clip
steps["rate_clip"]          = 'clip_rated' in achieved or rc["reels"] >= 1         # any reel  (T5185 backfill)
steps["annotate_brilliant"] = rc["reels"] >= 1                                     # any reel
```

Those `or rc[...] >= 1` backfills exist deliberately so **pre-existing users** (who did these
things before the quest system existed) aren't re-nagged — a reel is proof the step was once
satisfied. The backfill misfires for a share recipient because their profile has content they
never created.

**The divergence mechanism** — during the recipient's first `session_init`, the T3230
auto-materialize block ([session_init.py:162-202](../../../src/backend/app/session_init.py#L162-L202))
copies the shared game + clips into the brand-new profile **before** the first
`GET /api/quests/progress` call. And critically,
[materialization.py:503-512](../../../src/backend/app/services/materialization.py#L503-L512)
**auto-creates a draft reel for every shared 5-star clip** (`_create_auto_project_for_clip`).

Net effect on quest_1 for a recipient whose shared game contains any 5-star clip:

| quest_1 step | Fresh signup | Share-email signup | Why |
|--------------|--------------|--------------------|-----|
| `upload_game` | False | **True** | materialized game exists ([materialization.py:485](../../../src/backend/app/services/materialization.py#L485)) |
| `add_clip` | False | **True** | materialized raw clips → `rc["total"] >= 1` |
| `rate_clip` | False | **True** | auto-created draft reel → `rc["reels"] >= 1` |
| `annotate_brilliant` | False | **True** | auto-created draft reel → `rc["reels"] >= 1` |

`questStore.js` progressive disclosure (`activeQuestId`,
[questStore.js:89-96](../../../src/frontend/src/stores/questStore.js#L89-L96)) then advances the
recipient past quest_1 entirely. The onboarding is gone.

Note: the backend already computes an `is_new_user` flag on fresh profile creation
([session_init.py:137-155](../../../src/backend/app/session_init.py#L137-L155)) and returns it via
`/api/auth/init`, **but the frontend never consumes it** — onboarding is 100% quest-derived. So
the plumbing to distinguish a genuinely-new account already exists; it just isn't wired to the
NUF gate.

## Solution

**Decided direction (user, 2026-07-17): being shared a game must be invisible to NUF progress.**
A user's onboarding state is a function of **their own gestures/content only** — never of content
someone else shared into their profile. Concretely:

- Recipient who **already completed** the NUF → unchanged (already true via the claimed-quest
  self-heal at [quests.py:261](../../../src/backend/app/routers/quests.py#L261)).
- Recipient who **never started** → gets the full NUF from the beginning, exactly like a fresh
  signup, even though a shared game now sits in their profile.
- Recipient **mid-NUF** → keeps exactly the progress they earned themselves; the share neither
  advances nor rolls back any step.

This resolves the earlier open question ("onboard using the shared game vs clean first-run") — the
shared game is simply **orthogonal** to onboarding. The materialized game/clips remain present and
usable; they just don't count toward quest steps.

### Chosen approach: exclude shared-in content from the DB-derived quest counts

Make the quest_1 DB-derived steps count **only content the recipient created**, not content
materialized from a share:

- `add_clip` / `rate_clip` / `annotate_brilliant` backfills (`rc["total"]`, `rc["reels"]` at
  [quests.py:175-183](../../../src/backend/app/routers/quests.py#L175-L183)) must exclude clips
  marked shared-in (`shared_by IS NOT NULL`, set at
  [materialization.py:498-501](../../../src/backend/app/services/materialization.py#L498-L501))
  and reels derived from them.
- `upload_game` ([quests.py:171](../../../src/backend/app/routers/quests.py#L171)) must exclude the
  materialized game (needs a provenance marker on the copied game row — verify `_copy_game` carries
  one; add one if not).
- The **5-star auto-draft-reel** created by materialization
  ([materialization.py:503-512](../../../src/backend/app/services/materialization.py#L503-L512)) is
  the main culprit for `rc["reels"] >= 1` — its provenance must make it excludable from the reel
  count too.

Rejected: gating purely on account-newness/`is_new_user` (a share to an *established* mid-flow user
would still wrongly count — the rule is about content provenance, not account age); a separate
share-recipient onboarding track (the user wants the *same* NUF, just share-blind).

**Still needs a short Architect pass** to lock the exact provenance mechanism (existing `shared_by`
on clips vs a new marker on the copied game/auto-reel), confirm it doesn't regress the
pre-existing-user suppression (their own content has `shared_by IS NULL`, so it still counts), and
decide migration need. It is NOT a full design-from-scratch — the behavior is now specified.

Design must still settle: provenance on the copied **game** row and the **auto-draft-reel**
(clips already carry `shared_by`); whether any migration/flag is needed; and re-materialization
edges (recipient logs in on a second device, share re-sent) — all of which must remain NUF-neutral.

## Context

### Relevant Files (REQUIRED)

- `src/backend/app/routers/quests.py` — `_check_all_steps` (:117), quest_1 DB-derived steps
  (:171-184), self-heal render-all-true for claimed quests (:261). **The gate lives here.**
- `src/backend/app/session_init.py` — `is_new_user` computation (:137-155); T3230 auto-materialize
  block that pre-populates the recipient's profile (:162-202).
- `src/backend/app/services/materialization.py` — `materialize_game_share` (:415); clip
  materialization with `shared_by` provenance (:498-501); **5-star auto-draft-reel side effect
  (:503-512)** — this is what trips `rc["reels"] >= 1`.
- `src/backend/app/quest_config.py` — `QUEST_DEFINITIONS` structure SSOT (ids, step_ids, rewards).
- `src/frontend/src/data/questDefinitions.js` — frontend structure mirror (must stay in sync).
- `src/frontend/src/config/questDefinitions.jsx` — frontend titles/descriptions mirror (in sync).
- `src/frontend/src/stores/questStore.js` — `fetchProgress` (:57), `activeQuestId` progressive
  disclosure (:89-96) that advances a recipient past quest_1.
- `src/frontend/src/utils/sessionInit.js` — returns `isNewUser` (:195, :247) but nothing consumes
  it (the wiring gap approach A would close).
- (reference) `src/backend/app/routers/auth.py` — `_find_or_create_user` (:284); explicit-`ref`
  referral path (:310-318) that game-share emails **do not** use; email-match attribution
  `attribute_from_existing_shares` (:324).
- (reference) `src/backend/app/services/email.py:584` `_get_share_url` — game-share link resolves
  to `/shared/teammate/{token}` with **no `?ref=` code** (why onboarding context flows only through
  the pending-share machinery, not the primary referral path).

### Related Tasks

- **T3230** (Auto-Materialize Pending Shares, DONE) — the mechanism that pre-populates the
  recipient's profile at `session_init`; this bug is its onboarding-side consequence.
- **T2915** (sport inheritance through invite, DONE) — same email-match attribution path
  (`sharer_default_sport` → `inherited_sport`); the recipient gets the right sport but not the NUF.
- **T3290** (Tune NUF for Returning Users, TODO) — adjacent "who sees onboarding" concern; approach
  C would effectively merge with it. Coordinate so the two don't build parallel gating.
- **NUF Quest Flow Fixes epic** (T5150–T5195, DONE) — established the DB-derived + self-heal quest
  model this fix must not regress. Read `nuf-quest-fixes/EPIC.md` "Background — the quest system".
- **T4910** (Share a game via link, TODO) — link-based game sharing (vs email); same materialize
  path, so this fix should cover the link-signup case too. Confirm during design.

### Technical Notes

- Quest structure is SSOT in `quest_config.py` and **mirrored in two frontend files** — any
  structural change must update all three (see epic background).
- The self-heal at `quests.py:261` (claimed quest → all steps render True) MUST stay intact so
  established users are never re-onboarded. The fix targets the *unclaimed / fresh-account* path.
- Persistence is gesture-based; if approach A/C needs a durable first-run marker, it must not be a
  reactive write (project-wide rule).

## Implementation

### Steps
1. [ ] Short Architect pass (behavior already specified): lock the provenance mechanism for the
       copied **game** row and the **auto-draft-reel** (clips already carry `shared_by`), confirm no
       regression to pre-existing-user suppression, decide migration need + re-materialization
       edges. Design doc `docs/plans/tasks/T5330-design.md`, user approval gate.
2. [ ] Test-first: failing test proving a share-email recipient sees quest_1 as active/incomplete
       after `session_init` materializes a game — and a second test proving a recipient mid-NUF
       keeps their earned progress unchanged after materialization (extend
       `test_t3230_auto_materialize.py` / `test_auto_materialize.py` + quest-progress assertions).
3. [ ] Implement: quest_1 DB-derived counts (`upload_game`, `add_clip`, `rate_clip`,
       `annotate_brilliant`) exclude shared-in content by provenance; keep the claimed-quest
       self-heal and own-content backfills intact. Update all three quest definition sources only
       if structure changes (likely none — this is count logic, not step structure).
4. [ ] Migration only if a new provenance marker on games/auto-reels needs backfilling for already
       materialized shares (design decides; clips already have `shared_by`).
5. [ ] E2E: extend/clone `src/frontend/e2e/new-user-flow.spec.js` for a share-signup that must still
       land on the onboarding quest.

### Progress Log

**2026-07-17**: Task filed from user report. Root cause traced end-to-end (code read, no repro yet):
share materialization + 5-star auto-draft-reel pre-satisfies quest_1's DB-derived steps before the
first quest-progress fetch. Divergence point and candidate fixes documented above. Not started.

## Acceptance Criteria

- [ ] A recipient who signs up after an email game share and **hasn't started** the NUF lands on
      the onboarding (quest_1 active and incomplete), not past it.
- [ ] A recipient who is **mid-NUF** keeps exactly the progress they earned themselves — the share
      neither advances nor rolls back any step.
- [ ] A recipient who **already completed** the NUF is unchanged (no re-onboarding).
- [ ] Pre-existing/established users are **not** re-onboarded (their own content still counts;
      no regression to the DB-derived suppression that T5150-T5195 rely on).
- [ ] A genuinely-fresh signup (no share) still gets the NUF exactly as today.
- [ ] The materialized shared game/clips are still present and usable (no data change to T3230).
- [ ] Behavior is consistent for the link-based game-share signup path (T4910) or that gap is
      explicitly documented as out of scope.
- [ ] Backend + frontend tests pass; a reproducing test exists before the fix.
