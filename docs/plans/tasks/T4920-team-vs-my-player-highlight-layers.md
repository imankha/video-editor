# T4920: Team vs My Player highlight layers in Annotate

> **SUPERSEDED (2026-07-21)** by the [Share the Game epic](team-game-share/EPIC.md):
> became [T5700](team-game-share/T5700-team-layer-annotate.md). Key change from this file's
> plan: the layer reuses the existing `raw_clips.my_athlete` bit (strictly one layer per
> clip, user decision 2026-07-21) — **no new schema, no backfill migration**. The per-profile
> vs per-game ownership question this file raised is resolved: the layer is per-profile by
> construction (it lives on the profile's own raw_clips rows). Do not implement from this file.

**Status:** SUPERSEDED
**Impact:** 7
**Complexity:** 6
**Created:** 2026-07-11
**Updated:** 2026-07-11

## Problem

User direction (2026-07-11, in the context of game sharing / game videos): a game's highlights today are implicitly "my player" highlights — the parent annotates moments featuring their athlete. But a **game video shared with others should contain *team* highlights, not one player's highlights**. There is currently no way to distinguish the two: all annotations live in one undifferentiated set.

## Solution

Introduce a **layer** dimension on game annotations/highlights:

1. **Two layers**: `My Player` and `Team`. Team highlights live on a separate layer from my-player highlights.
2. **Toggle in Annotate**: a "My Player" vs "Team" toggle controls which layer new annotations land on and which layer(s) are displayed. (UI Designer to spec: toggle placement, whether viewing is exclusive or both-with-visual-distinction, default = My Player to match current behavior.)
3. **Consumption rules**:
   - Per-player reels / clip extraction continue to draw from My Player highlights (current behavior preserved).
   - The **game video / shared game** (T4910) carries the **Team** layer.
4. **Data model**: a layer/scope field on the annotation records (clips/segments per [annotate.md](../../.claude/knowledge/annotate.md)) in the profile DB. Existing annotations backfill to `My Player` (that's what they are today). Profile-DB migration required.

Multi-athlete wrinkle (from T4850/bug 30p learnings): "My Player" is per-profile, so a layer field naturally scopes per profile; but Team highlights on a game that materializes across sibling profiles (T2830/T2850) raises the question of whether the Team layer is shared per-game or per-profile. Architect must answer this before implementation — it determines where the layer data lives (profile DB vs game-scoped).

## Context

### Relevant Files (REQUIRED)
(Design-gated; Architect/Code Expert to finalize)
- `src/frontend/src/screens/AnnotateScreen.jsx` (+ annotation state hooks) — toggle UI, layer-aware create/display
- Profile DB schema in `src/backend/app/database.py` — annotation/clip tables gain a layer column (+ migration, Migration agent)
- Backend annotation gesture-action endpoints — carry the layer on create
- Recap/notes overlay components (T4130 NotesOverlay) — layer-aware display

### Related Tasks
- Blocks: T4910 (share game via link — the shared game carries the Team layer)
- Related: T4850 (multi-athlete sibling profiles), T4130 (recap overlay)

### Technical Notes
- Knowledge doc: [annotate.md](../../.claude/knowledge/annotate.md) — load before exploring.
- The toggle's selected layer is ephemeral view state — do NOT persist it (no-persisted-view-state rule); only the annotations' layer assignment persists.
- Backfill migration: existing annotations → `My Player`. No read-time fallback for a missing layer value; the migration makes data correct.
- L-tier: schema change + new concept in the core Annotate flow → full staged workflow with Architect gate + UI Designer for the toggle.

## Implementation

### Steps
1. [ ] Architect design (incl. the per-profile vs per-game Team-layer ownership question) — user approval gate
2. [ ] UI Designer: toggle + layer visual language in Annotate
3. [ ] Schema + migration (backfill existing → My Player)
4. [ ] Annotate: layer-aware create/display + toggle
5. [ ] Wire consumption rules (reels ← My Player; game video/share ← Team)
6. [ ] Tests

### Progress Log

**2026-07-11**: Task created from user direction alongside the game-share-link request (T4910).

## Acceptance Criteria

- [ ] Annotate has a My Player / Team toggle; new highlights land on the selected layer
- [ ] Existing annotations behave as My Player (backfilled), current reel flows unchanged
- [ ] Team-layer highlights are what a game video / shared game exposes
- [ ] Layer toggle state is not persisted; layer assignment is
- [ ] Tests pass; migration runnable via admin endpoint
