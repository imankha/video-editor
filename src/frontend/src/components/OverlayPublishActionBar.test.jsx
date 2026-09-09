import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { OverlayPublishActionBar } from './OverlayPublishActionBar';
import { OVERLAY_PUBLISH } from '../config/displayNames';

function makeHandlers() {
  return {
    onPublishNow: vi.fn(),
    onReapplyOverlay: vi.fn(),
    onReapplyFocus: vi.fn(),
    onPublishLater: vi.fn(),
  };
}

describe('OverlayPublishActionBar (T9110, mirrors FocusPublishActionBar)', () => {
  it('renders all four choices with the approved copy, each with its own caption', () => {
    render(<OverlayPublishActionBar {...makeHandlers()} />);

    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.PUBLISH_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.REAPPLY_FOCUS_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.PUBLISH_LATER_LABEL })).toBeTruthy();

    expect(screen.getByText(OVERLAY_PUBLISH.PUBLISH_CAPTION)).toBeTruthy();
    expect(screen.getByText(OVERLAY_PUBLISH.REAPPLY_OVERLAY_CAPTION)).toBeTruthy();
    expect(screen.getByText(OVERLAY_PUBLISH.REAPPLY_FOCUS_CAPTION)).toBeTruthy();
    expect(screen.getByText(OVERLAY_PUBLISH.PUBLISH_LATER_CAPTION)).toBeTruthy();
  });

  // The "Reapply Focus" caption must stay honest about the paid re-export,
  // mirroring Focus's REFOCUS_CAPTION verbatim (acceptance criterion).
  it('Reapply Focus caption warns it costs credits (honest paid re-export)', () => {
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

    fireEvent.click(screen.getByRole('button', { name: OVERLAY_PUBLISH.PUBLISH_LATER_LABEL }));
    expect(handlers.onPublishLater).toHaveBeenCalledTimes(1);
  });

  it('publishLoading spins/disables Publish Now only', () => {
    render(<OverlayPublishActionBar {...makeHandlers()} publishLoading />);
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.PUBLISH_LABEL }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL }).disabled).toBe(false);
  });

  // Flat / no-hierarchy: same product decision as T8390 round 2. All four
  // choices are the SAME Button variant/size inside identically-structured
  // cards, in ONE DOM order at every width (no order-* breakpoint juggling).
  it('reads Publish Now, Reapply Overlay, Reapply Focus, Publish Later at every width, no order-* juggling', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toEqual([
      OVERLAY_PUBLISH.PUBLISH_LABEL,
      OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL,
      OVERLAY_PUBLISH.REAPPLY_FOCUS_LABEL,
      OVERLAY_PUBLISH.PUBLISH_LATER_LABEL,
    ]);
    expect(container.innerHTML).not.toMatch(/(?:^|\s)(?:\w+:)?order-(?:\d+|first|last)\b/);
  });

  it('gives every choice its own identically-structured card -- no card set apart as primary', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    const cards = Array.from(container.querySelectorAll('[class*="rounded-xl"]'));
    expect(cards).toHaveLength(4);
    expect(new Set(cards.map((c) => c.className)).size).toBe(1);

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(4);
    expect(new Set(buttons.map((b) => b.className)).size).toBe(1);
  });

  it('each title is wrapped in a whitespace-nowrap span (title never wraps at sm:+)', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(4);
    buttons.forEach((button) => {
      expect(button.querySelector('span.whitespace-nowrap')).toBeTruthy();
    });
  });

  // Tripwire for T8390's round-6 landmine, inherited verbatim: `max-content`
  // silently sizes columns off the WRAPPABLE caption instead of the title,
  // reintroducing a horizontal scrollbar at real desktop widths. Must be
  // min-content. Invisible to jsdom/eyeballing, so this guards the class list.
  it('grid columns are floored by min-content, not max-content (scrollbar regression guard)', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    expect(container.innerHTML).toMatch(/minmax\(min-content,1fr\)/);
    expect(container.innerHTML).not.toMatch(/minmax\(max-content,1fr\)/);
  });

  // The single-row stage must be gated at xl: (1280px), NOT sm: (640px) — the
  // row's real content need is far past 640px, so sm: would overflow on iPad
  // portrait and up (T8390 round-6 landmine #2). Guard the breakpoint choice.
  it('gates the 4-across single row at xl:, with the 2-up stage at sm: (breakpoint landmine guard)', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    expect(container.innerHTML).toMatch(/xl:grid-cols-\[repeat\(4,minmax\(min-content,1fr\)\)\]/);
    expect(container.innerHTML).toMatch(/sm:grid-cols-\[repeat\(2,minmax\(min-content,1fr\)\)\]/);
    // No 4-across row at sm: (that was the overflow bug).
    expect(container.innerHTML).not.toMatch(/sm:grid-cols-\[repeat\(4/);
    // No overflow-x-auto safety net masking a wrong breakpoint (fails OPEN).
    expect(container.innerHTML).not.toMatch(/overflow-x-auto/);
  });
});
