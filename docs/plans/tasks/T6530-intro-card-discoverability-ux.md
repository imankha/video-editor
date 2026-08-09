# T6530: UX pass — how should the intro card feature actually be surfaced?

**Status:** DECIDED 2026-08-08 — proposal approved with modifications; implementation split into
child tasks below. This task itself is closed (research + decision only).
**Impact:** 7 | **Complexity:** 4

## Decision (2026-08-08)

Proposal delivered as a written artifact (`docs/plans/tasks/T6530-ux-proposal.md` + 22 live
screenshots) with 6 recommendations and 4 open questions. User reviewed and decided:

- **Approved as proposed:** Q2 (no change to card selection), the general shape of Q1
  (management stays in Profile settings + a second entry via the card selector, no top-level nav
  item — explicit answer to open question 1), Q4 (fix the non-active-profile dead end).
- **Naming (Q5 / open question 3):** neither "Player Intro" (my recommendation) nor "Intro
  cards" (the original mockup's term) — the user picked a third, final name: **"Athlete Intro
  Card."** Use this everywhere user-facing going forward.
- **Q1 refined beyond the proposal:** the card selector shouldn't just link to the library — it
  should let the user create a new card INLINE and land back on selection with the new card
  visible (and selected). Bigger than my original "Manage cards" link.
- **New requirement, not in the original proposal:** a profile should have a **default Athlete
  Intro Card before the user ever creates one** — not an empty-state grid. This needs its own
  design gate (see T6680) — it interacts with T5230's consent gate and epic decision 8's
  NULL/0 resolution semantics.
- **Q3 (share-time discovery prompt) — REJECTED, do not build.** "I'm not a fan of prompts so i
  just dont want this. User has the option to add an intro card but is never prompted to." No
  task exists for this; do not resurrect it without a new, explicit user request.
- **Q6 (sequencing/staging) — REJECTED as I framed it.** I recommended holding Q1's new entry
  point + Q3's prompt until T5220 merges. The user rejected gating on T5220 entirely: "Stage
  separately, no need to wait. We will merge tasks as they are done." (Q3 is moot since it's not
  being built at all.) Every child task below ships independently as it's ready, regardless of
  T5220's merge status.

**Implementation split into 4 child tasks** (gap-numbered T6660-T6690, independent, mergeable in
any order per the user's explicit staging preference):
- [T6660](player-intro/T6660-rename-athlete-intro-card.md) — rename to "Athlete Intro Card"
- [T6670](player-intro/T6670-card-selector-inline-create-flow.md) — inline create-and-return flow
- [T6680](player-intro/T6680-default-athlete-intro-card-provisioning.md) — auto-default card
  (Architecture design gate required)
- [T6690](player-intro/T6690-nonactive-profile-dead-end-fix.md) — non-active-profile dead end

> Deliberately NOT a "move the button" task. The point is to decide, with the whole feature working
> in front of us, where this belongs in the product — then implement that.

## Why this exists

The Player Intro epic shipped its machinery before anything decided how a user would *find* it. Each
task placed its own surface reasonably and locally, and the sum is not a considered product flow.

The concrete symptom, observed 2026-08-04 as soon as T5205 hit staging: the user could not find the
feature at all on a build that definitely contained it. The entry point is
`ManageProfilesModal` → open a profile → a button at the bottom of the edit panel, and it only
renders when that profile is the ACTIVE one:

```jsx
{editingProfile.isCurrent ? (
  <button onClick={() => setShowIntroCards(true)}>Intro cards</button>
) : (
  <p className="text-xs text-gray-500">Switch to this profile to manage its intro cards.</p>
)}
```
(`ManageProfilesModal.jsx:433`)

Nothing here was built wrong — the task said "reachable from `ManageProfilesModal` / the profile
menu" and that is what was built. But the headline feature of the epic is two levels deep in a
settings modal, and on a non-active profile it degrades to a line of grey text, which reads exactly
like "this was never shipped".

## Scope

Put the UX hat on. With the full flow working (build a card → attach it to a reel → it plays before
the footage on share and download), evaluate and then implement:

1. **Where does card management belong?** Profile settings is a defensible home for a per-athlete
   asset, but it is not where a user is when they are thinking about a reel. Consider: a top-level
   entry, an entry from the Gallery/reel surface, an entry at share time, or more than one.
2. **Where does card *selection* belong?** Managing the library and picking a card for THIS reel are
   different jobs. T5215 will put a picker somewhere; check that it is where the decision is actually
   made, which is probably next to the reel, not in profile settings.
3. **First-run.** A user with zero cards should meet this feature at a moment when it makes sense,
   with a path that ends in a card they can use — not an empty grid.
4. **The non-active-profile case.** Grey text is the wrong answer. Either offer to switch profiles and
   open it, or show a disabled control with a reason, or do not show the row at all.
5. **Naming.** "Intro cards" is fine internally; check it is what a soccer parent would call it.
6. **Does it need to be discoverable at all before it is useful?** If cards do nothing until attached,
   surfacing the library prominently before T5220 lands would be worse than hiding it.

## Method
- Walk the real flow on staging as a user with no cards, then as one with several.
- Look at how the app already surfaces comparable per-profile assets and at the share flow's existing
  entry points, and prefer consistency with those over inventing a new pattern.
- `.claude/references/ui-style-guide.md` for conventions; the epic's UI mockups
  (<https://claude.ai/code/artifact/93478a34-c7e5-406f-a56b-3c3724e4b6dd> § 06) for the original intent.
- Bring the proposal to the user with mockups/screenshots BEFORE implementing — this is a judgement
  task, and the whole point is that the local decisions were each fine and the sum was not.

## Relevant files
- `src/frontend/src/components/ManageProfilesModal.jsx` — the current entry point
- `src/frontend/src/components/introcards/` — the editor + library (T5205)
- whatever T5215 adds for per-reel selection
- `.claude/references/ui-style-guide.md`

## Classification hint
M-tier implementation, but **ui-designer agent required** and a user approval gate on the proposal
before any code. Frontend-only. Real-browser verification with screenshots.

## Acceptance criteria
- [ ] A written proposal (with visuals) for where card management and card selection each live, put
      to the user and approved BEFORE implementation.
- [ ] The approved placement is implemented.
- [ ] A user who has never made a card can find the feature and finish with a usable card.
- [ ] The non-active-profile case gives an action or a reason, never a dead line of grey text.
- [ ] Card SELECTION sits where the user decides which reel gets an intro.
- [ ] Verified in a real browser at desktop and 375px, with screenshots.
