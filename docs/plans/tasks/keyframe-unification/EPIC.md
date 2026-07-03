# Keyframe System Unification Epic

**Status:** TODO
**Started:** -
**Completed:** -
**Source:** [Code quality audit 2026-07-03](../../audit-2026-07-03-code-quality.md) items C3, C4, C1 (absorbs T3810, T3820)

## Goal

Finish migrating overlay onto the keyframe systems framing already uses. Directives: [DRY] + [SYNC].

The audit's biggest single frontend finding: **overlay mode is systematically one refactor behind framing.** The shared systems exist — `controllers/keyframeController.js` + `useKeyframeController` + `keyframeUtils.js` (with `resolveTargetFrame`, the "SINGLE SOURCE OF TRUTH for keyframe identity" from the near-duplicate-keyframe prod fix) — but only `useCrop` adopted them. `useHighlightRegions` re-implements the whole keyframe lifecycle inline (add/update/move/remove/copy/paste/snap, ~L517-671), grew its OWN parallel re-solution of the same identity bug (`movedFromFrame`, L527-539), snaps 5 frames where crop snaps 10, and hardcodes `framerate = 30`. The timeline rendering fork (CropLayer vs the RegionLayer lineage) is where the "can't delete first keyframe" bug lives: crop's delete gating got the flat-list fix (`>= 1`), highlight's still enforces the dead permanent-keyframe model (`> 2 && !isPermanent`).

**History that makes this high-risk:** keyframe identity/persistence semantics caused the T350 origin corruption and the near-duplicate accumulation incidents. Every task here is test-first, and the controller test suite is extended BEFORE migration.

## Sequencing (STRICT)

| ID | Task | Status |
|----|------|--------|
| T4440 | [Dead Keyframe/Timeline Code Deletion Sweep](T4440-dead-code-deletion-sweep.md) | TODO |
| T4450 | [Shared KeyframeTrack Timeline Rendering](T4450-shared-keyframe-track.md) | TODO |
| T4460 | [Overlay onto Keyframe Controller (region-scoped tracks)](T4460-overlay-onto-keyframe-controller.md) | TODO |

Delete first (T4440) so nobody fixes bugs in dead files; unify rendering (T4450) while behavior is still per-mode; migrate the engine last (T4460) once the rendering seam is shared.

## Key model facts (read before implementing anything)

- Keyframes are a **flat list, no permanent boundaries** (removed ~2026-06-21). Delete any keyframe freely; empty list → default centered crop; trim is virtual. See memory "Keyframe flat-list model". Any code enforcing permanent/boundary keyframes is enforcing a dead model.
- Keyframes are **frame-based** with `origin: 'user' | 'trim' | ...` — see `src/frontend/.claude/skills/keyframe-data-model`.
- Keyframe identity = `resolveTargetFrame` (`keyframeUtils.js:71-90`). Display-snap vs persisted-frame divergence is THE historical bug; both modes must resolve identity through the one function.
- T3800 already unified the persist wrapper (resolve→optimistic→surgical→rollback); this epic unifies the in-memory engine and rendering above it.

## Completion Criteria

- [ ] One keyframe lifecycle implementation; `useHighlightRegions` holds region CRUD only
- [ ] One snap window/direction across modes (T3820's UX decision, made and recorded)
- [ ] Delete gating identical in both modes (flat-list rule)
- [ ] No hardcoded framerate in keyframe code (consumes T4540's canonical source if landed, else `videoMetadata`)
- [ ] Controller test suite covers overlay's cases (multi-region, per-region tracks) before the migration lands
