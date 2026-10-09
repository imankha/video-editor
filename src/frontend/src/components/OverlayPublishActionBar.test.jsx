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

// T12060: every choice is a CtaBar card (a native <button>) whose accessible name is its
// title (aria-label), so the name is the visible label.
function accessibleName(el) {
  return el.getAttribute('aria-label') ?? el.textContent.trim();
}

describe('OverlayPublishActionBar (T9110, re-hierarchized T9590, celebration tiles T10670, CtaBar T12060)', () => {
  it('renders the headline, three choices + the exit with the approved copy and captions', () => {
    render(<OverlayPublishActionBar {...makeHandlers()} />);

    expect(screen.getByRole('heading', { name: 'Your highlight is ready' })).toBeTruthy();

    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.PUBLISH_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.REAPPLY_FOCUS_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.SAVE_DRAFT_LABEL })).toBeTruthy();

    expect(screen.getByText(OVERLAY_PUBLISH.PUBLISH_CAPTION)).toBeTruthy();
    expect(screen.getByText(OVERLAY_PUBLISH.REAPPLY_OVERLAY_CAPTION)).toBeTruthy();
    expect(screen.getByText(OVERLAY_PUBLISH.REAPPLY_FOCUS_CAPTION)).toBeTruthy();

    // T11810: literal approved copy, matching the Focus ready screen.
    expect(OVERLAY_PUBLISH.PUBLISH_LABEL).toBe('Finish');
    expect(OVERLAY_PUBLISH.PUBLISH_CAPTION).toBe('Moves it to Finished. Only you can see it until you share a link.');
    expect(OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL).toBe('Redo spotlight');
    expect(OVERLAY_PUBLISH.REAPPLY_OVERLAY_CAPTION).toBe('Go back and change the spotlight.');
    expect(OVERLAY_PUBLISH.REAPPLY_FOCUS_LABEL).toBe('Edit framing');
    expect(OVERLAY_PUBLISH.REAPPLY_FOCUS_CAPTION).toBe('Change the framing and generate again. Uses credits.');
  });

  // The exit reads "Done for now" (no "Save" verb) and has no caption.
  it('the exit is "Done for now" with no caption', () => {
    render(<OverlayPublishActionBar {...makeHandlers()} />);
    expect(OVERLAY_PUBLISH.SAVE_DRAFT_LABEL).toBe('Done for now');
    expect(OVERLAY_PUBLISH.SAVE_DRAFT_CAPTION).toBeUndefined();
  });

  // The publish choice states the destination + honest precondition BEFORE the tap;
  // the false "anyone with the link" claim stays gone (publishing grants no audience).
  it('Publish caption states the destination and the honest precondition before the tap', () => {
    render(<OverlayPublishActionBar {...makeHandlers()} />);
    expect(OVERLAY_PUBLISH.PUBLISH_CAPTION).not.toMatch(/anyone with the link/i);
    expect(OVERLAY_PUBLISH.PUBLISH_CAPTION).toMatch(/only you can see it until you share a link/i);
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

  it('a loading Publish card is disabled with a spinning icon and leaves the other cards enabled', () => {
    render(<OverlayPublishActionBar {...makeHandlers()} publishLoading />);
    const publishCard = screen.getByRole('button', { name: OVERLAY_PUBLISH.PUBLISH_LABEL });
    expect(publishCard.disabled).toBe(true);
    expect(publishCard.querySelector('.animate-spin')).toBeTruthy();
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL }).disabled).toBe(false);
  });

  // The dominant action is Publish: the primary CtaBar card, first in the bar.
  it('sets ONE dominant primary card (Publish) first, apart from the others', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    const cards = [...container.querySelectorAll('[data-cta-role]')];
    expect(cards.map((c) => c.getAttribute('data-cta-role'))).toEqual(['primary', 'secondary', 'secondary', 'exit']);

    const primary = container.querySelector('[data-testid="overlay-choice-primary"]');
    expect(primary).toBe(cards[0]);
    expect(primary.className).toMatch(/bg-cyan-500/);
    expect(accessibleName(primary)).toBe(OVERLAY_PUBLISH.PUBLISH_LABEL);
  });

  it('Done for now is the ghost exit card, last, and not a primary or secondary', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    const exit = container.querySelector('[data-testid="overlay-save-draft"]');
    expect(exit.getAttribute('data-cta-role')).toBe('exit');
    expect(exit.className).toMatch(/bg-transparent/);
  });

  it('does not show an autosave status badge', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    expect(container.querySelector('[data-testid="overlay-retention-note"]')).toBeNull();
    expect(screen.queryByText('Saved')).toBeNull();
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

  it('each card title is wrapped in a whitespace-nowrap span (title never wraps)', () => {
    render(<OverlayPublishActionBar {...makeHandlers()} />);
    screen.getAllByRole('button').forEach((el) => {
      expect(el.querySelector('span.whitespace-nowrap')).toBeTruthy();
    });
  });

  it('has no overflow-x-auto safety net (it would fail OPEN and mask a wrapping bug)', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    expect(container.innerHTML).not.toMatch(/overflow-x-auto/);
  });
});

// T12060: the panel renders on the shared CtaBar (layout=panel): primary first, one
// exit style (the ghost exit role), and one disc size across every card.
describe('T12060: Overlay publish panel on CtaBar', () => {
  it('renders CtaBar layout=panel with the primary card first and the ghost exit last', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    const bar = container.querySelector('[data-testid="cta-bar"]');
    expect(bar).not.toBeNull();
    expect(bar.getAttribute('data-cta-layout')).toBe('panel');
    const cards = [...bar.querySelectorAll('[data-cta-role]')];
    expect(cards[0].getAttribute('data-cta-role')).toBe('primary');
    expect(cards[0].getAttribute('data-testid')).toBe('overlay-choice-primary');
    expect(cards.at(-1).getAttribute('data-cta-role')).toBe('exit');
    expect(cards.at(-1).getAttribute('data-testid')).toBe('overlay-save-draft');
    expect(cards.at(-1).className).toMatch(/bg-transparent/);
  });

  it('every card in the panel shares one disc size', () => {
    const { container } = render(<OverlayPublishActionBar {...makeHandlers()} />);
    const discs = container.querySelectorAll('[data-cta-disc]');
    expect(discs.length).toBe(4);
    discs.forEach((d) => expect(d.className).toContain('h-11 w-11'));
  });
});
