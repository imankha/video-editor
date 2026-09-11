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

describe('FocusPublishActionBar (T8390, re-hierarchized T9590)', () => {
  // The ONE test that pins the literal approved copy. Everything below queries via
  // FOCUS_PUBLISH so a future rename doesn't break unrelated assertions -- but a
  // rename still has to come here and be made deliberately, which is the point.
  it('renders all four choices with the approved copy, each with its own caption', () => {
    render(<FocusPublishActionBar {...makeHandlers()} />);

    expect(screen.getByRole('button', { name: 'Add spotlight' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish without spotlight' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit framing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeTruthy();

    expect(screen.getByText('A spotlight is a glowing highlight that follows your athlete.')).toBeTruthy();
    // Audience/access stated on the publish choice BEFORE the tap (T9590).
    expect(screen.getByText('Adds it to your Highlight Reels as is -- anyone with the link can watch it.')).toBeTruthy();
    // Re-render charge stated on the edit-framing choice BEFORE the tap (T9590).
    expect(screen.getByText('Reframe and export again, uses credits.')).toBeTruthy();
    expect(screen.getByText('Keep it in your drafts and finish it whenever you want.')).toBeTruthy();
  });

  it('the Publish button carries data-tutorial-target="focus-publish" exactly once (guided-path rule 30 anchor)', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const matches = container.querySelectorAll('[data-tutorial-target="focus-publish"]');
    expect(matches.length).toBe(1);
    expect(matches[0].tagName).toBe('BUTTON');
    expect(matches[0].textContent).toContain('Publish');
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

  it('publishLoading spins/disables Publish only', () => {
    render(<FocusPublishActionBar {...makeHandlers()} publishLoading />);
    // Button.jsx only swaps the icon slot for a spinner while loading -- the
    // label text still renders, so the accessible name is unchanged.
    expect(screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL }).disabled).toBe(false);
  });

  // T9590 re-hierarchization (REVERSES T8390 round 2's flat/no-hierarchy rule):
  // one dominant PRIMARY action, then a secondary + tertiary card, then a quiet
  // Save-draft link that is NOT a competing card.
  it('sets ONE dominant primary card apart from the other cards', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const cards = Array.from(container.querySelectorAll('[class*="rounded-xl"]'));
    // Exactly three cards now (the fourth "Add Spotlight Later" card is gone).
    expect(cards).toHaveLength(3);

    // The primary card is visually distinguished (tinted/ringed cyan), the other
    // two are not -- so the card class lists are NOT all identical any more.
    const classSets = new Set(cards.map((c) => c.className));
    expect(classSets.size).toBeGreaterThan(1);

    const primary = container.querySelector('[data-testid="focus-choice-primary"]');
    expect(primary).toBeTruthy();
    expect(primary.className).toMatch(/cyan/);
    // The primary card is the FIRST card in the grid.
    expect(cards[0]).toBe(primary);

    // The primary button uses a distinct (filled cyan, lg) variant -- no longer
    // the same variant/size as every other button.
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(new Set(buttons.map((b) => b.className)).size).toBeGreaterThan(1);
  });

  it('Save draft is a quiet element OUTSIDE the card grid (not a fourth competing card)', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const saveDraft = container.querySelector('[data-testid="focus-save-draft"]');
    expect(saveDraft).toBeTruthy();
    // It is not itself a card, and it is not nested inside one.
    expect(saveDraft.closest('[class*="rounded-xl"]')).toBeNull();
    // It is a ghost button (transparent), distinct from the filled/outlined cards.
    expect(saveDraft.className).toMatch(/bg-transparent/);
  });

  // Tab order follows the visual hierarchy: primary -> secondary -> tertiary ->
  // quiet Save-draft. DOM order IS tab order (no tabIndex), so assert DOM order.
  it('reads Add spotlight, Publish, Edit framing, Save draft in that DOM/tab order, with no order-* juggling', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toEqual([
      FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL,
      FOCUS_PUBLISH.PUBLISH_LABEL,
      FOCUS_PUBLISH.EDIT_FRAMING_LABEL,
      FOCUS_PUBLISH.SAVE_DRAFT_LABEL,
    ]);
    expect(container.innerHTML).not.toMatch(/(?:^|\s)(?:\w+:)?order-(?:\d+|first|last)\b/);
  });

  // jsdom does no layout, so this can only prove the CLASSES that prevent
  // wrapping are present. See the component doc comment for why both are required.
  it('each title is wrapped in a whitespace-nowrap span, so the grid column floor equals its full width', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    buttons.forEach((button) => {
      expect(button.querySelector('span.whitespace-nowrap')).toBeTruthy();
    });
  });

  // Tripwire for T8390's round-6 landmine, carried through the T9590 restructure:
  // `max-content` silently sizes columns off the WRAPPABLE caption instead of the
  // title, reintroducing a real horizontal scrollbar at desktop widths. The full
  // row is gated at lg: (three cards fit well under 1024px), NOT sm:, and there is
  // no overflow-x-auto safety net (it would fail OPEN).
  it('floors grid columns by min-content and gates the 3-across row at lg:, with no overflow-x-auto', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    expect(container.innerHTML).toMatch(/minmax\(min-content,1fr\)/);
    expect(container.innerHTML).not.toMatch(/minmax\(max-content,1fr\)/);
    expect(container.innerHTML).toMatch(/lg:grid-cols-\[repeat\(3,minmax\(min-content,1fr\)\)\]/);
    expect(container.innerHTML).not.toMatch(/overflow-x-auto/);
  });
});
