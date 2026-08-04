import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TextLayer from './TextLayer';

/**
 * T5225 — Stage 3 (test-first). `TextLayer.jsx` does not exist yet.
 *
 * Design (docs/plans/tasks/T5225-design.md §3.1): a near-clone of RegionLayer's
 * pointer-event mechanics (see RegionLayer.touch.test.jsx / RegionLayer.jsx),
 * NOT a new drag idiom:
 *   - pointerdown -> setPointerCapture -> drag state { blockId, type, pointerId }
 *   - window pointermove {passive:false} / pointerup / pointercancel, guarded by pointerId
 *   - touch-action:none (`touch-none`) + `.lever-handle` class on each lever
 *   - data-testid="text-lever-start-{i}" / "text-lever-end-{i}"
 *
 * This is a regression net only (jsdom); real-browser pointer-drag verification
 * is a separate QA pass per the prompt -- not attempted here.
 */

const DURATION = 10;

const BLOCK = {
  id: 't1',
  index: 0,
  startTime: 2,
  endTime: 4,
  visualStartPercent: 20,
  visualWidthPercent: 20,
  spec: { text: 'GOAL' },
  enabled: true,
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
  const onMoveTextStart = vi.fn();
  const onMoveTextEnd = vi.fn();
  const onAddText = vi.fn();
  const utils = render(
    <TextLayer
      blocks={[BLOCK]}
      duration={DURATION}
      currentTime={0}
      clipBoundaries={[]}
      onMoveTextStart={onMoveTextStart}
      onMoveTextEnd={onMoveTextEnd}
      onAddText={onAddText}
      {...overrides}
    />
  );
  const track = utils.container.querySelector('.text-track') || utils.container.querySelector('[class*="track"]');
  if (track) {
    track.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 1000, bottom: 48, width: 1000, height: 48, x: 0, y: 0,
    });
  }
  return { onMoveTextStart, onMoveTextEnd, onAddText, track, ...utils };
}

beforeEach(() => setCoarse(false));
afterEach(() => cleanup());

describe('TextLayer — pointer-draggable edge levers (T5225)', () => {
  it('renders both levers with touch-action:none and the lever-handle guard class', () => {
    renderLayer();
    const start = screen.getByTestId('text-lever-start-0');
    const end = screen.getByTestId('text-lever-end-0');
    for (const el of [start, end]) {
      expect(el.className).toContain('lever-handle');
      expect(el.className).toContain('touch-none');
    }
  });

  it('pointerdown captures the pointer and window pointermove drives onMoveTextStart', () => {
    const { onMoveTextStart } = renderLayer();
    const start = screen.getByTestId('text-lever-start-0');

    fireEvent.pointerDown(start, { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'touch', clientX: 500, clientY: 20 });

    expect(onMoveTextStart).toHaveBeenCalled();
    const [blockId, newTime] = onMoveTextStart.mock.calls.at(-1);
    expect(blockId).toBe('t1');
    expect(typeof newTime).toBe('number');

    // pointerup ends the drag: later moves are ignored.
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'touch', clientX: 500, clientY: 20 });
    onMoveTextStart.mockClear();
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'touch', clientX: 700, clientY: 20 });
    expect(onMoveTextStart).not.toHaveBeenCalled();
  });

  it('window pointermove drives onMoveTextEnd for the end lever', () => {
    const { onMoveTextEnd } = renderLayer();
    const end = screen.getByTestId('text-lever-end-0');

    fireEvent.pointerDown(end, { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 2, pointerType: 'touch', clientX: 620, clientY: 20 });

    expect(onMoveTextEnd).toHaveBeenCalled();
    const [blockId] = onMoveTextEnd.mock.calls.at(-1);
    expect(blockId).toBe('t1');
  });

  it('ignores pointermove from a different pointerId (second finger) mid-drag', () => {
    const { onMoveTextStart } = renderLayer();
    const start = screen.getByTestId('text-lever-start-0');

    fireEvent.pointerDown(start, { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 20 });
    onMoveTextStart.mockClear();
    fireEvent.pointerMove(window, { pointerId: 9, pointerType: 'touch', clientX: 800, clientY: 20 });
    expect(onMoveTextStart).not.toHaveBeenCalled();
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'touch', clientX: 500, clientY: 20 });
    expect(onMoveTextStart).toHaveBeenCalledTimes(1);
  });

  it('a drag ending near a clip boundary reports the boundary exact time (snap)', () => {
    // Track is mocked to 1000px wide, edgePadding 20 -> usable 960px over 10s => 96px/s.
    // Put a clip boundary at 5.0s -> pixel x = 20 + (5.0/10)*960 = 500.
    const { onMoveTextStart } = renderLayer({ clipBoundaries: [5.0] });
    const start = screen.getByTestId('text-lever-start-0');

    fireEvent.pointerDown(start, { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 20 });
    // Drag to within a few px of the boundary's pixel position (500).
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'touch', clientX: 505, clientY: 20 });

    const [, newTime] = onMoveTextStart.mock.calls.at(-1);
    expect(newTime).toBeCloseTo(5.0, 5);
  });

  it('a drag ending far from any clip boundary free-parks at the raw computed time', () => {
    const { onMoveTextStart } = renderLayer({ clipBoundaries: [5.0] });
    const start = screen.getByTestId('text-lever-start-0');

    fireEvent.pointerDown(start, { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 20 });
    // Drag to clientX=700 -- far (200px) from the boundary pixel (500).
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'touch', clientX: 700, clientY: 20 });

    const [, newTime] = onMoveTextStart.mock.calls.at(-1);
    // Raw time at x=700: (700-20)/960*10 ≈ 7.083s -- NOT snapped to 5.0.
    expect(newTime).not.toBeCloseTo(5.0, 1);
    expect(newTime).toBeCloseTo(((700 - 20) / 960) * 10, 2);
  });
});
