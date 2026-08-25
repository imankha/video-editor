import { useEffect, useRef, useState } from 'react';
import { Sparkles, Type, Image as ImageIcon } from 'lucide-react';

/**
 * OverlaySettingsTabs (T6630 round 2/6) — the persistent three-tab settings
 * section beside/below the Overlay video.
 *
 * WHY: selecting a text block used to MOUNT a new "Edit Text" rail, which grew the
 * layout and moved the very block the user had just clicked ("it opened a big
 * piece of UI that moved the thing i clicked on"). This section is ALWAYS on
 * screen with a CONSTANT body height, so selecting a block only swaps which
 * tab's content shows — the panel's outer box never changes size, so nothing in
 * the timeline reflows (the 0px-delta invariant the round-2 gate requires).
 *
 * BODY HEIGHT (round 6 item 5): was a hard-coded `h-[26rem]` sized for a
 * worst-case/small viewport -- far smaller than the room actually available
 * on a normal desktop window ("why am i getting scroll bars when i have
 * vertical space"). The invariant is "doesn't change when you select a
 * different block", NOT "is always exactly 416px" -- so the body now
 * measures the ACTUAL space available below it (viewport height minus its
 * own top offset) ONCE on mount and on window resize, never on content
 * change, clamped to [MIN_BODY_H, MAX_BODY_H]. This mirrors
 * IntroCardStage.jsx's wrapRef/avail ResizeObserver pattern in spirit, but
 * measures the wrapper's OWN top position + window.innerHeight (a plain
 * resize listener, not a ResizeObserver on itself) -- observing the body's
 * own box with a ResizeObserver while also SETTING that box's height would
 * be circular (the observer refiring on every height change it caused).
 * `overflow-y-auto` stays as the safety net for whatever still doesn't fit
 * (a genuinely short viewport, or an unusually tall content list).
 *
 * Presentational: the three tab bodies are passed in as nodes; this component
 * owns only the tab chrome and the reserved-height body. `activeTab`/`onTabChange`
 * are controlled by the host so a selection gesture can force the Text tab.
 *
 * Tab 3 is "Thumbnail" — the canonical user-facing term for the poster/preview
 * image (T6590). The data model still calls it poster_* (see ThumbnailPanel).
 */
const TABS = [
  { id: 'overlay', label: 'Spotlight', icon: Sparkles },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'thumbnail', label: 'Thumbnail', icon: ImageIcon },
];

const MIN_BODY_H = 416; // the old 26rem floor -- never smaller than the prior known-good size
const MAX_BODY_H = 768; // a sane ceiling so a very tall monitor doesn't get a comically huge panel
const BOTTOM_MARGIN = 24; // breathing room so the panel doesn't touch the viewport edge

export default function OverlaySettingsTabs({
  activeTab = 'overlay',
  onTabChange,
  overlayPanel,
  textPanel,
  thumbnailPanel,
  className = '',
  // T6630 round 6 item 2: tab ids that should read as unavailable (dimmed)
  // -- e.g. Text when no region is under the playhead. Deliberately stays
  // CLICKABLE (not the native `disabled` attribute): a genuinely empty
  // video has ZERO regions anywhere yet, and blocking the click would make
  // the Text tab's own "click the timeline to add one" guidance
  // unreachable for a first-time user -- there'd be no path back into the
  // panel that explains what to do. Also does NOT force-navigate away from
  // an already-active tab that becomes dimmed (the panel body already
  // shows its own natural empty state -- see TextManagementPanel's "no
  // region under the playhead" message -- so the user isn't yanked to a
  // different tab mid-edit just because the playhead ticked past a region
  // boundary).
  disabledTabIds = [],
}) {
  const panels = { overlay: overlayPanel, text: textPanel, thumbnail: thumbnailPanel };
  const active = TABS.some((t) => t.id === activeTab) ? activeTab : 'overlay';

  const bodyRef = useRef(null);
  const [bodyHeight, setBodyHeight] = useState(MIN_BODY_H);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof window === 'undefined') return undefined;
    const recompute = () => {
      const top = el.getBoundingClientRect().top;
      const available = window.innerHeight - top - BOTTOM_MARGIN;
      setBodyHeight(Math.max(MIN_BODY_H, Math.min(MAX_BODY_H, available)));
    };
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, []);

  return (
    <div
      data-testid="overlay-settings-tabs"
      className={`bg-gray-900/85 backdrop-blur-lg rounded-lg border border-gray-700 overflow-hidden ${className}`}
    >
      <div role="tablist" aria-label="Overlay settings" className="flex border-b border-gray-700">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          // NOT aria-disabled: that attribute tells assistive tech (and
          // Playwright's actionability checks, empirically -- a real click
          // hung waiting for "element is not enabled" against a button with
          // no native `disabled` at all, purely from aria-disabled="true")
          // the control is inoperable, which it isn't -- it's fully
          // clickable, just visually deprioritized. See disabledTabIds' doc
          // comment above for why staying genuinely clickable matters here.
          const isDimmed = disabledTabIds.includes(id);
          return (
            <button
              key={id}
              role="tab"
              aria-selected={isActive}
              data-testid={`overlay-tab-${id}`}
              title={isDimmed ? 'No text region under the playhead' : undefined}
              onClick={() => onTabChange && onTabChange(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px coarse-pointer:min-h-11 ${
                isDimmed && !isActive
                  ? 'border-transparent text-gray-600 opacity-50 hover:text-gray-400'
                  : isActive
                    ? 'border-cyan-400 text-white bg-white/5'
                    : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <Icon
                size={14}
                // T6630 round 8 item 3: the Thumbnail tab's icon always
                // renders in the SAME cyan as the timeline's thumbnail
                // marker (PosterMarkerLayer's cyan-400/500 chip), not just
                // on this tab's own active border -- so the icon reads as
                // "this is the thing that marker is" even when the tab
                // isn't selected.
                className={id === 'thumbnail' ? 'text-cyan-400' : undefined}
              />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Reserved, CONSTANT-height body: switching tabs / selecting a block swaps
          content inside a fixed box, so the section's outer height never changes
          and nothing downstream (the timeline) reflows. Height is measured
          (see the component doc comment) not hard-coded; overflow scrolls as
          the safety net for whatever still doesn't fit. */}
      <div
        ref={bodyRef}
        role="tabpanel"
        data-testid={`overlay-tabpanel-${active}`}
        className="p-3 lg:p-4 overflow-y-auto"
        style={{ height: `${bodyHeight}px` }}
      >
        {panels[active]}
      </div>
    </div>
  );
}
