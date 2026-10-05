# Epic B: Fits on phones and tablets

**Status:** TODO (decisions ruled 2026-10-04, see README decision register)
**Milestone:** [Parent Usability Audit](../README.md)
**Impact:** 8 | **Complexity:** 4
**Knowledge docs:** `.claude/knowledge/annotate.md`; also read `docs/plans/mobile-ux-spec.md`,
`.claude/references/ui-style-guide.md` and the frontend `responsiveness` skill.

## Goal

No editor or library page scrolls sideways at 320-428px. The game name is always visible. Enabled
controls look enabled, locked ones explain themselves. Tablets use their width.

## Verified root causes (2026-10-04)

- **Editor header overflow (Annotate and Focus).** `components/shared/UnifiedHeader.jsx:41-74` renders
  one non-wrapping row (`flex items-center gap-2 mb-2 h-10`): Back + title (`truncate flex-1 min-w-0`,
  the only shrinkable child, so it collapses to 0px) + chips + three always-labeled mode buttons
  (`components/shared/ModeSwitcher.jsx:132-151`, `whitespace-nowrap`). About 550px wide. The overflow
  becomes the page scrollbar on `AnnotateScreen.jsx:783` / `App.jsx:1008`. Root cause task: T11140
  decision D (prod 2026-09-28) put labels inside every mobile tab. At 768 the single row fits
  (screenshot `tablet/03`, which is Focus at 768).
- **Faint action row under Mark play.** `modes/AnnotateModeView.jsx:1470-1499`: Review plays
  `text-gray-600` (~1.6:1), Share and Add footage `text-gray-400`, 12px icons. All look disabled.
- **Games grid.** `gamesGridColumns()` (`components/ProjectManager.jsx:394-397`) is floored at 2, and
  groups are per month, so a 1-game month shows one tile in the left half (phone ~170px wide; tablet
  half-empty). `components/GameTile.jsx:309` title is single-line `truncate`.
- **Cost row.** `components/GameDetailsModal.jsx:257-263` is a `justify-between` row whose two text
  blocks interleave when they wrap. Copies: `AttachVideoModal.jsx:142-148`,
  `modes/annotate/AddFootageButton.jsx:259-268`, `StorageExtensionModal.jsx` (~181).

## Design decisions

Full proposal: [responsive.md](../../../ux/2026-10-04-parent-usability-audit/design/responsive.md).

- **M1 (recommended A):** two header rows below `md`, one row at `md`+ (T11740).
- **M2 (recommended):** one column on phones; at `sm`+ pack small month groups side by side; 2-line
  titles (T11760).
- Under-Mark-play row: readable outlined secondary buttons; locked Review plays shows a lock icon,
  `aria-disabled`, and a toast (T11750; recommendation only).
- Shared `CreditCostRow` component (T11770; recommendation only, third-duplication rule met).

## Tasks

| ID | Task | Status |
|----|------|--------|
| T11740 | [Editor header fits phones, game name always visible](T11740-editor-header-fits-phones.md) | TODO |
| T11750 | [Readable action row under Mark play](T11750-readable-action-row-under-mark-play.md) | TODO |
| T11760 | [Games grid uses phone and tablet width, 2-line titles](T11760-games-grid-phone-tablet.md) | TODO |
| T11770 | [Shared cost row that never scrambles](T11770-shared-credit-cost-row.md) | TODO |
| T11780 | [Annotate video/controls card overflows at 320px](T11780-annotate-video-card-overflow-320.md) | STAGING |
| T11785 | [Stale e2e selectors block t4940, new-user-flow and T8910](T11785-stale-e2e-selectors-monetization-newuser-t8910.md) | WAITING ON USER |

T11740, T11760 and T11770 are file-disjoint and can run in parallel. T11750 touches
`AnnotateModeView.jsx`, which T11840 and T11860 also touch, so it goes first in that chain.

## Completion criteria

- [ ] `assertNoHorizontalOverflow` passes on /annotate, /focus, /overlay and /home at 320, 360,
      375, 390, 768 (new e2e spec from T11740).
- [ ] `docs/plans/mobile-ux-spec.md` 6.5 and the responsiveness skill's pattern table updated.
- [ ] ui-style-guide gains the two-row header, packed grid and locked secondary action patterns.
