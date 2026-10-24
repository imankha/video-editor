# T12850: Show each game's "available until" date and the Extend action outside the last 14 days

**Status:** STAGING
**Impact:** 4
**Complexity:** 2
**Tier:** S/M (frontend only, ~2 files)
**Created:** 2026-10-16
**Milestone:** Next build (external QA 2026-10-16). Present on prod, so it does not block the deploy.

## Problem

External QA C05 ([report](../../ux/2026-10-16-external-qa/QA-REPORT.md), screenshot
`screenshots/C05_game-menu_1440x900_no-retention-extension.png`). Upload and the credits help say
games are kept 30 days and can be extended, but a fresh game shows no expiry date and no Extend
action in its menu or in Game Details. The parent is told about a deadline they cannot see.

## Current code

`GameTile.jsx:85-87, 196-201` add "Extend storage" to the menu and `:366-369` show an "Xd"/"Expired"
chip, both only when `canExtend && (isExpired || daysLeft < 14)`. `StorageExpiryBanner`
(`ProjectManager.jsx:1534`) opens `StorageExtensionModal` (`:2447`) only for at-risk games.
`GameDetailsModal.jsx` shows neither. Same on prod. Related: T10130 (banner copy, STAGING),
T10122 (extend charge check, STAGING), T7300 (per-feed keep, TODO).

## Decision needed (product)

Should Extend be offered any time, or only inside the 14-day window with the date always visible?
Recommended: always show "Available until {date}" in Game Details and the menu; keep the Extend
action inside the window so nobody pays early by accident.

## Solution

Render `storage_expires_at` as "Available until {date}" in Game Details and the game menu; reuse the
existing `onExtend` handler per the decision above.

## Acceptance Criteria

- [ ] A game uploaded today shows its "Available until" date in Game Details and the menu
- [ ] Extend appears according to the decision, using the existing extension modal and pricing
- [ ] Unit test for the date rendering and the gate
