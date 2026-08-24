# T7630: Implement guided-tour engine + essential-path steps

**Status:** TODO
**Impact:** 9
**Complexity:** 6
**Created:** 2026-08-24
**Epic:** [Tutorial Redesign](EPIC.md)
**Blocked by:** T7620 (approved design)

## Scope

Implement the approved T7620 design exactly:

1. Tour engine (shade portal, target registry, anchor/re-anchor, step advance via
   existing gesture handlers, bouncy arrow with reduced-motion variant, interrupt/
   resume, escape hatches).
2. data-tutorial-target attributes on every essential-path element (upload button, game
   tile, Add Clip, rating/save controls, Framing entry, Create Reel CTA, My Reels,
   share) - stable, greppable names.
3. On/off toggle in the existing settings surface + default-on wiring for new accounts
   (+ the approved existing-accounts default), current-step bookmark persistence, both
   gesture-written.
4. Step copy per design (aligned with T7580's "reel" language).
5. Tests: engine unit tests (anchoring math, step state machine), e2e spec driving the
   full guided path with the real UI (auth-bypass pattern), reduced-motion snapshot.

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
