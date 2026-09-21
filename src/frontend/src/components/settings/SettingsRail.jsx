import { ChevronRight, ChevronLeft, X } from 'lucide-react';

/**
 * SettingsRail (T9270; mobile anchored sheet T10820) — the unified collapsible
 * settings rail on Focus and Overlay.
 *
 * THE GOVERNING RULE: the rail is the THIRD region (after the CTA and the video)
 * and carries NO accent color. The CTA never lives inside it. This component is one
 * component with TWO layout modes, switched on `isMobile`:
 *
 *   Desktop (isMobile=false): a 380px IN-FLOW box on the right, floor-to-ceiling
 *     between the header and the action band. `collapsed` tweens its WIDTH to a 64px
 *     icon strip (keeping the tab icons) over 320ms cubic-bezier(0.2,0.8,0.2,1). The
 *     main column reflows for free; the players are container-sized so the stage
 *     grows with no measuring code. Header = collapse chevron + the screen's tabs.
 *
 *   Mobile (isMobile=true): a full-width sheet ANCHORED to the top edge of the
 *     host's `sticky bottom-0` action-band wrapper (`absolute bottom-full inset-x-0`),
 *     never `position:fixed` — a `backdrop-filter` ancestor (the `backdrop-blur-lg`
 *     card on Focus/Overlay/Annotate) becomes the containing block for `fixed`
 *     descendants, so anchoring to the already-positioned `sticky` wrapper sidesteps
 *     that trap by construction (T10420, T10820). Capped at `MOBILE_PANEL_MAX_VH`
 *     (55dvh) with an internal scroll, sliding up with `transform: translateY()`
 *     ONLY — never a width or max-height animation — `translateY(100%)` parked to
 *     `translateY(0)` open. The panel never alters the stage box and never measures
 *     the action band (`bottom-full` is 100% of the band's own height, so the offset
 *     resolves itself). Its own header carries a 44x44 close (X) button. A scrim
 *     (rgba(0,0,0,0.45)) covers the page ABOVE the band only (`bottom-full h-dvh`),
 *     so the CTA below is never dimmed. NO backdrop-tap close. The panel stays
 *     ATTACHED while closed (never conditionally rendered), with `visibility`
 *     delayed 320ms on close so the slide-down is seen before it leaves the a11y
 *     tree. The pre-T10820 316px right-edge `translateX` drawer geometry has been
 *     deleted outright, not kept behind a flag.
 *
 * Open/collapsed is EPHEMERAL view state owned by the host (local useState, NEVER
 * persisted — no-persisted-view-state rule). This component only renders it.
 *
 * @param {boolean} isMobile — layout mode selector (from useIsMobile()).
 * @param {boolean} collapsed — desktop: rail is the 64px icon strip.
 * @param {boolean} open — mobile: panel is slid up (translateY(0)).
 * @param {() => void} onToggleCollapse — desktop chevron handler.
 * @param {() => void} onCloseDrawer — mobile panel close handler.
 * @param {Array<{id,label,icon}>} tabs — the screen's tabs.
 * @param {string} activeTab — the selected tab id (single source of truth, host-owned).
 * @param {(id:string) => void} onTabChange — tab select handler.
 * @param {string} title — mobile panel header title ("Settings" / "Spotlight settings").
 * @param {React.ReactNode} children — the active tab's body (SettingsPanels + rows).
 */
// T10380: exported so a host that needs to size something ALONGSIDE the rail
// (e.g. Annotate's Add-footage header strip, which sits above the rail body
// rather than inside it — see the "CTA never lives inside the rail" rule below)
// can match its geometry from one source instead of a hand-copied literal.
export const RAIL_WIDTH_PX = 380;
export const RAIL_COLLAPSED_WIDTH_PX = 64;
export const RAIL_TWEEN = 'width 320ms cubic-bezier(0.2, 0.8, 0.2, 1)';
// T10820: mobile panel geometry — single exported source, replacing the 3
// hand-copied `316` literals (className, transform, docstring) the pre-T10820
// side drawer had. min(55dvh, PXpx) was considered for a secondary cap on wide
// mobile/tablet widths but jsdom's CSSOM (cssstyle) drops `min()` as an invalid
// value (verified: `style.maxHeight` reads back '' ), so the cap stays a plain
// dvh value the unit tests can assert on directly.
export const MOBILE_PANEL_MAX_VH = 55;
export const MOBILE_PANEL_TWEEN = 'transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)';

