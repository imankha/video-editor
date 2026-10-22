import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FixTimingStrip, { formatMoved } from './FixTimingStrip';

// T8900 — FixTimingStrip: gesture -> callback mapping (no persistence at this
// layer), moved-counter formatting, and the outer-layer Esc = discard.

describe('formatMoved (moved-counter formatting)', () => {
  it('formats zero, positive, and negative with a sign and s suffix', () => {
    expect(formatMoved(0)).toBe('Moved 0s');
    expect(formatMoved(1)).toBe('Moved +1s');
    expect(formatMoved(-1)).toBe('Moved -1s');
    expect(formatMoved(1.5)).toBe('Moved +1.5s');
    expect(formatMoved(-0.1)).toBe('Moved -0.1s');
  });

  it('rounds float accumulation noise to 0.1s (0.1+0.1+0.1 -> +0.3s)', () => {
    expect(formatMoved(0.1 + 0.1 + 0.1)).toBe('Moved +0.3s');
  });
});

describe('FixTimingStrip', () => {
  const setup = (overrides = {}) => {
    const props = {
      angleName: 'sideline',
      moved: 0,
      onNudge: vi.fn(),
      onPlayAngle: vi.fn(),
      onPlayMain: vi.fn(),
      onReset: vi.fn(),
      onDone: vi.fn(),
      onCancel: vi.fn(),
      ...overrides,
    };
    render(<FixTimingStrip {...props} />);
    return props;
  };

  it('renders the title with the angle name and the help copy', () => {
    setup();
    expect(screen.getByText('Fix timing: sideline')).toBeTruthy();
    expect(screen.getByText(/find a moment you can hear in both/i)).toBeTruthy();
  });

  it('shows the current moved delta', () => {
    setup({ moved: 1.5 });
    expect(screen.getByTestId('fix-timing-moved').textContent).toContain('Moved +1.5s');
  });

  it('nudge buttons call onNudge with the right delta and NEVER onDone (no persist per nudge)', () => {
    const props = setup();
    fireEvent.click(screen.getByTestId('fix-timing-nudge-1'));
    fireEvent.click(screen.getByTestId('fix-timing-nudge-0.1'));
    fireEvent.click(screen.getByTestId('fix-timing-nudge--1'));
    fireEvent.click(screen.getByTestId('fix-timing-nudge--0.1'));
    expect(props.onNudge.mock.calls).toEqual([[1], [0.1], [-1], [-0.1]]);
    expect(props.onDone).not.toHaveBeenCalled();
  });

  it('Done calls onDone EXACTLY once per click', () => {
    const props = setup();
    fireEvent.click(screen.getByTestId('fix-timing-done'));
    expect(props.onDone).toHaveBeenCalledTimes(1);
  });

  it('Reset calls onReset; A/B buttons call their handlers', () => {
    const props = setup();
    fireEvent.click(screen.getByTestId('fix-timing-reset'));
    fireEvent.click(screen.getByTestId('fix-timing-play-angle'));
    fireEvent.click(screen.getByTestId('fix-timing-play-main'));
    expect(props.onReset).toHaveBeenCalledTimes(1);
    expect(props.onPlayAngle).toHaveBeenCalledTimes(1);
    expect(props.onPlayMain).toHaveBeenCalledTimes(1);
  });

  it('X cancels (discard) and never fires Done', () => {
    const props = setup();
    fireEvent.click(screen.getByTestId('fix-timing-cancel'));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onDone).not.toHaveBeenCalled();
  });

  it('Esc discards (calls onCancel, never onDone -> no write)', () => {
    const props = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onDone).not.toHaveBeenCalled();
  });
});

// T13280 follow-up (2026-10-22, user: "user should be able to drag the video to
// different spots on the timeline"): a sequential (appended) video has no second
// source playing at the same moment to A/B against, so onPlayAngle/onPlayMain are
// both omitted for it -- distinct from the angle case above, where both are always
// provided.
describe('FixTimingStrip — sequential (non-angle) target', () => {
  const setupSequential = (overrides = {}) => {
    const props = {
      angleName: 'video (6)',
      moved: 0,
      onNudge: vi.fn(),
      onReset: vi.fn(),
      onDone: vi.fn(),
      onCancel: vi.fn(),
      ...overrides,
    };
    render(<FixTimingStrip {...props} />);
    return props;
  };

  it('hides the A/B play row and swaps the description when there is nothing to compare against', () => {
    setupSequential();
    expect(screen.queryByTestId('fix-timing-play-angle')).toBeNull();
    expect(screen.queryByTestId('fix-timing-play-main')).toBeNull();
    expect(screen.getByText(/drag it on the timeline or nudge it/i)).toBeTruthy();
    expect(screen.queryByText(/find a moment you can hear in both/i)).toBeNull();
  });

  it('nudge, reset, done and cancel all still work without the play row', () => {
    const props = setupSequential();
    fireEvent.click(screen.getByTestId('fix-timing-nudge-1'));
    fireEvent.click(screen.getByTestId('fix-timing-reset'));
    fireEvent.click(screen.getByTestId('fix-timing-done'));
    expect(props.onNudge).toHaveBeenCalledWith(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
    expect(props.onDone).toHaveBeenCalledTimes(1);
  });
});
