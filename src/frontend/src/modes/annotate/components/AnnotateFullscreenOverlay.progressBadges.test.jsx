import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, cleanup, within } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { RATING_ADJECTIVES } from '../../../components/shared/clipConstants';
import { ANNOTATE } from '../../../config/displayNames';
import { useProjectsStore } from '../../../stores/projectsStore';

beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
});

afterEach(() => {
  cleanup();
  useProjectsStore.setState({ projects: [] });
});

const baseProps = {
  isVisible: true, currentTime: 30, videoDuration: 6000,
  onUpdateClip: () => Promise.resolve({ saveOk: true }), onClose: () => {},
  onSeek: () => {}, videoController: {}, onDeleteClip: () => {},
};

const bareClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: ['Goal'], my_athlete: true,
  name: 'Good Goal', hasCustomName: false, notes: '', autoProjectId: null,
};

function order(container, testids) {
  const nodes = testids.map((id) => container.querySelector(`[data-testid="${id}"]`) || container.querySelector(`[aria-label="${id}"]`));
  nodes.forEach((node) => expect(node).toBeTruthy());
  for (let i = 0; i < nodes.length - 1; i += 1) {
    expect(nodes[i].compareDocumentPosition(nodes[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
}

describe('T11840: one labeled rating control', () => {
  it('renders one rating row: the question, a word under every star, and the hint', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    const row = screen.getByTestId('rating-input');
    expect(within(row).getByText(ANNOTATE.RATING_QUESTION)).toBeTruthy();
    for (let n = 1; n <= 5; n += 1) {
      expect(within(row).getByText(RATING_ADJECTIVES[n])).toBeTruthy();
    }
    expect(within(row).getByText(ANNOTATE.RATING_HIGHLIGHT_HINT)).toBeTruthy();
    // The old gray pill and the bare "Rating" label are gone.
    expect(screen.queryByTestId('rating-pill')).toBeNull();
    expect(screen.queryByText('Rating')).toBeNull();
    expect(screen.queryByText(ANNOTATE.RATE_PLAY)).toBeNull();
  });

  it.each([1, 2, 3, 4, 5])('rating %i: selected star and its caption turn amber, others stay gray', (rating) => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, rating }} />);
    const row = screen.getByTestId('rating-input');
    expect(row.dataset.rating).toBe(String(rating));
    for (let n = 1; n <= 5; n += 1) {
      const caption = within(row).getByText(RATING_ADJECTIVES[n]);
      if (n === rating) expect(caption.className).toMatch(/text-amber-400/);
      else expect(caption.className).not.toMatch(/text-amber-400/);
    }
  });

  it('clicking a star persists {rating} through the existing onUpdateClip gesture path; the digit shortcut still works', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} onUpdateClip={onUpdateClip} />);
    fireEvent.click(screen.getByTitle('5 stars'));
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { rating: 5 });
    fireEvent.keyDown(window, { key: '2' });
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { rating: 2 });
  });

  it('keeps the trim field, rating row, and details disclosure in that reading order', () => {
    const { container } = render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    order(container, ['trim-field-start', 'rating-input', 'add-details-button']);
  });

  for (const layout of ['inline', 'overlay', 'portrait-strip', 'landscape-inline']) {
    it(`${layout}: exactly one rating row precedes optional details`, () => {
      const { container } = render(<AnnotateFullscreenOverlay {...baseProps} layout={layout} existingClip={bareClip} />);
      order(container, ['rating-input', 'add-details-button']);
      expect(screen.getAllByTestId('rating-input')).toHaveLength(1);
      expect(screen.queryByTestId('rating-pill')).toBeNull();
    });
  }

  it('details does not render another rating control', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    expect(screen.getAllByTestId('rating-input')).toHaveLength(1);
  });

  it('the Brilliant cell carries the gold ring', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    const brilliant = screen.getByRole('radio', { name: '5 stars - Brilliant' });
    expect(brilliant.style.boxShadow).toContain('#F5B700');
  });
});

describe('tablet-safe primary actions', () => {
  it('keeps Delete play and Done before the expandable details panel', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    const details = screen.getByTestId('add-details-button');
    const done = screen.getByRole('button', { name: 'Done' });
    expect(details.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: /delete play/i })).toBeTruthy();
    expect(done.className).toMatch(/flex-none/);
  });

  it('still exposes the actions when details are expanded', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    expect(screen.getByRole('button', { name: /delete play/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it.each([
    ['portrait phone', 'portrait-strip', true],
    ['landscape phone', 'landscape-inline', true],
    ['tablet/desktop under-player strip', 'strip', false],
    ['mobile/tablet sheet', 'inline', true],
    ['desktop dock', 'overlay', false],
  ])('%s: exposes labeled Delete play and Done controls', (_name, layout, mobile) => {
    window.matchMedia = (query) => ({
      matches: mobile, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    });
    render(<AnnotateFullscreenOverlay {...baseProps} layout={layout} existingClip={bareClip} />);
    expect(screen.getByRole('button', { name: /delete play/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });
});

describe('highlight status', () => {
  it('shows Highlight made only after a project exists', () => {
    const { rerender } = render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    expect(screen.queryByTestId('highlight-made-chip')).toBeNull();
    rerender(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, autoProjectId: 42 }} />);
    expect(screen.getByTestId('highlight-made-chip')).toBeTruthy();
  });
});
