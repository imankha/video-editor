// T6620 (report item 3) — the eye button must actually hide the text in the
// preview. Regression: a DISABLED element (`enabled === false`) is hidden even
// while its region is SELECTED; an `enabled === undefined` element (a
// DB-loaded element never toggled) still SHOWS.
//
// T6630 round 4 — model reframe: `textOverlays` is now a list of REGIONS
// (time spans), each containing N elements that render SIMULTANEOUSLY. The
// core bug this replaces: two elements added at different times used to live
// in separate disjoint spans and could never render together ("only the
// second one showed up").

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

// Mock the display-rect hook to a fixed rect (no DOM layout in unit tests).
vi.mock('../../../hooks/useVideoDisplayRect', () => ({
  default: () => ({ rect: { offsetX: 0, offsetY: 0, width: 100, height: 100 } }),
  round3: (value) => Math.round(value * 1000) / 1000,
}));

// Stub RichText to a plain marker carrying the element's text so we can
// assert which elements rendered without pulling in fonts/canvas.
vi.mock('../../../components/RichText', () => ({
  default: ({ spec }) => <div data-testid="richtext">{spec.text}</div>,
}));

import TextOverlayPreview, { clampAnchorToFrame } from './TextOverlayPreview';

afterEach(cleanup);

function region(id, elements, startTime = 0, endTime = 10) {
  return { id, startTime, endTime, elements };
}
function element(id, text, enabled) {
  const el = { id, spec: { text } };
  if (enabled !== undefined) el.enabled = enabled;
  return el;
}

function renderPreview(textOverlays, selectedRegionId = null) {
  return render(
    <TextOverlayPreview
      videoRef={{ current: null }}
      videoMetadata={{ width: 100, height: 100 }}
      textOverlays={textOverlays}
      currentTime={5}
      selectedRegionId={selectedRegionId}
    />,
  );
}

describe('TextOverlayPreview — multiple elements in ONE region render SIMULTANEOUSLY (T6630 round 4)', () => {
  it('THE BUG THIS FIXES: two elements in the same region both render at once, not just the second', () => {
    const r = region('r1', [element('a', 'FIRST', true), element('b', 'SECOND', true)]);
    renderPreview([r]);
    expect(screen.getByText('FIRST')).toBeTruthy();
    expect(screen.getByText('SECOND')).toBeTruthy();
  });

  it('each element gets its own data-testid so distinct on-screen positions can be asserted', () => {
    const r = region('r1', [element('a', 'FIRST', true), element('b', 'SECOND', true)]);
    renderPreview([r]);
    expect(screen.getByTestId('text-preview-element-a')).toBeTruthy();
    expect(screen.getByTestId('text-preview-element-b')).toBeTruthy();
  });

  it('elements from a DIFFERENT (inactive) region do not render alongside an active region\'s elements', () => {
    const active = region('r1', [element('a', 'ACTIVE', true)], 0, 10);
    const inactive = region('r2', [element('b', 'INACTIVE', true)], 20, 30);
    renderPreview([active, inactive]); // currentTime=5, inside r1's window only
    expect(screen.getByText('ACTIVE')).toBeTruthy();
    expect(screen.queryByText('INACTIVE')).toBeNull();
  });
});

describe('TextOverlayPreview — eye toggle hides one ELEMENT, not the whole region (T6620 + T6630 round 4)', () => {
  it('hides a disabled element whose region is in range', () => {
    const r = region('r1', [element('a', 'HIDE ME', false)]);
    renderPreview([r]);
    expect(screen.queryByText('HIDE ME')).toBeNull();
  });

  it('hides a disabled element EVEN when its region is selected', () => {
    // The core bug: the selected-region short-circuit used to render regardless
    // of `enabled`, so clicking the eye on the element you were editing never hid it.
    const r = region('r1', [element('a', 'SELECTED HIDDEN', false)]);
    renderPreview([r], 'r1');
    expect(screen.queryByText('SELECTED HIDDEN')).toBeNull();
  });

  it('shows an enabled element in range', () => {
    const r = region('r1', [element('a', 'VISIBLE', true)]);
    renderPreview([r]);
    expect(screen.getByText('VISIBLE')).toBeTruthy();
  });

  it('shows a DB-loaded element with enabled === undefined (never toggled)', () => {
    const r = region('r1', [element('a', 'UNDEFINED SHOWS')]);
    renderPreview([r]);
    expect(screen.getByText('UNDEFINED SHOWS')).toBeTruthy();
  });

  it('shows a selected region\'s enabled element even when the playhead is outside its range', () => {
    const r = region('r1', [element('a', 'EDIT OUT OF RANGE', true)], 20, 30);
    renderPreview([r], 'r1');
    expect(screen.getByText('EDIT OUT OF RANGE')).toBeTruthy();
  });

  it('one disabled element does not hide its enabled sibling in the SAME region', () => {
    const r = region('r1', [element('a', 'HIDDEN', false), element('b', 'STILL SHOWS', true)]);
    renderPreview([r]);
    expect(screen.queryByText('HIDDEN')).toBeNull();
    expect(screen.getByText('STILL SHOWS')).toBeTruthy();
  });
});

