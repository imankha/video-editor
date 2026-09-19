import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { OverlayPublishActionBar } from './OverlayPublishActionBar';
import { OVERLAY_PUBLISH, RESULT_RETENTION } from '../config/displayNames';

function makeHandlers() {
  return {
    onPublishNow: vi.fn(),
    onReapplyOverlay: vi.fn(),
    onReapplyFocus: vi.fn(),
    onSaveDraft: vi.fn(),
  };
}

// T10670: each tile IS the button (a role="button" div named via aria-labelledby);
// only the "Done for now" exit is a real <button>. Resolve accessible names for order.
function accessibleName(el) {
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) return document.getElementById(labelledby)?.textContent ?? '';
  return el.textContent.trim();
}

describe('OverlayPublishActionBar (T9110, re-hierarchized T9590, celebration tiles T10670)', () => {
  it('renders the headline, three tile choices + the exit link with the approved copy and captions', () => {
    render(<OverlayPublishActionBar {...makeHandlers()} />);

    expect(screen.getByRole('heading', { name: 'Your clip is ready' })).toBeTruthy();

    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.PUBLISH_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.REAPPLY_FOCUS_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.SAVE_DRAFT_LABEL })).toBeTruthy();

    expect(screen.getByText(OVERLAY_PUBLISH.PUBLISH_CAPTION)).toBeTruthy();
    expect(screen.getByText(OVERLAY_PUBLISH.REAPPLY_OVERLAY_CAPTION)).toBeTruthy();
    expect(screen.getByText(OVERLAY_PUBLISH.REAPPLY_FOCUS_CAPTION)).toBeTruthy();
  });

  // The exit link reads "Done for now" (no "Save" verb) and has no caption.
  it('the exit link is "Done for now" with no caption', () => {
    render(<OverlayPublishActionBar {...makeHandlers()} />);
    expect(OVERLAY_PUBLISH.SAVE_DRAFT_LABEL).toBe('Done for now');
    expect(OVERLAY_PUBLISH.SAVE_DRAFT_CAPTION).toBeUndefined();
  });

  // The publish choice states the destination + honest precondition BEFORE the tap;
  // the false "anyone with the link" claim stays gone (publishing grants no audience).
  it('Publish caption states the destination and the honest precondition before the tap', () => {
    render(<OverlayPublishActionBar {...makeHandlers()} />);
    expect(OVERLAY_PUBLISH.PUBLISH_CAPTION).not.toMatch(/anyone with the link/i);
    expect(OVERLAY_PUBLISH.PUBLISH_CAPTION).toMatch(/nobody else can see this until you share a link/i);
    expect(screen.getByText(OVERLAY_PUBLISH.PUBLISH_CAPTION)).toBeTruthy();
  });

  // The "Reapply Framing" caption stays honest about the paid re-export, mirroring
  // Focus's edit-framing caption (acceptance criterion).
  it('Reapply Framing caption warns it costs credits (honest paid re-export)', () => {
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

  it('a loading Publish tile is aria-disabled with a spinner disc and disables the Publish tile only', () => {
    render(<OverlayPublishActionBar {...makeHandlers()} publishLoading />);
    const publishTile = screen.getByRole('button', { name: OVERLAY_PUBLISH.PUBLISH_LABEL });
    expect(publishTile.getAttribute('aria-disabled')).toBe('true');
    expect(publishTile.querySelector('.animate-spin')).toBeTruthy();
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL }).getAttribute('aria-disabled')).not.toBe('true');
  });

  // T9590: one dominant PRIMARY (Publish -- the reel is finished on this screen),
  // then secondary + tertiary tiles, then a quiet exit link (not a tile).
  it('sets ONE dominant primary tile (Publish) apart from the other tiles', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    const tiles = Array.from(container.querySelectorAll('[class*="rounded-xl"]'));
    expect(tiles).toHaveLength(3);
    expect(new Set(tiles.map((t) => t.className)).size).toBeGreaterThan(1);

    const primary = container.querySelector('[data-testid="overlay-choice-primary"]');
    expect(primary).toBeTruthy();
    expect(primary.className).toMatch(/cyan/);
    expect(tiles[0]).toBe(primary);
    // The dominant action is Publish.
    expect(accessibleName(primary)).toBe(OVERLAY_PUBLISH.PUBLISH_LABEL);
  });

  it('Done for now is a quiet ghost link OUTSIDE the tile grid (not a fourth competing tile)', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    const saveDraft = container.querySelector('[data-testid="overlay-save-draft"]');
    expect(saveDraft).toBeTruthy();
    expect(saveDraft.closest('[class*="rounded-xl"]')).toBeNull();
    expect(saveDraft.className).toMatch(/bg-transparent/);
  });

  // T10670: the retention line is now a one-word "Saved" chip beside the headline.
  it('renders the "Saved" chip beside the headline when provided, and omits it otherwise', () => {
    // An overlay (final-video) completion resolves to the one-word "Saved" chip text.
    expect(RESULT_RETENTION.PRIVATE_READY).toBe('Saved');
    const { rerender, container } = render(
      <OverlayPublishActionBar {...makeHandlers()} retentionNote={RESULT_RETENTION.PRIVATE_READY} />,
    );
    const el = container.querySelector('[data-testid="overlay-retention-note"]');
    expect(el).toBeTruthy();
    expect(el.textContent).toBe(RESULT_RETENTION.PRIVATE_READY);
    expect(el.closest('[class*="rounded-xl"]')).toBeNull();
    expect(el.className).toMatch(/rounded-full/);

    rerender(<OverlayPublishActionBar {...makeHandlers()} retentionNote={null} />);
    expect(container.querySelector('[data-testid="overlay-retention-note"]')).toBeNull();
  });

  it('reads Publish, Reapply spotlight, Reapply Framing, Done for now in that DOM/tab order, no order-* juggling', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    const names = screen.getAllByRole('button').map(accessibleName);
    expect(names).toEqual([
      OVERLAY_PUBLISH.PUBLISH_LABEL,
      OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL,
      OVERLAY_PUBLISH.REAPPLY_FOCUS_LABEL,
      OVERLAY_PUBLISH.SAVE_DRAFT_LABEL,
    ]);
    expect(container.innerHTML).not.toMatch(/(?:^|\s)(?:\w+:)?order-(?:\d+|first|last)\b/);
  });

  it('each control title is wrapped in a whitespace-nowrap span (title never wraps at lg:+)', () => {
    render(<OverlayPublishActionBar {...makeHandlers()} />);
    screen.getAllByRole('button').forEach((el) => {
      expect(el.querySelector('span.whitespace-nowrap')).toBeTruthy();
    });
  });

  // Tripwire for T8390's round-6 landmine, inherited through the T10670 restructure:
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
