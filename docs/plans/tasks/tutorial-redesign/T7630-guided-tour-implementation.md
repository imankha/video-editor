# T7630: Implement guided-tour engine + essential-path steps

**Status:** TODO
**Impact:** 9
**Complexity:** 6
**Created:** 2026-08-24
**Epic:** [Tutorial Redesign](EPIC.md)
**Blocked by:** T7620 (approved design)

> **Rulings 2026-09-17 (binding, see EPIC.md's 2026-09-17 section):** fully guided when Help is on,
> Help-close is the only exit (one tap, always visible, re-openable); multi-option forks with
> consequence captions; anticipate and explain likely next intents from location + history; default
> ON until the first EXPORT; keep `TutorialVideoModal` and mount it from the Help panel; re-derive all
> step copy from `displayNames.js`; **start only after every other Deploy Candidate task is implemented
> and the UI approved.**
>
> **Re-scoped 2026-09-17 (user: build the epic in concert with the Deploy Candidate; front-load what
> supports the next deploy).** This task is now the ESSENTIAL-PATH CORE only: the engine
> (`guide/` modules, shade + arrow, anchor registry, `deriveFacts`, `resolveGuidance`), the ladder
> rules L1 to L5 with their target attributes, forks F1 / F3 / F5 / F8 (F8's second answer opens
> the Help panel), the Help chip + panel (toggle, ladder map, "Watch the walkthrough" via the kept
> `TutorialVideoModal`, Report a problem), the stall pulse, consequence captions on fork options,
> `guide_enabled` / `guide_intent_source` persistence with default ON until the first export,
> deletion of the quest PANEL UI (`QuestPanel.jsx`, `QuestIcon.jsx`, `questDefinitions.jsx`, claim /
> fanfare UI), and re-deriving all step copy from `displayNames.js`. **Carved out to
> [T10330](T10330-guided-mode-advanced-tier-and-cleanup.md) (next iteration):** the post-publish
> advanced tier A1 to A10 and the Help-chip menu mode, forks F6 (obsolete) / F7, the legacy
> endpoint / `modalOcclusion.js` / video-flag cleanup, the voice-readiness audit, and the per-rule
> admin readout.

## Scope

Implement the approved T7620 design exactly:

1. Tour engine (shade portal, target registry, anchor/re-anchor, step advance via
   existing gesture handlers, bouncy arrow with reduced-motion variant, interrupt/
   resume, escape hatches).
2. data-tutorial-target attributes on every essential-path element (upload button, game
   tile, Add Clip, rating/save controls, **Focus** entry (NOT "Framing" — renamed by
   T7700), the **"Clip Out Play"** CTA (NOT "Create Reel" — renamed by T8760), the
   **"Build New Reel"** assembly button (NOT "Create Highlight Reel", NOT "New Highlight
   Reel" — renamed again by T8780), the **Published / In Progress Reels** tabs (NOT "My Reels"/"Highlights" —
   T8555's four-tab IA), share) - stable, greppable names. **NOTE: T8390 already ships
   `data-tutorial-target="focus-publish"` on the Focus Publish button — REUSE it for the
   Focus→publish step (guided rule 30), do not invent a second Focus anchor.**
3. On/off toggle in the existing settings surface + default-on wiring for new accounts
   (+ the approved existing-accounts default), current-step bookmark persistence, both
   gesture-written.
4. Step copy per design (aligned with T7580's "reel" language).
5. Tests: engine unit tests (anchoring math, step state machine), e2e spec driving the
   full guided path with the real UI (auth-bypass pattern), reduced-motion snapshot.
6. **Round 3 (T8560 fold, 2026-09-03):** `guide/journeyLadder.js` (pure data, `LADDER_STOPS`
   - five named rungs) + `guide/GuideLadder.jsx` (presentational map, done/current/remaining
   from `facts.ladderRung`) as the Help panel's header on every screen. `HelpChip` renders
   `"{stop.label} · Step n of 5"` instead of a bare counter. One derivation only -
   `journeyLadder.js`/`GuideLadder.jsx` read `facts.ladderRung`, never re-derive it. Full
   rationale: `docs/plans/tasks/T8560-design.md`. Adds `journeyLadder.test.js`,
   `guideLadder.render.test.jsx`, and an extension to `placement.test.js` to the test list
   in item 5 above.

Out of scope: screen-size matrix sign-off + quest reconciliation rollout (T7640).

## Key rules

- Persistence: ONLY the toggle + step bookmark are written, each on its gesture. Step
  advance detection reads existing events; no reactive effect->write anywhere.
- No backdrop-close interplay: the shade is not a modal backdrop for app modals; it must
  not introduce backdrop-close semantics (memory rule) nor block the app's own dialogs.
- Coupling: the engine consumes the target registry; screens never import tour logic
  (mvc-pattern skill).

## Acceptance Criteria

- [ ] Full guided run end-to-end on desktop viewport in e2e
- [ ] Toggle + resume verified (leave mid-path, reload, land on same step)
- [ ] A failing guided step (simulated upload error) surfaces the real error state and
      does not trap the user
- [ ] Relevant-set tests green; CI green
