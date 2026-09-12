import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClipScrubRegion } from './ClipScrubRegion';

/**
 * T9480 Stage E2 -- exact start/end entry with frame stepping (AC2). Covers
 * the shared write path (parseTimeInput -> snapToStep -> clampTrim ->
 * onCommit -> onSeek) via ClipScrubRegion's rendered TrimTimeField pair.
 */
function makeController(initial = 0) {
  const state = { time: initial, paused: true };
  const el = { addEventListener: () => {}, removeEventListener: () => {}, paused: true };
  return {
    play: () => { state.paused = false; },
    pause: () => { state.paused = true; },
    seek: (t) => { state.time = t; },
    getCurrentTime: () => state.time,
    isPaused: () => state.paused,
    getActiveElement: () => el,
    setVolume: () => {},
    setMuted: () => {},
  };
}

function renderField({ onStartTimeChange = vi.fn(), onSeek = vi.fn(), ...overrides } = {}) {
  const controller = makeController(5);
  const props = {
    currentTime: 5,
    videoDuration: 600,
    existingClip: null,
    startTime: 5,
    endTime: 10,
    onStartTimeChange,
    onEndTimeChange: vi.fn(),
    onSeek,
    onDragStart: () => {},
    onDragEnd: () => {},
    videoController: controller,
    ...overrides,
  };
  render(<ClipScrubRegion {...props} />);
  return { onStartTimeChange, onSeek };
}

describe('TrimTimeField via ClipScrubRegion (T9480 Stage E2, AC2)', () => {
  it('click-to-edit: shows an input pre-filled with the current formatted value', () => {
    renderField();
    const button = screen.getByTestId('trim-field-start');
    expect(button.textContent).toBe('0:05.0');
    fireEvent.click(button);
    const input = screen.getByTestId('trim-field-input-start');
    expect(input.value).toBe('0:05.0');
  });

  it('Enter commits: parses, snaps, clamps, calls onCommit then onSeek with the SAME value', () => {
    const { onStartTimeChange, onSeek } = renderField();
    fireEvent.click(screen.getByTestId('trim-field-start'));
    const input = screen.getByTestId('trim-field-input-start');
    fireEvent.change(input, { target: { value: '0:03.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onStartTimeChange).toHaveBeenCalledTimes(1);
    const committed = onStartTimeChange.mock.calls[0][0];
    expect(committed).toBeCloseTo(3.5, 5);
    expect(onSeek).toHaveBeenCalledWith(committed);
    // Back to rest mode, showing the newly committed value (parent would pass
    // the new startTime prop in real use; here we just assert the input closed).
    expect(screen.queryByTestId('trim-field-input-start')).toBeNull();
    expect(screen.getByTestId('trim-field-start')).toBeTruthy();
  });

  it('blur commits the same way as Enter', () => {
    const { onStartTimeChange } = renderField();
    fireEvent.click(screen.getByTestId('trim-field-start'));
    const input = screen.getByTestId('trim-field-input-start');
    fireEvent.change(input, { target: { value: '8' } });
    fireEvent.blur(input);
    expect(onStartTimeChange).toHaveBeenCalledWith(8);
  });

  it('Escape discards the draft -- no commit, no seek', () => {
    const { onStartTimeChange, onSeek } = renderField();
    fireEvent.click(screen.getByTestId('trim-field-start'));
    const input = screen.getByTestId('trim-field-input-start');
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onStartTimeChange).not.toHaveBeenCalled();
    expect(onSeek).not.toHaveBeenCalled();
    expect(screen.getByTestId('trim-field-start').textContent).toBe('0:05.0');
  });

  it('invalid input shows a message, stays editing, does not write', () => {
    const { onStartTimeChange } = renderField();
    fireEvent.click(screen.getByTestId('trim-field-start'));
    const input = screen.getByTestId('trim-field-input-start');
    fireEvent.change(input, { target: { value: 'not a time' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onStartTimeChange).not.toHaveBeenCalled();
    expect(screen.getByText('Use M:SS.s (e.g. 2:09.5)')).toBeTruthy();
    // Still editing -- the input is still present.
    expect(screen.getByTestId('trim-field-input-start')).toBeTruthy();
  });

  it('a clamp that moves the typed value commits the clamped value and shows why', () => {
    // Start [5,10]; typing an end value that would violate MIN_REGION_DURATION
    // clamps to start + 0.5, with a visible message.
    const onEndTimeChange = vi.fn();
    const onSeek = vi.fn();
    renderField({ onEndTimeChange, onSeek, startTime: 5, endTime: 10 });
    fireEvent.click(screen.getByTestId('trim-field-end'));
    const input = screen.getByTestId('trim-field-input-end');
    fireEvent.change(input, { target: { value: '5.1' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onEndTimeChange).toHaveBeenCalledWith(5.5);
    expect(onSeek).toHaveBeenCalledWith(5.5);
    expect(screen.getByText(/at least 0.5s after the start/)).toBeTruthy();
  });

  it('step chevrons move by 1/30s (one frame)', () => {
    const onStartTimeChange = vi.fn();
    const onSeek = vi.fn();
    renderField({ onStartTimeChange, onSeek, startTime: 5, endTime: 10 });
    const stepButtons = screen.getAllByTitle('Step one frame (1/30 s)');
    // Left/right chevrons flank the start field first, then the end field.
    fireEvent.click(stepButtons[1]); // step forward on the start field
    expect(onStartTimeChange).toHaveBeenCalledWith(5 + 1 / 30);
    expect(onSeek).toHaveBeenCalledWith(5 + 1 / 30);
  });

  it('ArrowUp/ArrowDown while editing steps by one frame; Shift+Arrow steps by one second', () => {
    const onStartTimeChange = vi.fn();
    const onSeek = vi.fn();
    renderField({ onStartTimeChange, onSeek, startTime: 5, endTime: 10 });
    fireEvent.click(screen.getByTestId('trim-field-start'));
    const input = screen.getByTestId('trim-field-input-start');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onStartTimeChange).toHaveBeenLastCalledWith(5 + 1 / 30);

    // Each step is relative to the CURRENT startTime prop (5, unchanged here
    // since this test doesn't re-render with the parent's committed value) --
    // Shift+Arrow steps a full second from that same prop, not cumulatively.
    fireEvent.keyDown(input, { key: 'ArrowDown', shiftKey: true });
    expect(onStartTimeChange).toHaveBeenLastCalledWith(5 - 1);
  });
});