// T6720 -- pure clamp math for the SPATIAL drag. jsdom has no real layout
// (getBoundingClientRect is 0), so the drag MECHANICS live in the real-browser
// qa spec (e2e/T6720-text-spatial-drag.qa.spec.js); this pins the clamp
// arithmetic the qa spec's short-vs-long differential relies on.
//
// `box` = the rendered text box RELATIVE to the anchor, in frame fractions:
//   offLeftF/offTopF = box top-left minus anchor; widthF/heightF = box size.
describe('clampAnchorToFrame (T6720)', () => {
  // A center-anchored box: its left edge sits half its width left of the anchor.
  const centerBox = (widthF, heightF) => ({ offLeftF: -widthF / 2, offTopF: 0, widthF, heightF });

  it('leaves an on-frame anchor unchanged (rounded to 3dp)', () => {
    expect(clampAnchorToFrame(0.5, 0.3, centerBox(0.2, 0.1))).toEqual({ x: 0.5, y: 0.3 });
  });

  it('clamps a right-edge overshoot so the box stays on-frame', () => {
    // offLeftF=-0.1; anchorX=1.5 -> boxLeft=clamp(1.4,0,0.8)=0.8 -> x=0.8-(-0.1)=0.9
    expect(clampAnchorToFrame(1.5, 0.3, centerBox(0.2, 0.1)).x).toBeCloseTo(0.9, 3);
  });

  it('clamps top/bottom overshoot (position.y is the block TOP edge)', () => {
    const box = centerBox(0.2, 0.2);
    expect(clampAnchorToFrame(0.5, 1.5, box).y).toBeCloseTo(0.8, 3); // bottom
    expect(clampAnchorToFrame(0.5, -1, box).y).toBeCloseTo(0, 3); // top
  });

  it('a WIDER box clamps to a SMALLER max x than a narrow one (short vs long string)', () => {
    const shortMaxX = clampAnchorToFrame(1.5, 0.3, centerBox(0.2, 0.1)).x; // 0.9
    const longMaxX = clampAnchorToFrame(1.5, 0.3, centerBox(0.6, 0.1)).x; // 0.7
    expect(longMaxX).toBeLessThan(shortMaxX);
    expect(shortMaxX).toBeCloseTo(0.9, 3);
    expect(longMaxX).toBeCloseTo(0.7, 3);
  });

  it('a box WIDER than the frame stays covering the frame (never snapped inward)', () => {
    const box = centerBox(1.2, 0.1); // offLeftF=-0.6, widthF 1.2 > 1
    const farRight = clampAnchorToFrame(1.5, 0.3, box).x; // boxLeft clamps to 0 -> x=0.6
    const farLeft = clampAnchorToFrame(-1, 0.3, box).x; // boxLeft clamps to -0.2 -> x=0.4
    expect(farRight).toBeCloseTo(0.6, 3);
    expect(farLeft).toBeCloseTo(0.4, 3);
    expect(farLeft).toBeLessThan(farRight);
  });

  // The returned anchor MUST stay in [0,1] -- schemas.py Position is ge=0/le=1 and
  // update_text_spec re-validates, so an out-of-range value is a non-retryable 400.
  // The center-aligned oversized case above happens to stay in range and HID this;
  // left/right align and a tall font are the escapes.
  it('LEFT-align oversized box never returns x < 0 (would 400)', () => {
    const box = { offLeftF: 0, offTopF: 0, widthF: 1.2, heightF: 0.1 }; // left anchor = box left edge
    const r = clampAnchorToFrame(-1, 0.3, box); // raw x would be -0.2
    expect(r.x).toBe(0);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x).toBeLessThanOrEqual(1);
  });

  it('RIGHT-align oversized box never returns x > 1 (would 400)', () => {
    const box = { offLeftF: -1.2, offTopF: 0, widthF: 1.2, heightF: 0.1 }; // right anchor = box right edge
    const r = clampAnchorToFrame(2, 0.3, box); // raw x would be 1.2
    expect(r.x).toBe(1);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x).toBeLessThanOrEqual(1);
  });

  it('a tall font (offTopF > 0) never returns y < 0 at the top edge (would 400)', () => {
    const box = { offLeftF: -0.1, offTopF: 0.05, widthF: 0.2, heightF: 0.1 };
    const r = clampAnchorToFrame(0.5, -1, box); // raw y would be -0.05
    expect(r.y).toBe(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });
});
