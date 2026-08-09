# T6680: Every profile should have a default Athlete Intro Card before the user builds one

**Status:** TODO — needs an Architecture design gate before implementation
**Impact:** 7 | **Complexity:** 6
**Epic:** [Player Intro + Rich Text](EPIC.md)
**Follows:** [T6530](T6530-intro-card-discoverability-ux.md) — UX proposal, approved 2026-08-08

## Problem

Today (post T5195/T5205) a profile has zero intro cards until a user explicitly creates one —
the empty-library state ("No intro cards yet. Create one...") is the starting point for every
profile, and nothing plays before any reel/collection until that first card exists.

**User direction, 2026-08-08 (reviewing T6530's proposal):** "I think before the user even added
a card we should have a default card." Read plainly: a profile should already have a usable
default Athlete Intro Card **before** the user has created anything, not an empty grid.

## Why this needs a design gate, not a straight implementation

This interacts with decisions already locked elsewhere in the epic and must not silently
contradict them:

1. **T5230's consent gate.** `create_intro_card` now 403s without a recorded parental-consent
   attestation (`intro_consent_at`) — deliberately, because a card is "a minor's likeness +
   parent-typed facts." If a default card is auto-created by the SYSTEM rather than a user
   gesture, does it need consent too? The epic's compliance posture (EPIC.md § Compliance
   posture, T5230) frames the real risk as **public exposure of a photo**, not the mere
   existence of a title-only row. A plausible resolution: the auto-provisioned default is
   **title-only** (no photo, full name only — which a parent already typed into
   `ProfileIntroSection` under its own, unrelated consent-free flow) and stays private (never
   exposed) until the user explicitly attaches it to a shared reel, at which point the EXISTING
   consent + exposure-warning gates on attach/share (T5215/T5220/T5230) still apply. This needs
   to be a stated decision, not an assumption — resolve it explicitly at the design gate and
   record the reasoning, don't let it become a silent bypass of T5230's gate.
2. **Resolution semantics (epic decision 8).** `final_videos.intro_card_id`: `NULL` = inherit
   the profile default, `0` = explicitly no intro. If every profile always has a default card
   going forward, `NULL` always resolves to something (never nothing) for NEW reels — confirm
   this doesn't change any existing test's assumption that "profile has no cards" is a reachable
   state, and confirm `0` (explicit opt-out) still works exactly as before.
3. **Existing profiles with zero cards today.** Auto-provisioning can't only apply to brand-new
   profiles going forward — profiles created before this task also need a default, or the
   feature stays inconsistent for exactly the users T6530's research walked (the "sdfg" test
   profile had zero cards). Decide: lazy backfill on first read (simplest, no migration data
   walk) vs. an explicit migration that creates one row per existing profile (more predictable,
   but is a data-writing migration touching every profile — weigh against
   `.claude/skills/migration.md` conventions and the "migrations are self-sufficient, never a
   silent fallback" rule).
4. **What does an auto-generated default actually contain?** Full name only (from
   `ProfileIntroSection`'s existing `intro_full_name` setting) with a default treatment, no
   photo, no position/class/team unless already filled in? If the profile has no full name set
   either, what renders? This needs an explicit answer, not an assumed "sensible default" —
   check what `player_intro.py`'s `title-only` composition (epic decision 2) actually looks like
   with zero facts to confirm it degrades acceptably.

## Solution (shape only — Architect to finalize)

Likely shape based on the above: a lazy default-provisioning path (e.g. inside
`get_intro_cards`/the resolution helper T5215 built) that, when a profile has zero cards, creates
one server-side with `is_default=1`, `shown_fields=[]` (title-only per epic decision 2), no
`image_key`, using whatever full name is already on the profile (or a graceful placeholder if
none). This reuses `title-only`'s already-defined non-consent-requiring shape if the consent
tension above resolves that way. Needs an explicit interaction test against T5230's guardrail
test suite (T5230 just shipped a no-biometrics + consent-gate test suite this task must not
break, mirroring the T6030-style regression T5230 itself just hit against an unrelated test).

## Context

### Relevant Files
- `src/backend/app/routers/intro_cards.py` (`create_intro_card`, the T5230 consent gate)
- `src/backend/app/services/intro_cards.py` (`derive_composition`, card CRUD service layer)
- Wherever T5215's resolution helper lives (`intro_egress.py`'s `resolve_intro_for_reel` per
  T5220, or T5215's own resolver — confirm current location, may have moved)
- `src/frontend/src/components/introcards/IntroCardsModal.jsx` — the empty-state copy this
  removes/changes
- `.claude/knowledge/backend-services.md` § "Intro card library" — update once this ships

### Related Tasks
- [T6530](T6530-intro-card-discoverability-ux.md) — the research this decision came from
- [T5230](T5230-childrens-data-compliance.md) — the consent gate this must not silently bypass
- [T5215](T5215-intro-attachment.md) — owns the NULL/0 resolution semantics this must not break
- [T6670](T6670-card-selector-inline-create-flow.md) — the "I don't like the default, make a new
  one" path stays needed regardless of this task's outcome

## Classification hint
**L-tier — Architecture design gate required before implementation.** Real tradeoffs (consent
interaction, backfill strategy for existing profiles, resolution-semantics interaction) that
must be decided and written down, not guessed by an implementor. Spawn the Architect after Code
Expert confirms the current shape of T5215's resolver + T5230's gate (they may have shifted
since this was written). Consider looping in the `expert` agent on the consent-interaction
question specifically if the Architect finds it genuinely ambiguous — this is exactly the "real
tradeoff, data-integrity-adjacent" class CLAUDE.md says to escalate rather than grind.

## Acceptance Criteria
- [ ] Design doc explicitly resolves: does the auto-default require consent, and why/why not.
- [ ] Design doc explicitly resolves: lazy provisioning vs. migration backfill for existing
      profiles, and why.
- [ ] A brand-new profile (or any existing zero-card profile) has a usable default Athlete Intro
      Card without the user taking any card-creation action.
- [ ] The default is title-only (or whatever the design doc settles on) and renders acceptably
      with a missing full name, verified live.
- [ ] `NULL`/`0` resolution semantics (epic decision 8) are unchanged and still tested.
- [ ] T5230's consent-gate and no-biometrics guardrail test suites still pass unmodified in
      intent (may need new interaction tests, must not be weakened).
