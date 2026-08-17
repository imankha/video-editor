import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import RegionLayer from './RegionLayer';

/**
 * T7180 / prod bug 44p — a lever drag must persist ONCE, on release, carrying
 * the value the parent's move handler actually applied (clamped/frame-snapped
 * by useHighlightRegions), never the raw pointer position and never one
 * network write per pointermove.
 *
 * Before this fix, OverlayScreen wired the lever drag straight to a surgical
 * POST on every pointermove — a multi-second drag fired ~150-250 individual
 * writes (confirmed via bug 44p's console logs: ~200 near-simultaneous
 * [SLOW FETCH] POSTs to /overlay/actions). This regresses that: onMoveRegion*
 * (local/optimistic) must fire every move, onCommitRegion* (the one surgical
 * write) must fire exactly once, only if the lever actually moved, and only
 * after release.
 *
 * `regions` is deliberately RE-RENDERED between moves (mirroring the real
 * app, where the hook's setRegions after each onMoveRegionStart call changes
 * the `regions` array identity) — this is what makes the drag effect's
 * pointerup/pointermove listeners tear down and resubscribe mid-drag, which
 * is exactly the scenario a naive closure-variable "did it move" flag would
 * lose track of across (see leverMovedRef in RegionLayer.jsx).
 */

const DURATION = 10;

function region(overrides = {}) {
  return {
    id: 'r1',
    index: 0,
    startTime: 2,
    endTime: 4,
    visualStartPercent: 20,
    visualWidthPercent: 20,
    ...overrides,
  };
}

function renderLayer(overrides = {}) {
  const onMoveRegionStart = vi.fn();
  const onMoveRegionEnd = vi.fn();
  const onCommitRegionStart = vi.fn();
  const onCommitRegionEnd = vi.fn();
  const utils = render(
    <RegionLayer
      mode="highlight"
      regions={[region()]}
      duration={DURATION}
      currentTime={0}
      onMoveRegionStart={onMoveRegionStart}
      onMoveRegionEnd={onMoveRegionEnd}
      onCommitRegionStart={onCommitRegionStart}
      onCommitRegionEnd={onCommitRegionEnd}
      {...overrides}
    />
  );
  const track = utils.container.querySelector('.region-track');
  track.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 1000, bottom: 48, width: 1000, height: 48, x: 0, y: 0,
  });
  return { onMoveRegionStart, onMoveRegionEnd, onCommitRegionStart, onCommitRegionEnd, ...utils };
}

afterEach(() => cleanup());

describe('RegionLayer — commit-once-on-release (T7180)', () => {
  it('fires onMoveRegionStart on every pointermove but onCommitRegionStart only once, on release', () => {
    const { rerender, container, onMoveRegionStart, onCommitRegionStart, onCommitRegionEnd } =
      renderLayer();
    const start = screen.getByTestId('region-lever-start-0');

    fireEvent.pointerDown(start, { pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 20 });
    expect(onCommitRegionStart).not.toHaveBeenCalled();

    // Simulate the real app: each move updates local state, which re-renders
    // this component with a NEW `regions` array identity.
    for (const clientX of [300, 400, 500]) {
      fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX, clientY: 20 });
      rerender(
        <RegionLayer
          mode="highlight"
          regions={[region({ startTime: clientX / 100 })]}
          duration={DURATION}
          currentTime={0}
          onMoveRegionStart={onMoveRegionStart}
          onMoveRegionEnd={vi.fn()}
          onCommitRegionStart={onCommitRegionStart}
          onCommitRegionEnd={onCommitRegionEnd}
        />
      );
    }

    expect(onMoveRegionStart).toHaveBeenCalledTimes(3);
    expect(onCommitRegionStart).not.toHaveBeenCalled();

    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 20 });

    expect(onCommitRegionStart).toHaveBeenCalledTimes(1);
    expect(onCommitRegionStart).toHaveBeenCalledWith('r1');
    expect(onCommitRegionEnd).not.toHaveBeenCalled();
    void container;
  });

  it('does not commit a lever pressed and released without moving (a plain click)', () => {
    const { onMoveRegionStart, onCommitRegionStart } = renderLayer();
    const start = screen.getByTestId('region-lever-start-0');

    fireEvent.pointerDown(start, { pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 20 });

    expect(onMoveRegionStart).not.toHaveBeenCalled();
    expect(onCommitRegionStart).not.toHaveBeenCalled();
  });

  it('commits on pointercancel too, if the lever had moved', () => {
    const { onCommitRegionEnd } = renderLayer();
    const end = screen.getByTestId('region-lever-end-0');

    fireEvent.pointerDown(end, { pointerId: 3, pointerType: 'touch', clientX: 400, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 3, pointerType: 'touch', clientX: 620, clientY: 20 });
    fireEvent.pointerCancel(window, { pointerId: 3, pointerType: 'touch', clientX: 620, clientY: 20 });

    expect(onCommitRegionEnd).toHaveBeenCalledTimes(1);
    expect(onCommitRegionEnd).toHaveBeenCalledWith('r1');
  });

  it('a second drag on the same lever commits again exactly once (moved flag resets per gesture)', () => {
    const { onCommitRegionStart } = renderLayer();
    const start = screen.getByTestId('region-lever-start-0');

    fireEvent.pointerDown(start, { pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 300, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 300, clientY: 20 });
    expect(onCommitRegionStart).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(start, { pointerId: 2, pointerType: 'mouse', clientX: 300, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 2, pointerType: 'mouse', clientX: 350, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 2, pointerType: 'mouse', clientX: 350, clientY: 20 });
    expect(onCommitRegionStart).toHaveBeenCalledTimes(2);
  });
});
