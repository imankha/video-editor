import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AngleLanes from './AngleLanes';

// T8900 — AngleLanes Fix-timing surface: entry menu, drag-in-mode ONLY on the
// fix-target bar (mode gating), and the lane-change pulse class.

// jsdom lacks ResizeObserver; this mock fires the callback with a real width so
// the drag math (px -> seconds) has a non-zero usable width.
beforeEach(() => {
  global.ResizeObserver = class {
    constructor(cb) { this.cb = cb; }
    observe() { this.cb([{ contentRect: { width: 500 } }]); }
    unobserve() {}
    disconnect() {}
  };
});

const angles = [
  { sequence: 2, lane: 1, virtualStart: 40, virtualEnd: 55, name: 'endzone' },
  { sequence: 3, lane: 2, virtualStart: 42, virtualEnd: 57, name: 'sideline' },
];

const baseProps = {
  angles,
  laneCount: 2,
  duration: 100,
  edgePadding: 20,
  isMobile: false,
};

describe('AngleLanes — Fix-timing mode gating (drag)', () => {
  it('does NOT drag (onFixDragTo never fires) when NOT in Fix-timing mode', () => {
    const onFixDragTo = vi.fn();
    render(<AngleLanes {...baseProps} fixSequence={null} onFixDragTo={onFixDragTo} onRequestFixTiming={vi.fn()} />);
    const bar = screen.getByTestId('angle-bar-2');
    expect(bar.getAttribute('data-fix-target')).toBe('false');
    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(bar, { pointerId: 1 });
    expect(onFixDragTo).not.toHaveBeenCalled();
  });

  it('drags ONLY the fix-target bar, mapping px -> a new absolute offset', () => {
    const onFixDragTo = vi.fn();
    render(
      <AngleLanes
        {...baseProps}
        fixSequence={2}
        fixPendingOffset={100}
        onFixDragTo={onFixDragTo}
      />,
    );
    const target = screen.getByTestId('angle-bar-2');
    expect(target.getAttribute('data-fix-target')).toBe('true');
    // usableWidth = 500 - 2*20 = 460; move +46px -> +10s (46/460*100).
    fireEvent.pointerDown(target, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(target, { clientX: 146, pointerId: 1 });
    expect(onFixDragTo).toHaveBeenCalled();
    const last = onFixDragTo.mock.calls.at(-1)[0];
    expect(last).toBeCloseTo(110, 1); // 100 baseline + 10s
    fireEvent.pointerUp(target, { pointerId: 1 });
  });

  it('a NON-target bar does not drag even while Fix-timing is open on another bar', () => {
    const onFixDragTo = vi.fn();
    render(
      <AngleLanes
        {...baseProps}
        fixSequence={2}
        fixPendingOffset={100}
        onFixDragTo={onFixDragTo}
        onRequestFixTiming={vi.fn()}
      />,
    );
    const other = screen.getByTestId('angle-bar-3');
    expect(other.getAttribute('data-fix-target')).toBe('false');
    fireEvent.pointerDown(other, { clientX: 100, pointerId: 2 });
    fireEvent.pointerMove(other, { clientX: 200, pointerId: 2 });
    expect(onFixDragTo).not.toHaveBeenCalled();
  });
});

describe('AngleLanes — Fix-timing entry menu', () => {
  it('right-click opens the one-item menu; the item opens Fix-timing for that angle', () => {
    const onRequestFixTiming = vi.fn();
    render(<AngleLanes {...baseProps} onRequestFixTiming={onRequestFixTiming} />);
    fireEvent.contextMenu(screen.getByTestId('angle-bar-3'));
    expect(screen.getByTestId('fix-timing-menu')).toBeTruthy();
    fireEvent.click(screen.getByTestId('fix-timing-menu-item'));
    expect(onRequestFixTiming).toHaveBeenCalledWith(3);
  });

  it('renders no menu affordance when no opener is provided', () => {
    render(<AngleLanes {...baseProps} />);
    fireEvent.contextMenu(screen.getByTestId('angle-bar-2'));
    expect(screen.queryByTestId('fix-timing-menu')).toBeNull();
  });
});

describe('AngleLanes — lane-change pulse', () => {
  it('applies the shared pulse class to the pulsing bar only', () => {
    render(<AngleLanes {...baseProps} pulseSequence={2} pulseNonce={1} />);
    expect(screen.getByTestId('angle-bar-2').className).toMatch(/angle-pulse/);
    expect(screen.getByTestId('angle-bar-3').className).not.toMatch(/angle-pulse/);
  });
});
