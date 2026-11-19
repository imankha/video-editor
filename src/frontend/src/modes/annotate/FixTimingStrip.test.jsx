import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FixTimingStrip, { formatMoved } from './FixTimingStrip';

// T8900 / T17700 — FixTimingStrip (Sync): gesture -> callback mapping (no persistence
// at this layer), moved readout in words, the outer-layer Esc = discard, desktop keys.

describe('formatMoved (moved readout)', () => {
  it('says not moved, earlier or later, without a sign', () => {
    expect(formatMoved(0)).toBe('Not moved');
    expect(formatMoved(1)).toBe('Moved 1s later');
    expect(formatMoved(-1)).toBe('Moved 1s earlier');
    expect(formatMoved(1.5)).toBe('Moved 1.5s later');
    expect(formatMoved(-0.1)).toBe('Moved 0.1s earlier');
    expect(formatMoved(10)).toBe('Moved 10s later');
  });

  it('rounds float accumulation noise to 0.1s (0.1+0.1+0.1 -> 0.3s)', () => {
    expect(formatMoved(0.1 + 0.1 + 0.1)).toBe('Moved 0.3s later');
    expect(formatMoved(0.04)).toBe('Not moved');
  });
});

describe('FixTimingStrip', () => {
  const setup = (overrides = {}) => {
    const props = {
      angleName: 'sideline',
      mainName: 'Main camera',
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

  it('renders the title naming both cameras and the compare buttons naming the camera', () => {
    setup();
    expect(screen.getByText('Sync sideline with Main camera')).toBeTruthy();
    expect(screen.getByTestId('fix-timing-play-angle').textContent).toContain('Play sideline');
    expect(screen.getByTestId('fix-timing-play-main').textContent).toContain('Play main camera');
    expect(screen.getByText('Each plays the same 3 seconds.')).toBeTruthy();
  });

  it('shows the current moved delta', () => {
    setup({ moved: 1.5 });
    expect(screen.getByTestId('fix-timing-moved').textContent).toBe('Moved 1.5s later');
  });

  it('nudge buttons carry a spoken label and never call onDone (no persist per nudge)', () => {
    const props = setup();
    const earlier1 = screen.getByTestId('fix-timing-earlier-1');
    expect(earlier1.getAttribute('aria-label')).toBe('Move sideline 1 seconds earlier');
    fireEvent.click(earlier1);
    fireEvent.click(screen.getByTestId('fix-timing-later-10'));
    expect(props.onNudge.mock.calls).toEqual([[-1], [10]]);
    expect(props.onDone).not.toHaveBeenCalled();
  });

  it('Done calls onDone EXACTLY once per click', () => {
    const props = setup();
    fireEvent.click(screen.getByTestId('fix-timing-done'));
    expect(props.onDone).toHaveBeenCalledTimes(1);
  });

  it('Undo moves calls onReset; compare buttons call their handlers', () => {
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

  it('desktop keys inside the strip: arrows nudge 0.1s, Shift+arrows 1s, Enter is Done', () => {
    const props = setup();
    const strip = screen.getByTestId('fix-timing-strip');
    fireEvent.keyDown(strip, { key: 'ArrowLeft' });
    fireEvent.keyDown(strip, { key: 'ArrowRight', shiftKey: true });
    expect(props.onNudge.mock.calls).toEqual([[-0.1], [1]]);
    fireEvent.keyDown(strip, { key: 'Enter' });
    expect(props.onDone).toHaveBeenCalledTimes(1);
  });

  it('place step: Starts here is disabled with the reason while the playhead is on the video itself', () => {
    const props = setup({ step: 'place', angleName: 'video (6)', onPlace: vi.fn(), placeDisabledReason: 'Go back to the main camera first: the playhead is on video (6).' });
    expect(screen.getByTestId('fix-timing-place-confirm').disabled).toBe(true);
    expect(screen.getByText('Go back to the main camera first: the playhead is on video (6).')).toBeTruthy();
    fireEvent.click(screen.getByTestId('fix-timing-place-confirm'));
    expect(props.onPlace).not.toHaveBeenCalled();
  });
});
