# T6440: "Autoplay previews" setting + data-saver guardrails

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-08-03

**Moved from the Tile Video Preview epic on 2026-08-17** (that epic is merged into this one —
see [EPIC.md](EPIC.md)'s merge note). Scope unchanged from its original filing; only the touch
dependency below was repointed from T6430 to T7160.

Epic child 3/3 — see [EPIC.md](EPIC.md). Depends on T6420 (+T7160 for the touch surface).

## Problem

Netflix shipped autoplay previews without an off switch and had to add one under sustained
user pressure. Autoplay also consumes data on metered connections — soccer parents on
sideline cellular are exactly the audience that notices.

## Solution

1. **"Autoplay previews" toggle** (default ON) in the existing settings surface. A real
   preference — persist it via the existing settings write path, gesture-based (the toggle
   click IS the gesture). This is NOT view state; it belongs with real preferences (per the
   no-persisted-view-state rule's carve-out).
2. **`navigator.connection.saveData === true`** → previews off regardless of the toggle
   (silent; no UI needed beyond the toggle's help text mentioning it).
3. Both gates live in ONE place — the T6420 hook/coordinator activation check, not
   scattered per-tile. `prefers-reduced-motion` (already shipped in T6420) joins them there.

Off = zero preview behavior: no warm, no observers doing work beyond cheap registration.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/hooks/useTilePreview.js` (+ coordinator) — single activation gate
- Settings UI component + the existing settings store/endpoint (locate at Stage 1; the
  `/api/settings` read is already in the boot set per the HAR epic)

### Related Tasks
- T6420/T7160 (the surfaces being gated)

### Technical Notes
- `navigator.connection` is Chromium-only — absence means "no signal", never "saveData on".
  That is an EXTERNAL-dependency fallback, which is the allowed kind.
- Settings schema: check whether app settings are a JSON blob (no migration) or columned
  (migration needed) before classifying; expected S/M-tier, frontend + possibly a settings
  key.

## Acceptance Criteria

- [ ] Toggle OFF: no previews anywhere (hover + touch tap-select), zero video requests; ON restores
- [ ] Preference persists across reload/devices via the existing settings path,
      gesture-based write only
- [ ] `saveData` connections get no previews regardless of toggle
- [ ] Gates centralized in the activation check (grep shows one site)
- [ ] Frontend unit tests pass
