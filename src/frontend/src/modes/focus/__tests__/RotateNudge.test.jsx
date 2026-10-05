import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RotateNudge, { ROTATE_NUDGE_DISMISSED_KEY } from '../RotateNudge';
import { FOCUS_HINTS } from '../../../config/displayNames';

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

  it('T11710: titles the nudge as OPTIONAL and makes no tracking/motion claim', () => {
    render(<RotateNudge {...SHOWN} />);
    const el = screen.getByTestId('rotate-nudge');
    expect(el.textContent).toContain(FOCUS_HINTS.ROTATE_TITLE);
    expect(FOCUS_HINTS.ROTATE_TITLE.toLowerCase()).toContain('optional');
    expect(el.textContent).not.toMatch(/—/); // no em dash
  });

  // T11710 step 4 (merge-order note, now resolved): the subtitle was held at the
  // old "nothing scrolls" claim pending T11740 (which removes the portrait
  // horizontal overflow). T11740 has merged, so the subtitle must now read the
  // honest "works upright" copy, not the old placeholder.
  it('T11710/T11740: subtitle reads "Everything here also works upright" now that T11740 has merged', () => {
    render(<RotateNudge {...SHOWN} />);
    const el = screen.getByTestId('rotate-nudge');
    expect(FOCUS_HINTS.ROTATE_SUBTITLE).toBe('Everything here also works upright');
    expect(el.textContent).toContain(FOCUS_HINTS.ROTATE_SUBTITLE);
    expect(el.textContent).not.toContain('Twice the crop area');
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
