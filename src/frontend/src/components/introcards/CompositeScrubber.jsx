// T6710 — the ONE weighted segmented-bar implementation shared by
// IntroStoryPlayer's composite bar and CollectionPlayer's internal bar
// (design §4(iv) / §8: "(new) shared SegmentedBar"). Generalizes the old
// equal-width `flex-1` segment row into an ordered list of weighted segments:
// `style={{ flexGrow: seg.durationSec }}` makes each cell's width proportional
// to its own duration (§7.3 DECIDED Option B — every segment, intro AND every
// reel), with a `weight = 1` fallback for a null/0/undefined duration (§7.4)
// so a thin-data reel can never collapse to zero width or throw on
// `flexGrow: null`.
//
// Segment shape: `{ kind: 'intro' | 'reel', label, durationSec, fillPercent }`.
// The intro segment (kind === 'intro') renders visually distinct: a blue tint,
// an "Intro" label, and a divider before the first reel cell — discoverable at
// rest (not hover-only), per the UI style guide.
//
// `onScrub({ index, fraction })` fires on click with the segment index and the
// click position as a 0..1 fraction of that segment's own width — the same
// shape CollectionPlayer's `handleSegmentClick` already produced, so it can
// route straight into `goTo(index, fraction)` unchanged.
//
// `renderExtra(seg, index)` is an optional per-segment render-prop hook for
// content CollectionPlayer alone needs (the T6320 active-segment playhead
// glyph) without CompositeScrubber knowing anything about sports/glyphs.
// `onHoverChange(index | null)` and `hoverContent(seg, index)` back the hover
// tooltip CollectionPlayer's segmented bar has always had.

import { ProgressTrack } from '../shared/ProgressTrack';

function weightFor(durationSec) {
  return durationSec ? durationSec : 1;
}

export function CompositeScrubber({ segments, onScrub, onHoverChange, hoverIndex, hoverContent, renderExtra }) {
  const handleClick = (e, index) => {
    if (!onScrub) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = rect.width ? (e.clientX - rect.left) / rect.width : 0;
    onScrub({ index, fraction: Math.max(0, Math.min(1, fraction)) });
  };

  return (
    <div className="flex gap-1 px-3 pt-2">
      {segments.map((seg, i) => {
        const isIntro = seg.kind === 'intro';
        const weight = weightFor(seg.durationSec);
        const isHovered = hoverIndex === i;
        return (
          <div key={i} className="contents">
            <button
              type="button"
              aria-label={seg.label}
              data-segment-kind={seg.kind}
              onClick={(e) => handleClick(e, i)}
              onMouseEnter={() => onHoverChange?.(i)}
              onMouseLeave={() => onHoverChange?.(null)}
              style={{ flexGrow: weight, flexBasis: 0 }}
              className={`group relative py-2 cursor-pointer ${isIntro ? 'bg-blue-400/10' : ''}`}
            >
              <ProgressTrack
                trackClassName={`h-1 rounded-full overflow-hidden ${isIntro ? 'bg-blue-400/25' : 'bg-white/25'}`}
                fillClassName={`h-full rounded-full ${isIntro ? 'bg-blue-400' : 'bg-white'}`}
                progress={seg.fillPercent}
              />
              {isIntro && (
                <span className="pointer-events-none absolute -top-0.5 left-1 text-[10px] font-medium uppercase tracking-wide text-blue-300">
                  Intro
                </span>
              )}
              {renderExtra?.(seg, i)}
              {isHovered && seg.label && (
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 max-w-[80vw] -translate-x-1/2 truncate rounded bg-black/80 px-2 py-1 text-xs text-white shadow">
                  {hoverContent ? hoverContent(seg, i) : seg.label}
                </span>
              )}
            </button>
            {isIntro && (
              <div
                data-testid="intro-reel-divider"
                aria-hidden="true"
                className="w-px my-2 bg-white/30"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default CompositeScrubber;
