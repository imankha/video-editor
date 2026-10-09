import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

/**
 * T12070 -- the play editor footer is ONE component (Done primary + first,
 * Delete ghost-destructive + last) in every layout. Before this task the four
 * layouts each hand-rolled a footer with Delete on the left and Done on the right.
 */

function mockViewport(matches) {
  window.matchMedia = (query) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

beforeEach(() => mockViewport(false));

const baseProps = {
  isVisible: true,
  currentTime: 130,
  videoDuration: 6000,
  existingClip: {
    id: 'c1', startTime: 120, endTime: 150, rating: 4, tags: [], notes: '',
    my_athlete: true, name: 'Play 1', tagged_teammates: [],
  },
  onUpdateClip: () => Promise.resolve({ saveOk: true }),
  onClose: () => {},
  onSeek: () => {},
  videoController: {},
  onDeleteClip: () => {},
};

describe('play editor footer is one component: Done first, Delete last (T12070)', () => {
  it.each(['strip', 'landscape-inline', 'portrait-strip', 'inline'])(
    'layout %s: first footer button is Done (primary), last is Delete play',
    (layout) => {
      render(<AnnotateFullscreenOverlay {...baseProps} layout={layout} />);

      const done = screen.getByRole('button', { name: 'Done' });
      const footer = done.parentElement;
      const buttons = within(footer).getAllByRole('button');

      expect(buttons[0]).toBe(done);
      expect(buttons[0].className).toContain('bg-green-600');
      expect(buttons[buttons.length - 1].getAttribute('data-testid')).toBe('delete-play-button');
    },
  );
});
