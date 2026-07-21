import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import RegionLayer from './RegionLayer';

/**
 * T5644 — Region begin/end trim levers must be draggable with a fingertip on
 * mobile. The pre-fix version used `onMouseDown` + document `mousemove`, which on
 * touch only synthesize AFTER touchend (never during a drag), so the lever never
 * moved on a phone. The fix drives the levers with Pointer Events (mouse + touch +
 * pen, one path), `touch-action: none` so the browser doesn't hijack the drag for
 * timeline scroll, and pointer capture.
 *
 * jsdom is a regression net only — the authoritative mobile proof is the
 * real-browser Playwright spec `e2e/T5644-region-lever-touch.qa.spec.js` (coarse +
 * fine contexts), per the "pointer fixes shipped broken when only jsdom-tested"
 * memory. jsdom DOES dispatch real Pointer Events, so the handler wiring
 * (pointerdown -> window pointermove -> onMoveRegion*) is genuinely exercised here.
 */

const DURATION = 10;

// One highlight region spanning 2s..4s, pre-shaped like `regionsWithLayout`.
const REGION = {
  id: 'r1',
  index: 0,
  startTime: 2,
  endTime: 4,
  visualStartPercent: 20,
  visualWidthPercent: 20,
};

let coarse = false;
function setCoarse(value) {
  coarse = value;
  window.matchMedia = (query) => ({
    matches: query.includes('coarse') ? coarse : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

function renderLayer(overrides = {}) {
  const onMoveRegionStart = vi.fn();
  const onMoveRegionEnd = vi.fn();
  const onAddRegion = vi.fn();
  const utils = render(
    <RegionLayer
      mode="highlight"
      regions={[REGION]}
      duration={DURATION}
      currentTime={0}
      onMoveRegionStart={onMoveRegionStart}
      onMoveRegionEnd={onMoveRegionEnd}
      onAddRegion={onAddRegion}
      {...overrides}
    />
  );
  // pixelToTimeValue reads the track's bounding rect; jsdom returns zeros, so pin a
  // deterministic 1000px-wide track (usable = 1000 - 2*20 = 960px).
  const track = utils.container.querySelector('.region-track');
  track.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 1000, bottom: 48, width: 1000, height: 48, x: 0, y: 0,
  });
  return { onMoveRegionStart, onMoveRegionEnd, onAddRegion, ...utils };
}

// clientX -> source time given the mocked 1000px track: (x-20)/960*100% * 10s.
const timeAtX = (clientX) => ((clientX - 20) / 960) * 100 / 100 * DURATION;

beforeEach(() => setCoarse(false));
afterEach(() => cleanup());

describe('RegionLayer — touch-draggable trim levers (T5644)', () => {
  it('renders both levers with touch-action:none and the lever-handle guard class', () => {
    renderLayer();
    const start = screen.getByTestId('region-lever-start-0');
    const end = screen.getByTestId('region-lever-end-0');
    for (const el of [start, end]) {
      expect(el.className).toContain('lever-handle');
      expect(el.className).toContain('touch-none'); // Tailwind -> touch-action: none
    }
  });

  it('dragging the START lever with a pointer calls onMoveRegionStart with the new time', () => {
    const { onMoveRegionStart } = renderLayer();
    const start = screen.getByTestId('region-lever-start-0');

    fireEvent.pointerDown(start, { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'touch', clientX: 500, clientY: 20 });

    expect(onMoveRegionStart).toHaveBeenCalled();
    const [regionId, newTime] = onMoveRegionStart.mock.calls.at(-1);
    expect(regionId).toBe('r1');
    expect(newTime).toBeCloseTo(timeAtX(500), 5); // ~5.0s

    // pointerup ends the drag: later moves are ignored.
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'touch', clientX: 500, clientY: 20 });
    onMoveRegionStart.mockClear();
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'touch', clientX: 700, clientY: 20 });
    expect(onMoveRegionStart).not.toHaveBeenCalled();
  });

  it('dragging the END lever with a pointer calls onMoveRegionEnd with the new time', () => {
    const { onMoveRegionEnd } = renderLayer();
    const end = screen.getByTestId('region-lever-end-0');

    fireEvent.pointerDown(end, { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 2, pointerType: 'touch', clientX: 620, clientY: 20 });

    expect(onMoveRegionEnd).toHaveBeenCalled();
    const [regionId, newTime] = onMoveRegionEnd.mock.calls.at(-1);
    expect(regionId).toBe('r1');
    expect(newTime).toBeCloseTo(timeAtX(620), 5);
  });

  it('ignores pointermove from a different pointerId (second finger) mid-drag', () => {
    const { onMoveRegionStart } = renderLayer();
    const start = screen.getByTestId('region-lever-start-0');

    fireEvent.pointerDown(start, { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 20 });
    onMoveRegionStart.mockClear();
    // A different pointer must not drive this lever's drag.
    fireEvent.pointerMove(window, { pointerId: 9, pointerType: 'touch', clientX: 800, clientY: 20 });
    expect(onMoveRegionStart).not.toHaveBeenCalled();
    // The owning pointer still works.
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'touch', clientX: 500, clientY: 20 });
    expect(onMoveRegionStart).toHaveBeenCalledTimes(1);
  });

  it('enlarges the lever hit-target to >=44px on coarse pointers, 32px on fine', () => {
    setCoarse(true);
    const { unmount } = renderLayer();
    const coarseStart = screen.getByTestId('region-lever-start-0');
    expect(parseFloat(coarseStart.style.width)).toBeGreaterThanOrEqual(44);
    unmount();

    setCoarse(false);
    renderLayer();
    const fineStart = screen.getByTestId('region-lever-start-0');
    expect(parseFloat(fineStart.style.width)).toBe(32);
  });
});