function TabButton({ tab, isActive, iconsOnly, dimmed, dimTitle, onClick }) {
  const Icon = tab.icon;
  // `dimmed` deprioritizes a tab (e.g. Overlay's Text tab when no text region is
  // under the playhead) WITHOUT disabling it — never the native `disabled`/
  // `aria-disabled`, which would block the click AND make the panel's own "add one"
  // guidance unreachable (T6630 rationale, preserved from OverlaySettingsTabs).
  const title = dimmed && dimTitle ? dimTitle : (iconsOnly ? tab.label : undefined);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      data-testid={`settings-tab-${tab.id}`}
      title={title}
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 px-2 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px coarse-pointer:min-h-11 ${
        iconsOnly ? 'w-full' : 'flex-1'
      } ${dimmed && !isActive ? 'opacity-50' : ''} ${
        isActive
          ? 'border-blue-600 text-white bg-white/5'
          : 'border-transparent text-gray-400 hover:text-gray-200'
      }`}
    >
      {Icon && <Icon size={16} aria-hidden="true" />}
      {!iconsOnly && <span>{tab.label}</span>}
    </button>
  );
}

export default function SettingsRail({
  isMobile = false,
  collapsed = false,
  open = false,
  onToggleCollapse,
  onCloseDrawer,
  tabs = [],
  activeTab,
  onTabChange,
  disabledTabIds = [],
  disabledTabTitle,
  title = 'Settings',
  children,
}) {
  const isDimmed = (id) => disabledTabIds.includes(id);
  // ---- Mobile: absolute bottom-full sheet, translateY only, never a width/
  // max-height tween. Anchored inside the host's `sticky bottom-0` action-band
  // wrapper (T10820) — never `position:fixed` (backdrop-filter containing-block
  // trap, see the docstring above). ----
  if (isMobile) {
    return (
      <>
        {/* Scrim covers the page ABOVE the band only (bottom-full h-dvh) so the
            CTA below the band is never dimmed. NO backdrop-tap close (house rule
            feedback_no_backdrop_close) — pointer-events-none so a tap falls
            through to the stage rather than closing the panel. */}
        <div
          aria-hidden="true"
          className={`absolute bottom-full inset-x-0 h-dvh z-30 bg-black/45 transition-opacity duration-300 pointer-events-none ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <div
          data-testid="settings-drawer"
          role="dialog"
          aria-label={title}
          aria-hidden={!open}
          className={`absolute bottom-full inset-x-0 z-40 flex flex-col ${open ? '' : 'pointer-events-none'}`}
          style={{
            background: '#0f172a',
            borderTop: '1px solid #334155',
            boxShadow: '0 -12px 32px rgba(0,0,0,0.5)',
            maxHeight: `${MOBILE_PANEL_MAX_VH}dvh`,
            transform: open ? 'translateY(0)' : 'translateY(100%)',
            visibility: open ? 'visible' : 'hidden',
            // Delay hiding (visibility) until AFTER the close transform finishes
            // so the slide-down is visible; opening needs no delay (instant
            // visible, so the slide-up is visible from the first frame).
            transition: open
              ? MOBILE_PANEL_TWEEN
              : `${MOBILE_PANEL_TWEEN}, visibility 0s linear 320ms`,
          }}
        >
          {/* Panel's own header: title + 44x44 close. The entry row lives OUTSIDE
              (in the host), so each state has exactly one obvious control. */}
          <div className="flex items-center justify-between border-b border-gray-700 pl-4 pr-2 h-14 shrink-0">
            <span className="text-sm font-semibold text-gray-200">{title}</span>
            <button
              type="button"
              data-testid="drawer-close"
              onClick={onCloseDrawer}
              aria-label="Close settings"
              className="flex items-center justify-center w-11 h-11 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          {/* Tabs */}
          {tabs.length > 1 && (
            <div role="tablist" aria-label={title} className="flex border-b border-gray-700 shrink-0">
              {tabs.map((tab) => (
                <TabButton
                  key={tab.id}
                  tab={tab}
                  isActive={activeTab === tab.id}
                  dimmed={isDimmed(tab.id)}
                  dimTitle={disabledTabTitle}
                  iconsOnly={false}
                  onClick={() => onTabChange && onTabChange(tab.id)}
                />
              ))}
            </div>
          )}
          {/* Body */}
          <div
            data-testid={`settings-panel-${activeTab}`}
            className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6"
          >
            {children}
          </div>
        </div>
      </>
    );
  }

  // ---- Desktop rail: in-flow box, width tween to a 64px icon strip. ----
  return (
    <div
      data-testid="settings-rail"
      className="hidden lg:flex flex-col shrink-0 self-stretch overflow-hidden"
      style={{
        width: collapsed ? `${RAIL_COLLAPSED_WIDTH_PX}px` : `${RAIL_WIDTH_PX}px`,
        background: '#0f172a',
        borderLeft: '1px solid #334155',
        transition: RAIL_TWEEN,
      }}
    >
      {/* Header: collapse chevron + tabs (icons-only when collapsed). */}
      <div className="flex items-center border-b border-gray-700 shrink-0">
        <button
          type="button"
          data-testid="rail-collapse-toggle"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand settings' : 'Collapse settings'}
          aria-expanded={!collapsed}
          className="flex items-center justify-center w-16 h-11 shrink-0 text-gray-400 hover:text-white transition-colors"
        >
          {collapsed ? <ChevronLeft size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
        </button>
        {!collapsed && (
          <div role="tablist" aria-label={title} className="flex flex-1 min-w-0">
            {tabs.map((tab) => (
              <TabButton
                key={tab.id}
                tab={tab}
                isActive={activeTab === tab.id}
                dimmed={isDimmed(tab.id)}
                dimTitle={disabledTabTitle}
                iconsOnly={false}
                onClick={() => onTabChange && onTabChange(tab.id)}
              />
            ))}
          </div>
        )}
      </div>

      {collapsed ? (
        /* Collapsed icon strip — keep the tab icons, tap to expand + select. */
        <div role="tablist" aria-label={title} className="flex flex-col items-stretch">
          {tabs.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              isActive={activeTab === tab.id}
              dimmed={isDimmed(tab.id)}
              dimTitle={disabledTabTitle}
              iconsOnly
              onClick={() => {
                onTabChange && onTabChange(tab.id);
                onToggleCollapse && onToggleCollapse();
              }}
            />
          ))}
        </div>
      ) : (
        <div
          data-testid={`settings-panel-${activeTab}`}
          className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6"
        >
          {children}
        </div>
      )}
    </div>
  );
}
