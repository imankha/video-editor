import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { OverlayPublishActionBar } from './OverlayPublishActionBar';
import { OVERLAY_PUBLISH } from '../config/displayNames';

function makeHandlers() {
  return {
    onPublishNow: vi.fn(),
    onReapplyOverlay: vi.fn(),
    onReapplyFocus: vi.fn(),
    onSaveDraft: vi.fn(),
  };
}

describe('OverlayPublishActionBar (T9110, re-hierarchized T9590)', () => {
  it('renders all four choices with the approved copy, each with its own caption', () => {
    render(<OverlayPublishActionBar {...makeHandlers()} />);

    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.PUBLISH_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.REAPPLY_FOCUS_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.SAVE_DRAFT_LABEL })).toBeTruthy();

    expect(screen.getByText(OVERLAY_PUBLISH.PUBLISH_CAPTION)).toBeTruthy();
    expect(screen.getByText(OVERLAY_PUBLISH.REAPPLY_OVERLAY_CAPTION)).toBeTruthy();
    expect(screen.getByText(OVERLAY_PUBLISH.REAPPLY_FOCUS_CAPTION)).toBeTruthy();
    expect(screen.getByText(OVERLAY_PUBLISH.SAVE_DRAFT_CAPTION)).toBeTruthy();
  });

  // The publish choice states the audience/access BEFORE the tap (T9590).
  it('Publish caption states the audience before the tap', () => {
    render(<OverlayPublishActionBar {...makeHandlers()} />);
    expect(OVERLAY_PUBLISH.PUBLISH_CAPTION).toMatch(/anyone with the link/i);
    expect(screen.getByText(/anyone with the link/i)).toBeTruthy();
  });

  // The "Reapply AI Focus" caption must stay honest about the paid re-export,
  // mirroring Focus's edit-framing caption verbatim (acceptance criterion).
  it('Reapply AI Focus caption warns it costs credits (honest paid re-export)', () => {
    render(<OverlayPublishActionBar {...makeHandlers()} />);
    expect(OVERLAY_PUBLISH.REAPPLY_FOCUS_CAPTION).toMatch(/uses credits/i);
    expect(screen.getByText(/uses credits/i)).toBeTruthy();
  });

  it('each choice fires its own handler', () => {
    const handlers = makeHandlers();
    render(<OverlayPublishActionBar {...handlers} />);

    fireEvent.click(screen.getByRole('button', { name: OVERLAY_PUBLISH.PUBLISH_LABEL }));
    expect(handlers.onPublishNow).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL }));
    expect(handlers.onReapplyOverlay).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: OVERLAY_PUBLISH.REAPPLY_FOCUS_LABEL }));
    expect(handlers.onReapplyFocus).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: OVERLAY_PUBLISH.SAVE_DRAFT_LABEL }));
    expect(handlers.onSaveDraft).toHaveBeenCalledTimes(1);
  });

  it('publishLoading spins/disables Publish only', () => {
    render(<OverlayPublishActionBar {...makeHandlers()} publishLoading />);
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.PUBLISH_LABEL }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL }).disabled).toBe(false);
  });

  // T9590: one dominant PRIMARY (Publish -- the reel is finished on this screen),
  // then secondary + tertiary cards, then a quiet Save-draft link (not a card).
  it('sets ONE dominant primary card (Publish) apart from the other cards', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    const cards = Array.from(container.querySelectorAll('[class*="rounded-xl"]'));
    expect(cards).toHaveLength(3);
    expect(new Set(cards.map((c) => c.className)).size).toBeGreaterThan(1);

    const primary = container.querySelector('[data-testid="overlay-choice-primary"]');
    expect(primary).toBeTruthy();
    expect(primary.className).toMatch(/cyan/);
    expect(cards[0]).toBe(primary);
    // The dominant action is Publish.
    expect(primary.querySelector('button').textContent).toBe(OVERLAY_PUBLISH.PUBLISH_LABEL);

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(new Set(buttons.map((b) => b.className)).size).toBeGreaterThan(1);
  });

  it('Save draft is a quiet element OUTSIDE the card grid (not a fourth competing card)', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    const saveDraft = container.querySelector('[data-testid="overlay-save-draft"]');
    expect(saveDraft).toBeTruthy();
    expect(saveDraft.closest('[class*="rounded-xl"]')).toBeNull();
    expect(saveDraft.className).toMatch(/bg-transparent/);
  });

  it('reads Publish, Reapply spotlight, Reapply AI Focus, Save draft in that DOM/tab order, no order-* juggling', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toEqual([
      OVERLAY_PUBLISH.PUBLISH_LABEL,
      OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL,
      OVERLAY_PUBLISH.REAPPLY_FOCUS_LABEL,
      OVERLAY_PUBLISH.SAVE_DRAFT_LABEL,
    ]);
    expect(container.innerHTML).not.toMatch(/(?:^|\s)(?:\w+:)?order-(?:\d+|first|last)\b/);
  });

  it('each title is wrapped in a whitespace-nowrap span (title never wraps at sm:+)', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    buttons.forEach((button) => {
      expect(button.querySelector('span.whitespace-nowrap')).toBeTruthy();
    });
  });

  // Tripwire for T8390's round-6 landmine, inherited through the T9590 restructure:
  // min-content (NOT max-content) column floor + the 3-across row gated at lg:,
  // and no overflow-x-auto safety net (it would fail OPEN and mask the bug).
  it('floors grid columns by min-content and gates the 3-across row at lg:, with no overflow-x-auto', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    expect(container.innerHTML).toMatch(/minmax\(min-content,1fr\)/);
    expect(container.innerHTML).not.toMatch(/minmax\(max-content,1fr\)/);
    expect(container.innerHTML).toMatch(/lg:grid-cols-\[repeat\(3,minmax\(min-content,1fr\)\)\]/);
    expect(container.innerHTML).not.toMatch(/overflow-x-auto/);
  });
});
