# T9270 implementation contract (testids + component APIs + non-negotiables)

Shared source of truth for the Implementor, Reviewer, and Tester. The **task file**
(`docs/plans/tasks/T9270-focus-overlay-cta-band-settings-rail.md`) is authoritative for design;
this file only pins the mechanical contract so tests and code agree.

## Non-negotiables (violating any is a design regression)
1. **CTA never resizes, moves, collapses, or lives inside the settings container.** Its rendered
   `boundingBox()` is byte-identical rail-expanded vs collapsed, and drawer-open vs closed.
2. **No `useEffect` writes rail/drawer state anywhere.** Open/collapsed is ephemeral `useState`,
   never persisted (no-persisted-view-state rule).
3. **Desktop rail = in-flow width tween** (`320ms cubic-bezier(0.2,0.8,0.2,1)` on the rail box's
   width only). **Mobile drawer = `transform: translateX()` only**, `position: absolute`, never a
   width animation, and its presence must NEVER alter the stage box. Same component, two layout
   modes, switched on `useIsMobile()`.
4. **No backdrop-tap to close** the mobile drawer.
5. **Exactly one accent color for "selected": `blue-600`.** Retire the 4 competing accents.
6. Overlay settings tabs rendered **ONCE**, one `useState` source of truth for the active tab
   (kill the duplicate desktop+mobile `settingsTabs` renders sharing/​splitting state).
7. Aspect selector: **exactly one instance** at every width (no copy above the video on mobile).
8. Commit each step separately, `T9270: step N - ...`, explicit `git add <paths>` (never -A/-a).
   **Never `git push` / `gh pr create`.** Do not edit PLAN.md or the task file's Status.

## data-testid contract (stable hooks for the e2e/unit specs)
- `data-testid="action-band"` — the full-width bottom band (both screens).
- `data-testid="primary-cta"` — the one saturated CTA button inside the band (Export Focused
  Video on Focus; Add Overlay on Overlay). Put it on the actual `<button>`.
- `data-testid="settings-rail"` — the desktop rail container (the box whose width tweens).
- `data-testid="rail-collapse-toggle"` — chevron button that collapses/expands the desktop rail.
- `data-testid="focus-video-stage"` — Focus stage box (Overlay already has
  `data-testid="overlay-video-stage"`; keep it).
- `data-testid="mobile-settings-row"` — the 64px full-width labelled Settings entry row (mobile).
- `data-testid="mobile-settings-summary"` — the derived live-summary second line inside that row.
- `data-testid="settings-drawer"` — the mobile translateX drawer container (assert its `transform`).
- `data-testid="drawer-close"` — the 44x44 X button inside the drawer's own header.
- Keep every existing testid referenced by current tests (`overlay-video-stage`,
  `export-credit-estimate`, `export-unframed-caption`, `output-length-chip`,
  `project-output-length-chip`, `overlay-publish-*`).

## New shared components (src/frontend/src/components/settings/)
- `SettingRow.jsx` — `{ label, value, children, className, stack }`. Layout `flex items-center
  justify-between`; left column `text-sm font-medium text-gray-200` label over `text-xs
  text-gray-400` live value; control (`children`) on the right. `stack` → label row then control
  row (`flex-wrap`) for wide controls (the six swatches). Coarse-pointer 44px floor via
  `coarse-pointer:` variants.
- `SettingsPanel.jsx` — a labelled group: `{ title, children }`. Groups are **Reel** / **This
  clip** (or **This spotlight**) / **View only**.
- `SettingsRail.jsx` — `{ isMobile, collapsed, open, onToggleCollapse, onCloseDrawer, tabs,
  activeTab, onTabChange, children }`. Desktop: 300px in-flow box, width-tween, collapses to a
  64px icon strip keeping tab icons; header = chevron + tabs. Mobile: 316px `position:absolute`
  translateX drawer between header and band, own header with title + `drawer-close`, scrim
  `rgba(0,0,0,0.45)`, NO backdrop-close. One component, two layout modes on the `isMobile` prop.

## Per-step deliverables (commit each)
- **Step 1 - action band.** Extract T8790's sticky bar into a `flex:none` full-width band, 76px
  tall, `#0b1220`, `border-top rgba(255,255,255,.14)`, `box-shadow 0 -8px 24px rgba(0,0,0,.35)`,
  3 cells (flex-1 status | CTA auto centered | flex-1 cost). CTA 56px tall, `padding 0 34px`,
  `rounded-[10px]`, icon+label, 17px/600; Focus `#2563eb` (blue shadow), Overlay `#9333ea`
  (purple). Progress / failed-retry / disabled-reason render in the LEFT cell (preserve T8510).
  Remove `FocusModeView.jsx:85`'s `lg:static lg:bg-transparent…` reset. Band spans full width
  under main column + (future) rail — restructure each view's outer wrapper to
  `flex flex-col` with the band as the last `flex:none` child. Closes problem 1 alone.
- **Step 2 - rail components.** Build the 3 components; port Overlay's existing rows onto them;
  fix duplicate-tabs (render once, one activeTab useState); unify accent to blue-600.
- **Step 3 - re-home Focus settings.** Move Focus's above-video toolbar (aspect, background dim,
  straighten, zoom) and the below-timeline card into the rail with Reel / This clip / View-only
  grouping; add collapse to both screens. Swap Focus's hand-rolled toggle for shared `Toggle`.
- **Step 4 - mobile drawer + reclaimed space.** Below lg, render the same `SettingsRail` as the
  translateX drawer opened by the 64px `mobile-settings-row` (closed by default); delete Overlay's
  second (`lg:hidden mt-6`) settings render and Focus's above-video aspect selector (now in
  drawer). Raise header to 56px w/ 44px targets, drop Overlay's `VideoPlayer.jsx:197`
  `max-h-[40vh]` cap **on the Overlay path only** (keep the `sm:` tablet behavior; Focus's 16:9
  stage is width-bound so unaffected), grow Focus timeline lanes (44/64/48). Focus mobile drawer
  holds Reel (aspect, audio) + This clip (straighten angle) + Clips tab; zoom & background dim
  stay desktop-only exactly as `FocusModeView.jsx:371-372` gates them. In `mobileFs` the entry
  row is hidden. **Focus horizontal clip strip is DROPPABLE** — if skipped, say so in the status.

## Tests (relevant set, ~10 — see task file "Test scope")
Update: `FocusModeView.mobileReachable`, `OverlayModeView.mobileReachable` (meaning → in-viewport),
`FocusModeView.aspectRatio`, `FocusModeView.mobileAspect`, `OverlayModeView.aspectStage` (T5676
geometry), `OverlaySettingsTabs`, `FocusPublishActionBar`, `OverlayPublishActionBar`, plus any test
asserting the Overlay `max-h-[40vh]` cap. New: rail collapse/expand unit test; CTA-above-fold e2e at
1280x900/1440x900/1280x768; mobile drawer e2e at 390x844 (closed on load, row opens it, `transform`
asserted, CTA box unchanged, no backdrop-close) + coarse-pointer touch-target sweep. Real browser
per T5380 (not jsdom alone) for pointer/layout.
