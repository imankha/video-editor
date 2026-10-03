import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { RatingPill } from './RatingPill';

/**
 * T11410 — the desktop rating picker must stay inside the viewport even when the
 * pill is anchored near the bottom/right edge (the fullscreen-editor bug: the old
 * `absolute top-full left-0` dropdown rendered off-screen). The fix portals the
 * desktop card to document.body with viewport-clamped, flip-aware `fixed`
 * positioning (the shipped ReelTile/DraftTile kebab pattern). Mobile keeps its
 * full-width bottom sheet untouched.
 */

const MARGIN = 8;

// getBoundingClientRect is identity-based so the component's positioning math has
// real rects to work with in jsdom (which otherwise returns all-zero rects). The
// card's NATURAL height is read via scrollHeight (M1), so that is mocked too —
// defaulting to the card rect's height, but overridable (cardScrollHeight) to model
// a card whose bounding rect is already capped below its natural content height.
function mockRects({ trigger, card, cardScrollHeight }) {
  const origGBCR = HTMLElement.prototype.getBoundingClientRect;
  const origSH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  HTMLElement.prototype.getBoundingClientRect = function mocked() {
    if (this.dataset?.testid === 'rating-pill') return trigger;
    if (this.dataset?.testid === 'rating-picker') return card;
    return origGBCR.call(this);
  };
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      if (this.dataset?.testid === 'rating-picker') return cardScrollHeight ?? card.height;
      return origSH?.get ? origSH.get.call(this) : 0;
    },
  });
  return () => {
    HTMLElement.prototype.getBoundingClientRect = origGBCR;
    if (origSH) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', origSH);
    else delete HTMLElement.prototype.scrollHeight;
  };
}

function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
}

let restoreRects;

beforeEach(() => {
  window.innerWidth = 800;
  window.innerHeight = 600;
});

afterEach(() => {
  restoreRects?.();
  restoreRects = undefined;
  cleanup();
});

