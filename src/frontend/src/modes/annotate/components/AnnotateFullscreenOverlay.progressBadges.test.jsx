import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { RATING_BACKGROUND_COLORS, RATING_BADGE_COLORS } from '../../../components/shared/clipConstants';
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

describe('rating shortcut and prominent separate rating input', () => {
  it.each([1, 2, 3, 4, 5])('uses the canonical color for rating %i', (rating) => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, rating }} />);
    const pill = screen.getByTestId('rating-pill');
    expect(pill.querySelector('svg').getAttribute('stroke')).toBe(RATING_BADGE_COLORS[rating]);
    expect(pill.style.backgroundColor).toBe(RATING_BACKGROUND_COLORS[rating]);
  });

  it('keeps the pill shortcut while making the star row a prominent rating control', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} onUpdateClip={onUpdateClip} />);
    fireEvent.click(screen.getByTestId('rating-pill'));
    expect(screen.getByTestId('rating-picker')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '4 stars - Good' }));
    expect(screen.getByTestId('rating-input')).toBeTruthy();
    fireEvent.click(screen.getByTitle('5 stars'));
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { rating: 5 });
  });

  it('keeps the badge, input, and details disclosure in that reading order', () => {
    const { container } = render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    order(container, ['trim-field-start', 'rating-pill', 'rating-input', 'add-details-button']);
  });

  for (const layout of ['inline', 'overlay', 'portrait-strip', 'landscape-inline']) {
    it(`${layout}: rating input precedes optional details`, () => {
      const { container } = render(<AnnotateFullscreenOverlay {...baseProps} layout={layout} existingClip={bareClip} />);
      order(container, ['rating-pill', 'rating-input', 'add-details-button']);
    });
  }

  it('details does not render another rating control', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    expect(screen.getAllByTestId('rating-input')).toHaveLength(1);
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
