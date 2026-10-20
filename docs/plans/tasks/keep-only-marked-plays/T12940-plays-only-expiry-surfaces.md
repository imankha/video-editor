# T12940: Plays-only games never nag: expiry chip, storage banner, Extend, expired skin

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Tier:** M (frontend, ~4 files)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Epic:** [Keep Only Marked Plays](EPIC.md)

## Problem

Every expiry surface assumes the user wants the full video: the "Xd" chip (`GameTile.jsx` ~366),
the Extend kebab row (~196), the account banner (`StorageExpiryBanner.jsx`, risk computed in
`ProjectManager.jsx::computeStorageExpiryRisk`), `StorageExtensionModal`, and the expired tile skin
(grayscale poster, yellow border, "Expired" chip, tap -> Extend). A user who chose "keep only marked
plays" has said the opposite, so each of these becomes noise or, worse, a prompt to pay for a file
they declined.

## Solution

Rule: **`game.plays_only === true` opts the game out of every full-video expiry surface, before and
after expiry.** The storage date itself is unchanged (D2); only the presentation changes.

| Surface | Today | Plays-only |
|---|---|---|
| Top-left chip | "Xd" / "Expired" (yellow) | "Plays only" (T12930 chip), never yellow |
| Kebab Extend storage | shown inside 14d or expired, `canExtend` | hidden (D6), even inside the grace window |
| Tile skin after expiry | grayscale, dimmed, yellow border, tap -> Extend | normal color skin, tap -> Watch plays (same as before expiry) |
| `StorageExpiryBanner` | counts at-risk games / drafts | excludes plays-only games from the count; renders nothing if only plays-only games are at risk |
| `StorageExtensionModal` | opened from chip / banner / kebab | unreachable for plays-only games |
| T12850 "Available until" line | always shown | reads "Full video until {date}" while restorable; omitted once expired |
| Focus / DraftTile expired panels (T8310 410 `source_expired`) | unchanged | unchanged: after expiry a draft re-exports from extract or recap (T4140); if neither exists the existing expired panel is still the truth |

Why excluding plays-only games from the banner is safe: the banner exists for drafts that would lose
their source (bug 50p). A plays-only game had `auto_export_game` run at keep time (D4), so its plays
have a recap and 5-star extracts, which `resolve_clip_source` falls back to. If `preservation_status`
is `failed`, the game is NOT excluded (the T12930 "Plays not backed up yet" caption and the banner both
stay honest).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/GameTile.jsx` - chip precedence, skin, Extend row gate
- `src/frontend/src/components/ProjectManager.jsx` - `computeStorageExpiryRisk` (or wherever the risk set is built), Extend wiring
- `src/frontend/src/components/StorageExpiryBanner.jsx` - presentational; test the parent's filtering
- `src/frontend/src/components/ExpirationBadge.jsx` - `getDaysUntil` reuse only
- Tests: `GameTile.playsOnly.test.jsx` (extend from T12930), `ProjectManager.storageExpiryRisk.test.jsx` (new or extend T8330's)

### Related Tasks
- Depends on: T12930 (chip, tile state), T12920 (`plays_only`, `preservation_status` fields)
- Related: T8320 (drafts expiry chip), T8330 (banner), T10130 (banner copy, STAGING), T10122 (extend charge check), T12850 ("Available until")

### Technical Notes
- Knowledge docs: `annotate.md` (GameTile notes), `export-pipeline.md` (T8310/T8320/T8330 expiry entries, `resolve_clip_source` order).
- Backend `can_extend` stays truthful; the UI gate is `plays_only`, not a server-side lie.
- No persisted view state; all gates derive from the games list payload.

## Implementation

### Steps
1. [ ] Failing tests: plays-only + near expiry -> no yellow chip, no Extend row; plays-only + expired -> color skin, tap opens Watch plays; banner risk set excludes plays-only unless preservation failed
2. [ ] Implement the gates
3. [ ] Knowledge docs

### Progress Log

**2026-10-18**: Filed.

## Acceptance Criteria

- [ ] A plays-only game inside 14 days shows "Plays only", no "Xd" chip, no Extend row
- [ ] An expired plays-only game keeps the color skin and opens Watch plays on tap
- [ ] The storage banner ignores plays-only games with `preservation_status === 'complete'` and still counts ones with `failed`
- [ ] Curated frontend tests pass; CI green