describe('RatingPill desktop picker — viewport safety (T11410)', () => {
  it('clamps the picker inside the viewport and flips above when anchored near the bottom-right edge', () => {
    // Pill near the bottom-right corner of an 800x600 fullscreen viewport.
    restoreRects = mockRects({
      trigger: rect(700, 560, 60, 20),
      card: rect(0, 0, 300, 360),
    });
    render(<RatingPill rating={null} onRatingChange={() => {}} isMobile={false} />);
    act(() => { fireEvent.click(screen.getByTestId('rating-pill')); });

    const picker = screen.getByTestId('rating-picker');
    // Portaled to document.body so it escapes the fullscreen stacking context.
    expect(picker.parentElement).toBe(document.body);
    expect(picker.style.position).toBe('fixed');

    const left = parseFloat(picker.style.left);
    const top = parseFloat(picker.style.top);
    // Fully inside the viewport horizontally (300px wide card).
    expect(left).toBeGreaterThanOrEqual(MARGIN);
    expect(left + 300).toBeLessThanOrEqual(window.innerWidth - MARGIN + 0.5);
    // Flipped above the trigger (not overflowing the bottom, not covering the pill).
    expect(top + 360).toBeLessThanOrEqual(560); // above the pill's top (560)
    expect(top).toBeGreaterThanOrEqual(MARGIN);
  });

  it('places the picker below the trigger when there is room (windowed desktop)', () => {
    restoreRects = mockRects({
      trigger: rect(100, 100, 60, 20),
      card: rect(0, 0, 300, 360),
    });
    render(<RatingPill rating={null} onRatingChange={() => {}} isMobile={false} />);
    act(() => { fireEvent.click(screen.getByTestId('rating-pill')); });

    const picker = screen.getByTestId('rating-picker');
    const top = parseFloat(picker.style.top);
    // Below the trigger bottom (120), with a small gap, left-aligned to the pill.
    expect(top).toBeGreaterThanOrEqual(120);
    expect(parseFloat(picker.style.left)).toBe(100);
  });

  it('Escape closes the picker without reaching a sibling document-level Escape listener (B1)', () => {
    restoreRects = mockRects({ trigger: rect(100, 100, 60, 20), card: rect(0, 0, 300, 360) });
    // Model AnnotateContainer's real fullscreen-exit listener: a plain BUBBLE-phase
    // keydown on `document`, registered BEFORE the picker opens (the container mounts
    // first). The picker's capture-phase stopImmediatePropagation must prevent this
    // from firing — a bubble-phase stopPropagation on the same target would not.
    const containerEscape = vi.fn();
    document.addEventListener('keydown', containerEscape);
    try {
      render(<RatingPill rating={null} onRatingChange={() => {}} isMobile={false} />);
      act(() => { fireEvent.click(screen.getByTestId('rating-pill')); });
      expect(screen.getByTestId('rating-picker')).toBeTruthy();

      // Dispatch on a descendant of document (the real keypress targets the focused
      // element), so the picker's capture-phase listener on `document` fires before
      // this bubble-phase sibling — the whole point of the fix.
      act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }); });

      expect(screen.queryByTestId('rating-picker')).toBeNull();        // picker closed
      expect(containerEscape).not.toHaveBeenCalled();                  // did NOT exit fullscreen
    } finally {
      document.removeEventListener('keydown', containerEscape);
    }
  });

  it('flips above when the card is capped below but its natural (scroll) height needs more room (M1)', () => {
    // Pill mid-viewport: below has slightly LESS room than above, and the card's
    // natural content (scrollHeight 360) exceeds the room below. The bounding rect
    // is already capped (264) — measuring that would ratchet it into staying below;
    // measuring scrollHeight reveals it must flip above to show in full.
    restoreRects = mockRects({
      trigger: rect(100, 300, 60, 20),
      card: rect(0, 0, 300, 264),   // capped bounding-rect height
      cardScrollHeight: 360,        // larger natural height
    });
    render(<RatingPill rating={null} onRatingChange={() => {}} isMobile={false} />);
    act(() => { fireEvent.click(screen.getByTestId('rating-pill')); });

    const picker = screen.getByTestId('rating-picker');
    const top = parseFloat(picker.style.top);
    // Above the pill (top 300), not the below position (would be 328).
    expect(top).toBeLessThan(300);
    // A maxHeight cap is set so the (taller-than-available) card scrolls into reach.
    expect(picker.style.maxHeight).not.toBe('');
  });

  it('moves focus into the card on open and back to the trigger on Escape (M2)', () => {
    restoreRects = mockRects({ trigger: rect(100, 100, 60, 20), card: rect(0, 0, 300, 360) });
    render(<RatingPill rating={3} onRatingChange={() => {}} isMobile={false} />);
    const trigger = screen.getByTestId('rating-pill');
    act(() => { fireEvent.click(trigger); });

    // Open focuses the checked row (rating 3) inside the portaled card.
    const checkedRow = screen.getByRole('radio', { name: /3 stars/i });
    expect(document.activeElement).toBe(checkedRow);

    // Escape returns focus to the trigger (the card unmounts).
    act(() => { fireEvent.keyDown(checkedRow, { key: 'Escape' }); });
    expect(screen.queryByTestId('rating-picker')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on an outside pointer-down but not when clicking a rating row in the portal', () => {
    restoreRects = mockRects({ trigger: rect(100, 100, 60, 20), card: rect(0, 0, 300, 360) });
    const onRatingChange = vi.fn();
    render(<RatingPill rating={null} onRatingChange={onRatingChange} isMobile={false} />);
    act(() => { fireEvent.click(screen.getByTestId('rating-pill')); });

    // Mousedown inside the portaled card must NOT close before the row click lands.
    const row = screen.getByRole('radio', { name: /5 stars/i });
    act(() => { fireEvent.mouseDown(row); });
    expect(screen.getByTestId('rating-picker')).toBeTruthy();
    act(() => { fireEvent.click(row); });
    expect(onRatingChange).toHaveBeenCalledWith(5);

    // Re-open, then a true outside click closes it.
    act(() => { fireEvent.click(screen.getByTestId('rating-pill')); });
    act(() => { fireEvent.mouseDown(document.body); });
    expect(screen.queryByTestId('rating-picker')).toBeNull();
  });

  it('leaves the mobile bottom sheet untouched (full-width, not portaled to body)', () => {
    render(<RatingPill rating={null} onRatingChange={() => {}} isMobile />);
    act(() => { fireEvent.click(screen.getByTestId('rating-pill')); });
    const picker = screen.getByTestId('rating-picker');
    // Mobile sheet stays inside the component (not a direct child of body) and is
    // not fixed-positioned by inline style.
    expect(picker.parentElement).not.toBe(document.body);
    expect(picker.className).toContain('w-full');
  });
});
