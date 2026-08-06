import { Sparkles, Type, Image as ImageIcon } from 'lucide-react';

/**
 * OverlaySettingsTabs (T6630 round 2) — the persistent three-tab settings section
 * beside/below the Overlay video.
 *
 * WHY: selecting a text block used to MOUNT a new "Edit Text" rail, which grew the
 * layout and moved the very block the user had just clicked ("it opened a big
 * piece of UI that moved the thing i clicked on"). This section is ALWAYS on
 * screen with a CONSTANT body height, so selecting a block only swaps which
 * tab's content shows — the panel's outer box never changes size, so nothing in
 * the timeline reflows (the 0px-delta invariant the round-2 gate requires).
 *
 * Presentational: the three tab bodies are passed in as nodes; this component
 * owns only the tab chrome and the reserved-height body. `activeTab`/`onTabChange`
 * are controlled by the host so a selection gesture can force the Text tab.
 *
 * Tab 3 is "Thumbnail" — the canonical user-facing term for the poster/preview
 * image (T6590). The data model still calls it poster_* (see ThumbnailPanel).
 */
const TABS = [
  { id: 'overlay', label: 'Overlay', icon: Sparkles },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'thumbnail', label: 'Thumbnail', icon: ImageIcon },
];

export default function OverlaySettingsTabs({
  activeTab = 'overlay',
  onTabChange,
  overlayPanel,
  textPanel,
  thumbnailPanel,
  className = '',
}) {
  const panels = { overlay: overlayPanel, text: textPanel, thumbnail: thumbnailPanel };
  const active = TABS.some((t) => t.id === activeTab) ? activeTab : 'overlay';

  return (
    <div
      data-testid="overlay-settings-tabs"
      className={`bg-gray-900/85 backdrop-blur-lg rounded-lg border border-gray-700 overflow-hidden ${className}`}
    >
      <div role="tablist" aria-label="Overlay settings" className="flex border-b border-gray-700">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={isActive}
              data-testid={`overlay-tab-${id}`}
              onClick={() => onTabChange && onTabChange(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px coarse-pointer:min-h-11 ${
                isActive
                  ? 'border-cyan-400 text-white bg-white/5'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Reserved, CONSTANT-height body: switching tabs / selecting a block swaps
          content inside a fixed box, so the section's outer height never changes
          and nothing downstream (the timeline) reflows. Overflow scrolls. */}
      <div
        role="tabpanel"
        data-testid={`overlay-tabpanel-${active}`}
        className="p-3 lg:p-4 h-[26rem] overflow-y-auto"
      >
        {panels[active]}
      </div>
    </div>
  );
}
