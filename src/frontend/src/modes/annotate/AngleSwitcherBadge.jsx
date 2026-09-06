import { useState } from 'react';
import { Video, ChevronUp } from 'lucide-react';

/**
 * AngleSwitcherBadge (T8890) — the floating over-video control that tells the
 * user which camera they are watching and lets them switch, shown at rest (never
 * hover-only) whenever >= 2 sources cover the playhead.
 *
 *  - 2 sources  -> a segmented pill: [ Main camera | {angle} ]
 *  - 3+ sources -> active name + chevron opening a popover of every source
 *
 * Auto-fallback: when the playhead leaves the active angle's span the container
 * silently reverts to the backbone and passes `fallbackLabel="Back to main
 * camera"` for ~1.5s; that transient message renders here even after the badge
 * itself would otherwise hide (the overlap may have ended).
 *
 * `sources` is backbone-first: [{ sequence, name, isBackbone }, ...]. The
 * backbone's `sequence` is its real video sequence; selecting it reverts to the
 * main camera. Vocabulary/copy per EPIC decision 8 + the artifact microcopy.
 */
export default function AngleSwitcherBadge({
  sources = [],
  activeSourceSequence = null,
  onSelect,
  fallbackLabel = null,
}) {
  const [open, setOpen] = useState(false);

  const backbone = sources.find((s) => s.isBackbone) || sources[0] || null;
  // null active sequence == backbone.
  const activeSeq = activeSourceSequence == null ? backbone?.sequence : activeSourceSequence;
  const active = sources.find((s) => s.sequence === activeSeq) || backbone;

  // The transient fallback message can outlive the >=2-source condition.
  if (sources.length < 2) {
    if (!fallbackLabel) return null;
    return (
      <div
        data-testid="angle-fallback-label"
        className="absolute bottom-2 right-2 z-20 px-2 py-1 rounded-md bg-gray-900/85 text-violet-200 text-xs shadow-lg pointer-events-none"
      >
        {fallbackLabel}
      </div>
    );
  }

  const select = (seq) => {
    setOpen(false);
    onSelect?.(seq);
  };

  return (
    <div className="absolute bottom-2 right-2 z-20" data-testid="angle-switcher-badge">
      {fallbackLabel && (
        <div
          data-testid="angle-fallback-label"
          className="mb-1 px-2 py-1 rounded-md bg-gray-900/85 text-violet-200 text-xs shadow-lg pointer-events-none"
        >
          {fallbackLabel}
        </div>
      )}

      {sources.length === 2 ? (
        // Segmented pill: Main camera | {angle}
        <div className="flex items-stretch rounded-md overflow-hidden shadow-lg text-xs bg-gray-900/85">
          {sources.map((s, i) => {
            const isActive = s.sequence === activeSeq;
            return (
              <button
                key={s.sequence}
                type="button"
                data-testid={`angle-switch-${s.sequence}`}
                aria-pressed={isActive}
                onClick={() => select(s.sequence)}
                className={`flex items-center gap-1 px-2 py-1 transition-colors ${i > 0 ? 'border-l border-gray-700' : ''} ${
                  isActive ? 'bg-violet-600 text-white' : 'text-violet-200 hover:bg-gray-700'
                }`}
              >
                <Video size={11} className="shrink-0" />
                <span className="truncate max-w-[100px]">{s.name}</span>
              </button>
            );
          })}
        </div>
      ) : (
        // 3+ sources: active name + chevron popover
        <div className="relative">
          {open && (
            <div
              data-testid="angle-switch-popover"
              className="absolute bottom-full right-0 mb-1 min-w-[140px] rounded-md overflow-hidden shadow-lg bg-gray-900/95 text-xs"
            >
              {sources.map((s) => {
                const isActive = s.sequence === activeSeq;
                return (
                  <button
                    key={s.sequence}
                    type="button"
                    data-testid={`angle-switch-${s.sequence}`}
                    aria-pressed={isActive}
                    onClick={() => select(s.sequence)}
                    className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors ${
                      isActive ? 'bg-violet-600 text-white' : 'text-violet-200 hover:bg-gray-700'
                    }`}
                  >
                    <Video size={11} className="shrink-0" />
                    <span className="truncate">{s.name}</span>
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            data-testid="angle-switcher-toggle"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded-md shadow-lg text-xs bg-gray-900/85 text-violet-200 hover:bg-gray-700"
          >
            <Video size={11} className="shrink-0" />
            <span className="truncate max-w-[120px]">Watching: {active?.name}</span>
            <ChevronUp size={12} className={`shrink-0 transition-transform ${open ? '' : 'rotate-180'}`} />
          </button>
        </div>
      )}
    </div>
  );
}
