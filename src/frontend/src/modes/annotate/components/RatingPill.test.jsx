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
// real rects to work with in jsdom (which otherwise returns all-zero rects).
function mockRects({ trigger, card }) {
  const orig = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function mocked() {
    if (this.dataset?.testid === 'rating-pill') return trigger;
    if (this.dataset?.testid === 'rating-picker') return card;
    return orig.call(this);
  };
  return () => { HTMLElement.prototype.getBoundingClientRect = orig; };
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

  it('closes on Escape without propagating to the fullscreen editor handler', () => {
    restoreRects = mockRects({ trigger: rect(100, 100, 60, 20), card: rect(0, 0, 300, 360) });
    render(<RatingPill rating={null} onRatingChange={() => {}} isMobile={false} />);
    act(() => { fireEvent.click(screen.getByTestId('rating-pill')); });
    expect(screen.getByTestId('rating-picker')).toBeTruthy();

    const editorEscape = vi.fn();
    window.addEventListener('keydown', editorEscape);
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    window.removeEventListener('keydown', editorEscape);

    expect(screen.queryByTestId('rating-picker')).toBeNull();
    expect(editorEscape).not.toHaveBeenCalled();
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
