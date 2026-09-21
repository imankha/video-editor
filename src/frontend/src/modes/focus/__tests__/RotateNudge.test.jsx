import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RotateNudge, { ROTATE_NUDGE_DISMISSED_KEY } from '../RotateNudge';

// The whole point of T10850 is the persistence rule: the flag is written by a
// NAMED GESTURE (the X tap), never as a side effect of the hint appearing.

const SHOWN = { isMobile: true, isLandscape: false, hasFocusPoints: false };

let setItemSpy;

beforeEach(() => {
  window.localStorage.clear();
  setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
});

afterEach(() => {
  setItemSpy.mockRestore();
});

describe('RotateNudge (T10850) — shown/hidden truth table', () => {
  it('is shown on a phone in portrait with no focus points yet, not dismissed', () => {
    render(<RotateNudge {...SHOWN} />);
    expect(screen.getByTestId('rotate-nudge')).toBeTruthy();
  });

  it('is hidden when not mobile', () => {
    render(<RotateNudge {...SHOWN} isMobile={false} />);
    expect(screen.queryByTestId('rotate-nudge')).toBeNull();
  });

  it('is hidden in landscape (that is the cockpit, not the portrait nudge)', () => {
    render(<RotateNudge {...SHOWN} isLandscape={true} />);
    expect(screen.queryByTestId('rotate-nudge')).toBeNull();
  });

  it('is hidden once the clip already has focus points', () => {
    render(<RotateNudge {...SHOWN} hasFocusPoints={true} />);
    expect(screen.queryByTestId('rotate-nudge')).toBeNull();
  });

  it('is hidden when already dismissed on this device (localStorage set)', () => {
    window.localStorage.setItem(ROTATE_NUDGE_DISMISSED_KEY, '1');
    setItemSpy.mockClear();
    render(<RotateNudge {...SHOWN} />);
    expect(screen.queryByTestId('rotate-nudge')).toBeNull();
  });
});

describe('RotateNudge (T10850) — persistence rule', () => {
  it('render alone writes NOTHING (no write on mount — the guard case)', () => {
    render(<RotateNudge {...SHOWN} />);
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it('the X tap writes the key and hides the nudge', () => {
    render(<RotateNudge {...SHOWN} />);
    fireEvent.click(screen.getByTestId('rotate-nudge-dismiss'));
    expect(setItemSpy).toHaveBeenCalledWith(ROTATE_NUDGE_DISMISSED_KEY, '1');
    expect(screen.queryByTestId('rotate-nudge')).toBeNull();
  });

  it('the X is a real 44px button with an aria-label', () => {
    render(<RotateNudge {...SHOWN} />);
    const x = screen.getByTestId('rotate-nudge-dismiss');
    expect(x.tagName).toBe('BUTTON');
    expect(x.getAttribute('aria-label')).toBeTruthy();
    expect(x.className).toContain('h-11');
    expect(x.className).toContain('w-11');
  });
});
