import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FocusPublishActionBar } from './FocusPublishActionBar';
import { FOCUS_PUBLISH } from '../config/displayNames';

function makeHandlers() {
  return {
    onAddSpotlight: vi.fn(),
    onPublish: vi.fn(),
    onRefocus: vi.fn(),
    onSaveDraft: vi.fn(),
  };
}

// T12060: every choice is a CtaBar card (a native <button>) whose accessible name is its
// title (aria-label), so the name is the visible label.
function accessibleName(el) {
  return el.getAttribute('aria-label') ?? el.textContent.trim();
}

describe('FocusPublishActionBar (T8390, re-hierarchized T9590, celebration tiles T10670, CtaBar T12060)', () => {
  // The ONE test that pins the literal approved copy. Everything below queries via
  // FOCUS_PUBLISH so a future rename doesn't break unrelated assertions -- but a
  // rename still has to come here and be made deliberately, which is the point.
  it('renders the headline, three choices + the exit with the approved copy and captions', () => {
    render(<FocusPublishActionBar {...makeHandlers()} />);

    expect(screen.getByRole('heading', { name: 'Your highlight is ready' })).toBeTruthy();

    expect(screen.getByRole('button', { name: 'Add spotlight' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Finish without spotlight' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit framing' })).toBeTruthy();
    // The quiet exit is "Done for now" (was "Save draft"); no "Save" verb remains.
    expect(screen.getByRole('button', { name: 'Done for now' })).toBeTruthy();

    // Short, non-italic captions.
    expect(screen.getByText('Show everyone watching which player is yours.')).toBeTruthy();
    // Destination + honest precondition stated on the publish choice BEFORE the tap.
    expect(screen.getByText('Moves it to Finished. Only you can see it until you share a link.')).toBeTruthy();
    // Re-render charge stated on the edit-framing choice BEFORE the tap.
    expect(screen.getByText('Change the framing and generate again. Uses credits.')).toBeTruthy();
  });

  it('does not show an autosave status badge', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    expect(container.querySelector('[data-testid="focus-retention-note"]')).toBeNull();
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('the Publish card carries data-tutorial-target="focus-publish" exactly once (guided-path rule 30 anchor)', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const matches = container.querySelectorAll('[data-tutorial-target="focus-publish"]');
    expect(matches.length).toBe(1);
    expect(matches[0].tagName).toBe('BUTTON');
    expect(accessibleName(matches[0])).toBe(FOCUS_PUBLISH.PUBLISH_LABEL);
  });

  it('each choice fires its own handler', () => {
    const handlers = makeHandlers();
    render(<FocusPublishActionBar {...handlers} />);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL }));
    expect(handlers.onAddSpotlight).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL }));
    expect(handlers.onPublish).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.EDIT_FRAMING_LABEL }));
    expect(handlers.onRefocus).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.SAVE_DRAFT_LABEL }));
    expect(handlers.onSaveDraft).toHaveBeenCalledTimes(1);
  });

  // The whole card is the target: clicking its caption or its title fires the handler once.
  it('clicking anywhere in a card (caption or title) fires the handler exactly once', () => {
    const handlers = makeHandlers();
    render(<FocusPublishActionBar {...handlers} />);

    fireEvent.click(screen.getByText(FOCUS_PUBLISH.SPOTLIGHT_CAPTION));
    expect(handlers.onAddSpotlight).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText(FOCUS_PUBLISH.EDIT_FRAMING_LABEL));
    expect(handlers.onRefocus).toHaveBeenCalledTimes(1);
  });

  it('each card is a native button with no nested focusable control', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const primary = container.querySelector('[data-testid="focus-choice-primary"]');
    expect(primary.tagName).toBe('BUTTON');
    expect(primary.querySelectorAll('button, [tabindex]').length).toBe(0);
  });

  it('a loading Publish card ignores clicks, is disabled, and spins its icon', () => {
    const handlers = makeHandlers();
    render(<FocusPublishActionBar {...handlers} publishLoading />);
    const publishCard = screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL });
    fireEvent.click(screen.getByText(FOCUS_PUBLISH.PUBLISH_CAPTION));
    expect(handlers.onPublish).not.toHaveBeenCalled();
    expect(publishCard.disabled).toBe(true);
    expect(publishCard.getAttribute('aria-busy')).toBe('true');
    expect(publishCard.querySelector('.animate-spin')).toBeTruthy();
  });

  it('publishLoading disables the Publish card only', () => {
    render(<FocusPublishActionBar {...makeHandlers()} publishLoading />);
    expect(screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL }).disabled).toBe(false);
  });

  // The primary card is the solid-cyan CtaBar primary and sits first in the bar.
  it('puts ONE primary card (Add spotlight) first, apart from the others', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const cards = [...container.querySelectorAll('[data-cta-role]')];
    expect(cards.map((c) => c.getAttribute('data-cta-role'))).toEqual(['primary', 'secondary', 'secondary', 'exit']);
    expect(cards[0].getAttribute('data-testid')).toBe('focus-choice-primary');
    expect(cards[0].className).toMatch(/bg-cyan-500/);
  });

  it('Done for now is the ghost exit card, last, and not a primary or secondary', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const exit = container.querySelector('[data-testid="focus-save-draft"]');
    expect(exit.getAttribute('data-cta-role')).toBe('exit');
    expect(exit.className).toMatch(/bg-transparent/);
  });

  // Tab order follows the visual hierarchy: primary -> secondary -> secondary -> exit.
  // DOM order IS tab order (no tabIndex juggling), so assert DOM order.
  it('reads Add spotlight, Publish, Edit framing, Done for now in that DOM/tab order, with no order-* juggling', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const names = screen.getAllByRole('button').map(accessibleName);
    expect(names).toEqual([
      FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL,
      FOCUS_PUBLISH.PUBLISH_LABEL,
      FOCUS_PUBLISH.EDIT_FRAMING_LABEL,
      FOCUS_PUBLISH.SAVE_DRAFT_LABEL,
    ]);
    expect(container.innerHTML).not.toMatch(/(?:^|\s)(?:\w+:)?order-(?:\d+|first|last)\b/);
  });

  // jsdom does no layout, so this can only prove the CLASSES that prevent wrapping
  // are present: every card title is a whitespace-nowrap span.
  it('each card title is wrapped in a whitespace-nowrap span', () => {
    render(<FocusPublishActionBar {...makeHandlers()} />);
    screen.getAllByRole('button').forEach((el) => {
      expect(el.querySelector('span.whitespace-nowrap')).toBeTruthy();
    });
  });

  it('has no overflow-x-auto safety net (it would fail OPEN and mask a wrapping bug)', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    expect(container.innerHTML).not.toMatch(/overflow-x-auto/);
  });
});

// T12060: the panel renders on the shared CtaBar (layout=panel): primary first, one
// exit style (the ghost exit role), and one disc size across every card.
describe('T12060: Focus publish panel on CtaBar', () => {
  it('renders CtaBar layout=panel with the primary card first and the ghost exit last', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const bar = container.querySelector('[data-testid="cta-bar"]');
    expect(bar).not.toBeNull();
    expect(bar.getAttribute('data-cta-layout')).toBe('panel');
    const cards = [...bar.querySelectorAll('[data-cta-role]')];
    expect(cards[0].getAttribute('data-cta-role')).toBe('primary');
    expect(cards[0].getAttribute('data-testid')).toBe('focus-choice-primary');
    expect(cards.at(-1).getAttribute('data-cta-role')).toBe('exit');
    expect(cards.at(-1).getAttribute('data-testid')).toBe('focus-save-draft');
    expect(cards.at(-1).className).toMatch(/bg-transparent/);
  });

  it('every card in the panel shares one disc size', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const discs = container.querySelectorAll('[data-cta-disc]');
    expect(discs.length).toBe(4);
    discs.forEach((d) => expect(d.className).toContain('h-11 w-11'));
  });
});
