import { ChevronRight, ChevronLeft, X } from 'lucide-react';

/**
 * SettingsRail (T9270) — the unified collapsible settings rail on Focus and Overlay.
 *
 * THE GOVERNING RULE: the rail is the THIRD region (after the CTA and the video)
 * and carries NO accent color. The CTA never lives inside it. This component is one
 * component with TWO layout modes, switched on `isMobile`:
 *
 *   Desktop (isMobile=false): a 300px IN-FLOW box on the right, floor-to-ceiling
 *     between the header and the action band. `collapsed` tweens its WIDTH to a 64px
 *     icon strip (keeping the tab icons) over 320ms cubic-bezier(0.2,0.8,0.2,1). The
 *     main column reflows for free; the players are container-sized so the stage
 *     grows with no measuring code. Header = collapse chevron + the screen's tabs.
 *
 *   Mobile (isMobile=true): a 316px `position:absolute` drawer between the header and
 *     band, sliding in from the right with `transform: translateX()` ONLY — never a
 *     width animation, and its presence never alters the stage box. `open` drives the
 *     transform. Its own header carries a 44x44 close (X) button. A scrim
 *     (rgba(0,0,0,0.45)) fades over the content behind it. NO backdrop-tap close.
 *
 * Open/collapsed is EPHEMERAL view state owned by the host (local useState, NEVER
 * persisted — no-persisted-view-state rule). This component only renders it.
 *
 * @param {boolean} isMobile — layout mode selector (from useIsMobile()).
 * @param {boolean} collapsed — desktop: rail is the 64px icon strip.
 * @param {boolean} open — mobile: drawer is slid in (translateX 0).
 * @param {() => void} onToggleCollapse — desktop chevron handler.
 * @param {() => void} onCloseDrawer — mobile drawer close handler.
 * @param {Array<{id,label,icon}>} tabs — the screen's tabs.
 * @param {string} activeTab — the selected tab id (single source of truth, host-owned).
 * @param {(id:string) => void} onTabChange — tab select handler.
 * @param {string} title — mobile drawer header title ("Settings" / "Spotlight settings").
 * @param {React.ReactNode} children — the active tab's body (SettingsPanels + rows).
 */
const RAIL_TWEEN = 'width 320ms cubic-bezier(0.2, 0.8, 0.2, 1)';
const DRAWER_TWEEN = 'transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)';

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
  // ---- Mobile drawer: position:absolute, translateX only, never a width tween. ----
  if (isMobile) {
    return (
      <>
        {/* Scrim over the content behind the drawer. NO backdrop-tap close
            (house rule feedback_no_backdrop_close) — pointer-events-none so a tap
            falls through to the stage rather than closing the drawer. */}
        <div
          aria-hidden="true"
          className={`absolute inset-0 z-30 bg-black/45 transition-opacity duration-300 pointer-events-none ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <div
          data-testid="settings-drawer"
          role="dialog"
          aria-label={title}
          aria-hidden={!open}
          className="absolute top-0 right-0 bottom-0 z-40 flex flex-col w-[316px] max-w-full"
          style={{
            background: '#0f172a',
            borderLeft: '1px solid #334155',
            boxShadow: '-12px 0 32px rgba(0,0,0,0.5)',
            transform: open ? 'translateX(0)' : 'translateX(316px)',
            transition: DRAWER_TWEEN,
          }}
        >
          {/* Drawer's own header: title + 44x44 close. The entry row lives OUTSIDE
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
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">{children}</div>
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
        width: collapsed ? '64px' : '300px',
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
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">{children}</div>
      )}
    </div>
  );
}
