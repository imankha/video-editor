// T6710 Stage 3 — CompositeScrubber (NEW shared weighted segmented bar, does
// not exist yet -- RED on import until Stage 4 creates it).
//
// Design doc §4(iv) / §7.3 (DECIDED Option B — everything proportional) /
// §7.4 (null-duration fallback weight=1) / §8 (file-by-file: "(new) shared
// SegmentedBar"). This is the ONE segmented-bar implementation both
// IntroStoryPlayer's composite bar and CollectionPlayer's internal bar use.
//
// Covers:
//   - intro cell's computed flexGrow/width == introDur
//   - every reel cell is ALSO duration-proportional (Option B), with a
//     weight=1 fallback for null/0/undefined duration (§7.4)
//   - the intro cell renders the distinct tint/label/divider (visually
//     distinct region — task file's explicit user requirement)
//
// The exact component/prop names below (`CompositeScrubber`, `segments`,
// `weight`) are a judgment call made in the absence of an implementation to
// import against — see the Stage 3 report for the explicit call-out. The
// design doc fixes the WEIGHTING SEMANTICS (flexGrow = duration, fallback 1)
// precisely; it does not fix the exact prop/component name, since that is an
// implementation-detail seam the design doc deliberately leaves to Stage 4
// ("Extract the segment-cell render into a small CompositeScrubber (or a
// shared SegmentedBar)").

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { CompositeScrubber } from './CompositeScrubber';

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

const INTRO_DUR_SEC = 4;
const SEGMENTS = [
  { kind: 'intro', label: 'Intro', durationSec: INTRO_DUR_SEC, fillPercent: 25 },
  { kind: 'reel', label: 'One', durationSec: 10, fillPercent: 100 },
  { kind: 'reel', label: 'Two', durationSec: 6, fillPercent: 0 },
  { kind: 'reel', label: 'Three', durationSec: null, fillPercent: 0 }, // §7.4 fallback
];

describe('CompositeScrubber proportional widths (T6710 — RED, Option B)', () => {
  it("the intro cell's computed flexGrow equals the intro's duration", () => {
    const { container } = render(<CompositeScrubber segments={SEGMENTS} onScrub={vi.fn()} />);
    const cells = container.querySelectorAll('[data-segment-kind]');
    expect(cells.length).toBe(4);
    const introCell = cells[0];
    expect(introCell.dataset.segmentKind).toBe('intro');
    expect(introCell.style.flexGrow).toBe(String(INTRO_DUR_SEC));
  });

  it('every reel cell is ALSO duration-proportional (flexGrow == its own durationSec)', () => {
    const { container } = render(<CompositeScrubber segments={SEGMENTS} onScrub={vi.fn()} />);
    const cells = Array.from(container.querySelectorAll('[data-segment-kind="reel"]'));
    expect(cells).toHaveLength(3);
    expect(cells[0].style.flexGrow).toBe('10'); // reel "One", duration 10
    expect(cells[1].style.flexGrow).toBe('6');  // reel "Two", duration 6
  });

  it('a reel with null/0/undefined duration falls back to weight=1 (§7.4), never flexGrow:null and never a collapsed/zero-width segment', () => {
    const { container } = render(<CompositeScrubber segments={SEGMENTS} onScrub={vi.fn()} />);
    const cells = Array.from(container.querySelectorAll('[data-segment-kind="reel"]'));
    const nullDurCell = cells[2]; // reel "Three", durationSec: null
    expect(nullDurCell.style.flexGrow).toBe('1');
  });

  it('all-null-duration reels render as visually-equal segments (weight=1 each), matching the old flex-1 fixture behavior', () => {
    const allNullReels = [
      { kind: 'reel', label: 'A', durationSec: null, fillPercent: 0 },
      { kind: 'reel', label: 'B', durationSec: null, fillPercent: 0 },
      { kind: 'reel', label: 'C', durationSec: null, fillPercent: 0 },
    ];
    const { container } = render(<CompositeScrubber segments={allNullReels} onScrub={vi.fn()} />);
    const cells = Array.from(container.querySelectorAll('[data-segment-kind="reel"]'));
    expect(cells.map((c) => c.style.flexGrow)).toEqual(['1', '1', '1']);
  });

  it('the intro cell renders a visually distinct tint/label/divider (separate scrub region requirement)', () => {
    const { container } = render(<CompositeScrubber segments={SEGMENTS} onScrub={vi.fn()} />);
    const introCell = container.querySelector('[data-segment-kind="intro"]');
    expect(introCell).not.toBeNull();
    // Distinct tint: some class/style differentiates it from a bare reel cell.
    expect(introCell.className).toMatch(/blue/i);
    // Discoverable label "Intro" (not hover-only per the style guide).
    expect(introCell.textContent).toMatch(/intro/i);
    // A divider between the intro segment and the first reel segment.
    expect(container.querySelector('[data-testid="intro-reel-divider"]')).not.toBeNull();
  });
});
