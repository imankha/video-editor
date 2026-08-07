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

const WIDE_RECT = () => ({
  left: 0, top: 0, right: 1000, bottom: 112, width: 1000, height: 112, x: 0, y: 0,
});

function renderLayer(overrides = {}) {
  const onMoveTextStart = vi.fn();
  const onMoveTextEnd = vi.fn();
  const onMoveTextBody = vi.fn();
  const onSelectText = vi.fn();
  const onDeleteText = vi.fn();
  const utils = render(
    <TextLayer
      blocks={[BLOCK]}
      duration={DURATION}
      clipBoundaries={[]}
      onMoveTextStart={onMoveTextStart}
      onMoveTextEnd={onMoveTextEnd}
      onMoveTextBody={onMoveTextBody}
      onSelectText={onSelectText}
      onDeleteText={onDeleteText}
      {...overrides}
    />
  );
  const track = utils.container.querySelector('.text-track') || utils.container.querySelector('[class*="track"]');
  if (track) {
    track.getBoundingClientRect = () => WIDE_RECT();
  }
  const lane = track ? track.parentElement : null;
  if (lane) {
    lane.getBoundingClientRect = () => WIDE_RECT();
  }
  return { onMoveTextStart, onMoveTextEnd, onMoveTextBody, onSelectText, onDeleteText, track, lane, ...utils };
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

describe('TextLayer — body drag moves the whole block (T6610)', () => {
  it('body pointerdown + move drives onMoveTextBody with commit=false (no persist mid-drag)', () => {
    const { onMoveTextBody } = renderLayer();
    const body = screen.getByTestId('text-block-body-0');

    // Grab the block body at x=280 (inside the [2,4] block: px 212..404).
    fireEvent.pointerDown(body, { pointerId: 1, pointerType: 'mouse', clientX: 280, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 400, clientY: 20 });

    expect(onMoveTextBody).toHaveBeenCalled();
    const call = onMoveTextBody.mock.calls.at(-1);
    expect(call[0]).toBe('t1');
    expect(typeof call[1]).toBe('number');
    expect(call[2], 'mid-drag calls must NOT commit').toBe(false);
  });

  it('fires EXACTLY ONE commit (commit=true) on pointerup — one persist per drag', () => {
    const { onMoveTextBody } = renderLayer();
    const body = screen.getByTestId('text-block-body-0');

    fireEvent.pointerDown(body, { pointerId: 1, pointerType: 'mouse', clientX: 280, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 360, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 440, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 440, clientY: 20 });

    const commits = onMoveTextBody.mock.calls.filter((c) => c[2] === true);
    expect(commits, 'exactly one commit=true per completed drag').toHaveLength(1);

    // After pointerup the drag is over: later moves are ignored.
    onMoveTextBody.mockClear();
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 600, clientY: 20 });
    expect(onMoveTextBody).not.toHaveBeenCalled();
  });

  it('a click-in-place (sub-threshold) selects, never moves or commits', () => {
    const { onMoveTextBody } = renderLayer();
    const body = screen.getByTestId('text-block-body-0');

    fireEvent.pointerDown(body, { pointerId: 1, pointerType: 'mouse', clientX: 300, clientY: 20 });
    // Move only 2px -- below BODY_DRAG_THRESHOLD_PX (4).
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 302, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 302, clientY: 20 });

    expect(onMoveTextBody, 'a click must not move the block').not.toHaveBeenCalled();
  });

  it('pressing a LEVER never invokes the body-move path (resize vs move hit-test)', () => {
    const { onMoveTextBody, onMoveTextStart } = renderLayer();
    const start = screen.getByTestId('text-lever-start-0');

    fireEvent.pointerDown(start, { pointerId: 1, pointerType: 'mouse', clientX: 212, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 400, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 400, clientY: 20 });

    expect(onMoveTextStart, 'lever still resizes').toHaveBeenCalled();
    expect(onMoveTextBody, 'lever press never moves the whole block').not.toHaveBeenCalled();
  });

  it('ArrowRight / ArrowLeft nudge the block and each commits once (keyboard equivalent)', () => {
    const { onMoveTextBody } = renderLayer();
    const body = screen.getByTestId('text-block-body-0');

    fireEvent.keyDown(body, { key: 'ArrowRight' });
    let call = onMoveTextBody.mock.calls.at(-1);
    expect(call[0]).toBe('t1');
    expect(call[1], 'ArrowRight nudges start forward by one frame').toBeCloseTo(2 + 1 / 30, 5);
    expect(call[2], 'keyboard nudge commits').toBe(true);

    fireEvent.keyDown(body, { key: 'ArrowLeft', shiftKey: true });
    call = onMoveTextBody.mock.calls.at(-1);
    expect(call[1], 'Shift+ArrowLeft nudges back by 1s').toBeCloseTo(2 - 1.0, 5);
    expect(call[2]).toBe(true);
  });
});

describe('TextLayer — lane is TIMING ONLY, no add path (T6630 round 3)', () => {
  // Round 2 put an add-on-click affordance in the lane (whole-lane click, then an
  // in-lane "+ Add text" button). Round 3 removes BOTH: add/remove/settings moved
  // entirely into the Text tab (TextManagementPanel) -- one add path, not two.
  // These guard against either affordance quietly reappearing in the lane.
  it('clicking empty lane space does not add a block (no onAddText prop, no click-to-add)', () => {
    const { lane } = renderLayer({ blocks: [] });
    expect(lane).toBeTruthy();
    // Should not throw and should not select/move anything either -- the lane has
    // no click handler at all now.
    expect(() => fireEvent.click(lane, { clientX: 500, clientY: 90 })).not.toThrow();
  });

  it('no in-lane "Add text" control is rendered', () => {
    renderLayer({ blocks: [BLOCK] });
    expect(screen.queryByTestId('add-text-in-lane')).toBeNull();
    expect(screen.queryByText(/add text/i)).toBeNull();
  });

  it('no per-block eye/trash controls are rendered in the lane (moved to the Text tab)', () => {
    renderLayer({ blocks: [BLOCK] });
    expect(screen.queryByTitle('Delete text block')).toBeNull();
    expect(screen.queryByTitle(/hide text|show text/i)).toBeNull();
  });
});

describe('TextLayer — keyboard delete of the focused block (T6630)', () => {
  it('Delete removes the focused block via the single onDeleteText path', () => {
    const { onDeleteText } = renderLayer();
    const body = screen.getByTestId('text-block-body-0');
    fireEvent.keyDown(body, { key: 'Delete' });
    expect(onDeleteText).toHaveBeenCalledWith('t1');
  });

  it('Backspace also removes the focused block', () => {
    const { onDeleteText } = renderLayer();
    const body = screen.getByTestId('text-block-body-0');
    fireEvent.keyDown(body, { key: 'Backspace' });
    expect(onDeleteText).toHaveBeenCalledWith('t1');
  });
});
