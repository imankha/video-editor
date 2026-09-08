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

describe('FocusPublishActionBar (T8390)', () => {
  // The ONE test that pins the literal approved copy. Everything below queries via
  // FOCUS_PUBLISH so a future rename doesn't break unrelated assertions -- but a
  // rename still has to come here and be made deliberately, which is the point.
  it('renders all four choices with the approved copy', () => {
    render(<FocusPublishActionBar {...makeHandlers()} />);

    expect(screen.getByRole('button', { name: 'Publish Now' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Spotlight Now' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Spotlight Later' })).toBeTruthy();
    expect(screen.getByText('Refocus (reframe and export again, uses credits)')).toBeTruthy();
    expect(screen.getByText('Puts it in Highlight Reels so you can share it.')).toBeTruthy();
    expect(screen.getByText('A spotlight is a glowing highlight that follows your athlete.')).toBeTruthy();
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

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL }));
    expect(handlers.onPublish).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL }));
    expect(handlers.onAddSpotlight).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.ADD_SPOTLIGHT_LATER_LABEL }));
    expect(handlers.onAddSpotlightLater).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText(FOCUS_PUBLISH.REFOCUS_LABEL));
    expect(handlers.onRefocus).toHaveBeenCalledTimes(1);
  });

  it('publishLoading spins/disables Publish only', () => {
    render(<FocusPublishActionBar {...makeHandlers()} publishLoading />);
    expect(screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL }).disabled).toBe(false);
  });

  // Redesigned 2026-09-08: three stacked zones (Publish / the spotlight pair /
  // Refocus) in the SAME order at every width. The old design crammed all four
  // into one row and reordered them per breakpoint with `order-*` utilities;
  // this asserts that visual hierarchy is now carried by DOM order alone, so a
  // regression back to breakpoint-reordering fails here.
  it('reads Publish, Add Spotlight Now, Add Spotlight Later, Refocus at every width', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toEqual([
      FOCUS_PUBLISH.PUBLISH_LABEL,
      FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL,
      FOCUS_PUBLISH.ADD_SPOTLIGHT_LATER_LABEL,
      FOCUS_PUBLISH.REFOCUS_LABEL,
    ]);

    // No `order-*` juggling anywhere: DOM order IS the visual order at every
    // breakpoint (the explicit fix for the old crammed single-row strip).
    expect(container.innerHTML).not.toMatch(/\border-\d\b|\bsm:order-\d\b/);
  });

  it('gives Publish its own primary zone, separate from the paired spotlight choices', () => {
    render(<FocusPublishActionBar {...makeHandlers()} />);
    const publishZone = screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL }).closest('div');
    const spotlightNow = screen.getByRole('button', { name: FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL });
    const spotlightLater = screen.getByRole('button', { name: FOCUS_PUBLISH.ADD_SPOTLIGHT_LATER_LABEL });

    // Publish is alone in its zone; the two spotlight choices share theirs.
    expect(publishZone.contains(spotlightNow)).toBe(false);
    expect(spotlightNow.closest('div')).toBe(spotlightLater.closest('div'));
  });
});
