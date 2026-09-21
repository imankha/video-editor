import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CockpitIntroCard, {
  useCockpitIntroSeen,
  COCKPIT_INTRO_SEEN_KEY,
} from '../CockpitIntroCard';

// The whole point of T10850 is the persistence rule: the flag is written by a
// NAMED GESTURE — the "Got it" tap OR the first pointerdown on the stage — never
// as a side effect of the card appearing.

// Mirrors exactly how FocusCockpit wires the hook: one source of truth drives the
// card's visibility and the stage's dismissal pointerdown. Testing through this
// harness proves BOTH gestures write, and that neither renders a write.
function Harness() {
  const { seen, markSeen } = useCockpitIntroSeen();
  return (
    <div
      data-testid="stage"
      onPointerDown={seen ? undefined : markSeen}
    >
      {!seen && <CockpitIntroCard onDismiss={markSeen} />}
    </div>
  );
}

let setItemSpy;

beforeEach(() => {
  window.localStorage.clear();
  setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
});

afterEach(() => {
  setItemSpy.mockRestore();
});

describe('CockpitIntroCard (T10850) — persistence rule', () => {
  it('render alone writes NOTHING (no write on mount — the guard case)', () => {
    render(<Harness />);
    expect(screen.getByTestId('cockpit-intro-card')).toBeTruthy();
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it('the "Got it" tap writes the key and hides the card', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('cockpit-intro-confirm'));
    expect(setItemSpy).toHaveBeenCalledWith(COCKPIT_INTRO_SEEN_KEY, '1');
    expect(screen.queryByTestId('cockpit-intro-card')).toBeNull();
  });

  it('the first stage pointerdown writes the key and hides the card', () => {
    render(<Harness />);
    fireEvent.pointerDown(screen.getByTestId('stage'));
    expect(setItemSpy).toHaveBeenCalledWith(COCKPIT_INTRO_SEEN_KEY, '1');
    expect(screen.queryByTestId('cockpit-intro-card')).toBeNull();
  });

  it('is not shown once seen on this device (localStorage set)', () => {
    window.localStorage.setItem(COCKPIT_INTRO_SEEN_KEY, '1');
    setItemSpy.mockClear();
    render(<Harness />);
    expect(screen.queryByTestId('cockpit-intro-card')).toBeNull();
    expect(setItemSpy).not.toHaveBeenCalled();
  });
});

describe('CockpitIntroCard (T10850) — presentation', () => {
  it('"Got it" is a real >=44px button with an aria-label', () => {
    render(<CockpitIntroCard onDismiss={vi.fn()} />);
    const btn = screen.getByTestId('cockpit-intro-confirm');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('aria-label')).toBeTruthy();
    expect(btn.className).toContain('h-11');
  });

  it('calling render does not persist (component has no localStorage side effect)', () => {
    render(<CockpitIntroCard onDismiss={vi.fn()} />);
    expect(setItemSpy).not.toHaveBeenCalled();
  });
});
