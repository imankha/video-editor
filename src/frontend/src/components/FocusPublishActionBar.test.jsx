import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FocusPublishActionBar } from './FocusPublishActionBar';

function makeHandlers() {
  return {
    onPublish: vi.fn(),
    onAddSpotlight: vi.fn(),
    onAddSpotlightLater: vi.fn(),
    onRefocus: vi.fn(),
  };
}

describe('FocusPublishActionBar (T8390)', () => {
  it('renders all four choices with the approved copy', () => {
    render(<FocusPublishActionBar {...makeHandlers()} />);

    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Spotlight', exact: true })).toBeTruthy();
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

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(handlers.onPublish).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Add Spotlight', exact: true }));
    expect(handlers.onAddSpotlight).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Add Spotlight Later' }));
    expect(handlers.onAddSpotlightLater).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Refocus (reframe and export again, uses credits)'));
    expect(handlers.onRefocus).toHaveBeenCalledTimes(1);
  });

  it('publishLoading spins/disables Publish only', () => {
    render(<FocusPublishActionBar {...makeHandlers()} publishLoading />);
    expect(screen.getByRole('button', { name: 'Publish' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Add Spotlight', exact: true }).disabled).toBe(false);
  });

  it('orders the three main choices Add Spotlight, Publish, Add Spotlight Later on both breakpoints, with Publish centered', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toEqual([
      'Refocus (reframe and export again, uses credits)',
      'Add Spotlight',
      'Publish',
      'Add Spotlight Later',
    ]);

    const addSpotlightItem = screen.getByRole('button', { name: 'Add Spotlight', exact: true }).closest('div');
    const publishItem = screen.getByRole('button', { name: 'Publish' }).closest('div');
    const addSpotlightLaterItem = screen.getByRole('button', { name: 'Add Spotlight Later' }).closest('div');

    // Mobile (no sm: prefix): top -> bottom Add Spotlight, Publish, Add Spotlight Later.
    expect(addSpotlightItem.className).toContain('order-1');
    expect(publishItem.className).toContain('order-2');
    expect(addSpotlightLaterItem.className).toContain('order-3');

    // Desktop (sm:): left -> right Add Spotlight, Publish, Add Spotlight Later, Publish still center.
    expect(addSpotlightItem.className).toContain('sm:order-2');
    expect(publishItem.className).toContain('sm:order-3');
    expect(addSpotlightLaterItem.className).toContain('sm:order-4');
  });
});
