# T5730: Claim & import flow

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-07-21
**Updated:** 2026-07-21

Task 4 of 5 in the [Share the Game epic](EPIC.md). Absorbs the claim/materialize half of T4910.

## Problem

The watch page (T5720) can convert a viewer into a user, but there's no claim path: today's
teammate-share import is automatic (no consent moment, no annotation choice), lands recipients
in Annotate (a power-user screen) as their first impression, and only exists for email-targeted
shares. Per [EPIC.md](EPIC.md) decision 8, claiming is a consent moment: game always, team
annotations opt-in, profile picked explicitly.

## Solution

1. **Claim endpoint** — `POST /api/shared/game/{token}/claim`
   `{profile_id, include_annotations: bool}` (auth required):
   - Resolves the share (revoked → 410; already-claimed-by-this-user → idempotent success
     returning the existing local `game_id`).
   - Materializes via `materialize_game_share` (`materialization.py:427`) — game as R2
     references (`_copy_game` + `_find_existing_game_by_hashes` dedup +
     `_create_storage_refs`; the source is stored once globally, zero storage cost).
   - `include_annotations=true` → `clip_data` = the game's TEAM-layer clips serialized via
     `serialize_clip_data` (fields per clip: `rating, tags, name, notes, start_time,
     end_time, video_sequence, tagged_teammates`); `false` → empty clip list (game-only,
     `share_game`'s existing shape).
   - **T5330 invariant (carried verbatim from T4910's acceptance criteria):** the claim MUST
     route through `materialize_game_share`/`_copy_game`/`_materialize_clips` so copied
     games/clips get non-null `shared_by` (precedence `sharer_email -> sharer_user_id ->
     "lost"`). Never ship a claim path leaving `shared_by` NULL — it regresses T5330
     (onboarding silently skipped). Imported clips arrive `my_athlete=0` (already forced) =
     recipient's Team layer.
   - Records a claim row (see schema below) + referral attribution channel `game_link`
     (mirror the `teammate_share` channel, `materialization.py:554-560`).
2. **Claim schema (Postgres → Migration agent):** new table `share_claims`
   (`id SERIAL PK, share_id INT REFERENCES shares, claimer_user_id TEXT, claimer_profile_id
   TEXT, include_annotations BOOL, local_game_id INT, claimed_at TIMESTAMPTZ`) — powers
   idempotency + the T5740 funnel. Add to `_SCHEMA_DDL` in `pg.py` AND a versioned
   `postgres` migration.
3. **Import dialog (frontend)** — after auth, a small modal: profile pick (multi-profile
   accounts; single-profile skips the pick), "Include team annotations ({n} plays)"
   opt-in (default ON), Confirm → claim call → success routes to the game (see 5).
4. **Deferred no-account claim** — CTA on the watch page → signup; carry the token through
   auth (sessionStorage breadcrumb, T2915 link-snapshot class — NOT `pending_teammate_shares`,
   which is keyed by recipient email; link claims are claimant-initiated). After first auth
   completes, the import dialog opens. Suppress the onboarding QuestPanel while on the shared
   route exactly like `shared_annotation_flow` (T5330b lifecycle: set on the shared view,
   cleared once authenticated AND off the shared route — reuse/extend that flag rather than
   inventing a sibling).
5. **Post-import landing** — the game card / recap view (NOT Annotate), with a "Tag your
   athlete's plays" nudge toward Annotate. First impression = watching; depth = one tap away.
   The recipient's own subsequent tagging is genuine content (quest-eligible).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/shares.py` — claim endpoint beside T5720's resolve routes
- `src/backend/app/services/materialization.py` — `materialize_game_share` (L427),
  `serialize_clip_data` (L584), `_copy_game` (L152), provenance (L451), referral attribution
  (L554-560)
- `src/backend/app/services/sharing_db.py` — share lookup + new `share_claims` helpers
- `src/backend/app/services/pg.py` — `_SCHEMA_DDL` + `src/backend/app/migrations/postgres/`
  versioned migration (Migration agent)
- `src/frontend/src/App.jsx` — token-through-auth breadcrumb + `shared_annotation_flow`-class
  suppression (existing lifecycle at App.jsx ~L389)
- T5720's SPA watch view — CTA wiring → import dialog (new component)
- `src/frontend/src/components/SharedAnnotationView.jsx` — prior art for the auth-then-resolve
  effect chain (reuse patterns, do not extend that component)

### Related Tasks
- Depends on: T5720 (link + watch page + share rows)
- Related: T5330/T5330b (provenance + NUF suppression — regression tests must stay green),
  T3230 (signup auto-materialize race: already-resolved returns success — mirror that
  idempotency), Dual-Camera T5500 (reuses whichever claim plumbing lands first)

### Technical Notes
- Knowledge docs: [backend-services.md](../../../.claude/knowledge/backend-services.md)
  (§ Quest system, § Data flow), [persistence-sync.md](../../../.claude/knowledge/persistence-sync.md)
- Claim is a user gesture → surgical endpoint; no reactive materialization on login for link
  shares (the deferred path completes via the explicit dialog Confirm, not silently).
- Idempotency: claim twice → same local game (hash dedup via
  `_find_existing_game_by_hashes` + the `share_claims` row); re-claim with
  `include_annotations=true` after a game-only claim → clips materialize into the SAME game
  (merge path already handles overlap).
- Expired-source claims: annotations still import; game shows the existing expired
  degradation (bug 27p machinery). No fabricated storage refs (T4820 head-object guard).
- L-tier: Postgres schema + auth-crossing flow → Architect gate + Migration agent + Tester.

## Implementation

### Steps
1. [ ] Architect design: claim contract, share_claims schema, deferred-claim breadcrumb
       lifecycle, expired-source semantics (user approval gate)
2. [ ] Migration agent: `share_claims` (DDL + versioned postgres migration)
3. [ ] Backend: claim endpoint (idempotent, provenance-preserving, attribution)
4. [ ] Frontend: import dialog + token-through-auth + post-import landing + nudge
5. [ ] Tests: claim idempotency, game-only vs with-annotations column-level assertions,
       `shared_by` never NULL, quest blindness (T5330 spec extension), deferred-claim
       completes after signup, expired-source claim
6. [ ] Real-browser verify: full anonymous → watch → signup → import → tag-own-athlete loop

### Progress Log

**2026-07-21**: Created from the epic consolidation (T4910 claim half).

## Acceptance Criteria

- [ ] Signed-in claim adds the game (+ optional team annotations) to the chosen profile;
      nothing else in the account is touched
- [ ] No-account visitor completes the claim after signup via the import dialog (no silent
      auto-import)
- [ ] Claimed content carries `shared_by`; onboarding quests blind to it (T5330 tests green);
      recipient's own later tagging counts
- [ ] Claim is idempotent; annotations can be added by a later re-claim
- [ ] Post-import landing is the game card/recap with the tag-your-athlete nudge
- [ ] `share_claims` recorded; referral channel `game_link` attributed
- [ ] Migrations runnable via admin endpoint
