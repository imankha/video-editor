import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FocusPublishActionBar } from './FocusPublishActionBar';
import { FOCUS_PUBLISH } from '../config/displayNames';

function makeHandlers() {
  return {
    onPublish: vi.fn(),
    onAddSpotlight: vi.fn(),
    onAddSpotlightLater: vi.fn(),
    onRefocus: vi.fn(),
  };
}

describe('FocusPublishActionBar (T8390, flat redesign round 2)', () => {
  // The ONE test that pins the literal approved copy. Everything below queries via
  // FOCUS_PUBLISH so a future rename doesn't break unrelated assertions -- but a
  // rename still has to come here and be made deliberately, which is the point.
  it('renders all four choices with the approved copy, each with its own caption', () => {
    render(<FocusPublishActionBar {...makeHandlers()} />);

    expect(screen.getByRole('button', { name: 'Publish Now' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Spotlight Now' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Spotlight Later' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refocus' })).toBeTruthy();

    expect(screen.getByText('Puts it in Highlight Reels so you can share it, as is without a spotlight.')).toBeTruthy();
    // Shared caption appears under both spotlight choices.
    expect(screen.getAllByText('A spotlight is a glowing highlight that follows your athlete.')).toHaveLength(2);
    expect(screen.getByText('Reframe and export again, uses credits.')).toBeTruthy();
  });

  it('the Publish Now button carries data-tutorial-target="focus-publish" exactly once (guided-path rule 30 anchor)', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const matches = container.querySelectorAll('[data-tutorial-target="focus-publish"]');
    expect(matches.length).toBe(1);
    expect(matches[0].tagName).toBe('BUTTON');
    expect(matches[0].textContent).toContain('Publish');
  });

  it('each choice fires its own handler', () => {
    const handlers = makeHandlers();
    render(<FocusPublishActionBar {...handlers} />);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL }));
    expect(handlers.onPublish).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL }));
    expect(handlers.onAddSpotlight).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.ADD_SPOTLIGHT_LATER_LABEL }));
    expect(handlers.onAddSpotlightLater).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.REFOCUS_LABEL }));
    expect(handlers.onRefocus).toHaveBeenCalledTimes(1);
  });

  it('publishLoading spins/disables Publish Now only', () => {
    render(<FocusPublishActionBar {...makeHandlers()} publishLoading />);
    // Button.jsx only swaps the icon slot for a spinner while loading -- the
    // label text still renders (`{!iconOnly && children}` is unconditional),
    // so the accessible name is unchanged.
    expect(screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL }).disabled).toBe(false);
  });

  // Flattened 2026-09-08 (round 2): product owner explicitly rejected any
  // hierarchy ("no single choice should look more important than the
  // others") -- all four choices render as the SAME Button variant/size
  // inside identically-structured cards, in ONE DOM order at every width (no
  // `order-*` breakpoint reordering, ever -- neither the original tiered
  // design's row-cramming NOR any future reintroduction of it).
  it('reads Add Spotlight Now, Publish Now, Add Spotlight Later, Refocus at every width, with no order-* juggling', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toEqual([
      FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL,
      FOCUS_PUBLISH.PUBLISH_LABEL,
      FOCUS_PUBLISH.ADD_SPOTLIGHT_LATER_LABEL,
      FOCUS_PUBLISH.REFOCUS_LABEL,
    ]);

    expect(container.innerHTML).not.toMatch(/(?:^|\s)(?:\w+:)?order-(?:\d+|first|last)\b/);
  });

  it('gives every choice its own identically-structured card -- no card is set apart as primary', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const cards = Array.from(container.querySelectorAll('[class*="rounded-xl"]'));
    expect(cards).toHaveLength(4);

    // Every card shares the exact same class list -- none is bigger, tinted,
    // or otherwise visually distinguished from its siblings.
    const classSets = cards.map((c) => c.className);
    expect(new Set(classSets).size).toBe(1);

    // Every button shares the same variant/size styling too (no one-off
    // "primary" cyan button anywhere).
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(4);
    const buttonClassSets = buttons.map((b) => b.className);
    expect(new Set(buttonClassSets).size).toBe(1);
  });

  // jsdom does no layout, so this can only prove the CLASSES that prevent
  // wrapping are present, not that wrapping doesn't actually occur -- the
  // real regression guard for that lives in the e2e spec (which drives a
  // real browser at real viewport widths). See the component's own doc
  // comment for why BOTH classes below are required together.
  it('each title is wrapped in a whitespace-nowrap span, so the grid column floor equals its full width', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(4);
    buttons.forEach((button) => {
      const span = button.querySelector('span.whitespace-nowrap');
      expect(span).toBeTruthy();
    });
  });

  // Tripwire for the round-6 landmine: `max-content` (not `min-content`)
  // looks equivalent but silently sizes grid columns off the WRAPPABLE
  // caption text instead of the title, reintroducing a real horizontal
  // scrollbar at real desktop widths (see the component's doc comment).
  // This is implementation-detail coupling, but the bug is invisible to
  // jsdom/eyeballing and has already shipped once, so it's a deliberate
  // tradeoff.
  it('grid columns are floored by min-content, not max-content (round-6 scrollbar regression guard)', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    expect(container.innerHTML).toMatch(/minmax\(min-content,1fr\)/);
    expect(container.innerHTML).not.toMatch(/minmax\(max-content,1fr\)/);
  });
});
