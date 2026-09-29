import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { useProjectsStore } from '../../../stores/projectsStore';

// T11150 (Play editor hierarchy epic): the old T10410 play-progress badges
// row (named/rated/noted/clip) is retired. This suite pins the replacement
// contract: a RatingPill (normal pill, no "Required"/amber-dashed treatment,
// with chess notation), a stage-specific status chip, and the top-to-bottom order
// (time -> name+rating -> Details) across every layout.

beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
});

afterEach(() => {
  cleanup();
  useProjectsStore.setState({ projects: [] });
});

const baseProps = {
  isVisible: true,
  currentTime: 30,
  videoDuration: 6000,
  onUpdateClip: () => Promise.resolve({ saveOk: true }),
  onClose: () => {},
  onSeek: () => {},
  videoController: {},
  onDeleteClip: () => {},
  onAwaitWrites: () => Promise.resolve(true),
};

const bareClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: ['Goal'], my_athlete: true,
  name: 'Good Goal', hasCustomName: false, notes: '', autoProjectId: null,
};

describe('old progress-badges row is gone (T11150)', () => {
  for (const layout of ['strip', 'inline']) {
    it(`${layout}: play-progress-badges / badge-clip / badge-named / badge-noted no longer render`, () => {
      render(<AnnotateFullscreenOverlay {...baseProps} layout={layout} existingClip={bareClip} />);
      expect(screen.queryByTestId('play-progress-badges')).toBeNull();
      expect(screen.queryByTestId('badge-clip')).toBeNull();
      expect(screen.queryByTestId('badge-named')).toBeNull();
      expect(screen.queryByTestId('badge-noted')).toBeNull();
      expect(screen.queryByTestId('badge-rated')).toBeNull();
      expect(screen.queryByText('Clip created')).toBeNull();
    });
  }
});

describe('RatingPill — unrated state (no "Required", no amber-dashed to-do)', () => {
  it('renders "Rate this play" with a neutral (non-amber) pill', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, rating: null }} />);
    const pill = screen.getByTestId('rating-pill');
    expect(pill.dataset.state).toBe('unrated');
    expect(pill.textContent).toContain('Rate this play');
    expect(pill.textContent).not.toMatch(/Required/i);
    expect(pill.className).not.toMatch(/dashed/);
    expect(pill.className).not.toMatch(/amber/);
  });

  it('opening the picker shows 5 rows best-first, with meanings and no chess notation', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, rating: null }} />);
    fireEvent.click(screen.getByTestId('rating-pill'));
    const group = screen.getByRole('radiogroup', { name: "Rate your athlete's play" });
    const options = within(group).getAllByRole('radio');
    expect(options.map((o) => o.getAttribute('aria-label'))).toEqual([
      '5 stars - Highlight', '4 stars - Good', '3 stars - Interesting',
      '2 stars - Technical Lapse', '1 star - Mental Lapse',
    ]);
    const pickerText = screen.getByTestId('rating-picker').textContent;
    // T11120: the picker now renders the shared meanings list, so each row
    // carries a one-line meaning (owner copy). Highlight's approved line is
    // "Brilliant Play! Everyone should see it." — that '!' is prose punctuation,
    // NOT the chess glyph. So the bare '!'/'?' single-char forms can no longer be
    // asserted absent here; the multi-char chess-notation forms (and the bare '?'
    // of rating 2, which no meaning contains) still must be.
    expect(pickerText).toContain('Brilliant Play! Everyone should see it.');
    for (const glyph of ['??', '!?', '!!', '?']) {
      expect(pickerText).not.toContain(glyph);
    }
  });
});

describe('RatingPill — rated state', () => {
  it('shows the rating adjective and its chess glyph once a rating is set', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, rating: 4 }} />);
    const pill = screen.getByTestId('rating-pill');
    expect(pill.dataset.state).toBe('rated');
    expect(pill.dataset.rating).toBe('4');
    expect(pill.textContent).toContain('Good');
    expect(pill.textContent).toContain('!');
  });

  it('picking a star sets the rating and closes the popup', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, rating: null }} />);
    fireEvent.click(screen.getByTestId('rating-pill'));
    fireEvent.click(screen.getByRole('radio', { name: '5 stars - Highlight' }));
    const pill = screen.getByTestId('rating-pill');
    expect(pill.dataset.state).toBe('rated');
    expect(pill.dataset.rating).toBe('5');
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('a 5-star rating gets the gold pill treatment', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, rating: 5 }} />);
    const pill = screen.getByTestId('rating-pill');
    expect(pill.className).toMatch(/F5B700/);
  });

  it('a non-5-star rating does NOT get the gold treatment', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, rating: 3 }} />);
    const pill = screen.getByTestId('rating-pill');
    expect(pill.className).not.toMatch(/F5B700/);
  });

  it('the popup heading is layer-aware: "your athlete\'s" vs "your team\'s"', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, my_athlete: true }} />);
    fireEvent.click(screen.getByTestId('rating-pill'));
    expect(screen.getByRole('radiogroup', { name: "Rate your athlete's play" })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '5 stars - Highlight' }));

    fireEvent.click(screen.getByTestId('add-details-button'));
    fireEvent.click(screen.getByRole('radio', { name: 'Team' })); // flip the layer toggle
    fireEvent.click(screen.getByTestId('rating-pill'));
    expect(screen.getByRole('radiogroup', { name: "Rate your team's play" })).toBeTruthy();
  });

  it('T10590 (preserved): a REAL clip switch closes the popup rather than silently relabeling it', () => {
    const { rerender } = render(
      <AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, my_athlete: true }} />,
    );
    fireEvent.click(screen.getByTestId('rating-pill'));
    expect(screen.getByRole('radiogroup', { name: "Rate your athlete's play" })).toBeTruthy();

    rerender(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, id: 'c2', my_athlete: false }} />);
    expect(screen.queryByTestId('rating-picker')).toBeNull();
  });

  it('an outside click (desktop) closes the popup', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    fireEvent.click(screen.getByTestId('rating-pill'));
    expect(screen.getByRole('radiogroup', { name: "Rate your athlete's play" })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('radiogroup', { name: "Rate your athlete's play" })).toBeNull();
  });

  it('Escape closes the picker WITHOUT closing the whole editor (T10590 landmine, stopPropagation)', () => {
    // The picker's Escape handler lives on `document`; the editor's lives on
    // `window`. Without stopPropagation, a single Escape would close BOTH —
    // discarding the play. Dispatch from `document` (jsdom skips
    // document-level listeners when firing on `window`, so this is the only
    // dispatch that reproduces the double-handling bug), assert onClose is NOT
    // called.
    const onClose = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} onClose={onClose} layout="strip" existingClip={bareClip} />);
    fireEvent.click(screen.getByTestId('rating-pill'));
    expect(screen.getByRole('radiogroup', { name: "Rate your athlete's play" })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('radiogroup', { name: "Rate your athlete's play" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  describe('mobile bottom sheet', () => {
    beforeEach(() => {
      window.matchMedia = (query) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      });
    });

    it('the X closes the sheet; tapping the dimmed backdrop does not', () => {
      render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
      fireEvent.click(screen.getByTestId('rating-pill'));
      const group = screen.getByRole('radiogroup', { name: "Rate your athlete's play" });
      expect(group).toBeTruthy();
      const backdrop = screen.getByRole('presentation');
      fireEvent.click(backdrop);
      expect(screen.queryByRole('radiogroup', { name: "Rate your athlete's play" })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('radiogroup', { name: "Rate your athlete's play" })).toBeNull();
    });
  });

  it('the rating pill stays clickable once rated, so the rating can be set again and again', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, rating: 5 }} />);
    expect(screen.getByTestId('rating-pill').dataset.state).toBe('rated');
    fireEvent.click(screen.getByTestId('rating-pill'));
    fireEvent.click(screen.getByRole('radio', { name: '2 stars - Technical Lapse' }));
    expect(screen.getByTestId('rating-pill').dataset.rating).toBe('2');
    fireEvent.click(screen.getByTestId('rating-pill'));
    expect(screen.getByRole('radio', { name: '2 stars - Technical Lapse' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: '4 stars - Good' }));
    expect(screen.getByTestId('rating-pill').dataset.rating).toBe('4');
  });

  it('DetailsFields no longer carries its own duplicate Rating row (the pill is the only rating control)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    expect(screen.getByLabelText('Notes (optional)')).toBeTruthy();
    expect(screen.queryByText(/^Rating/)).toBeNull();
  });
});

describe('highlight status chip', () => {
  it('shows Clipped when a project exists but framing has not completed', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, rating: 5, autoProjectId: 42 }} />);
    expect(screen.getByTestId('highlight-made-chip')).toBeTruthy();
    expect(screen.getByText('Clipped')).toBeTruthy();
  });

  it('shows Not Started before a highlight project exists', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, rating: 5, autoProjectId: null }} />);
    expect(screen.getByTestId('highlight-made-chip')).toBeTruthy();
    expect(screen.getByText('Not Started')).toBeTruthy();
  });

  it('shows a progressed status even when the play is rated below Highlight', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, rating: 4, autoProjectId: 42 }} />);
    expect(screen.getByText('Clipped')).toBeTruthy();
  });

  it('hides Not Started when the play is rated below Highlight', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, rating: 4, autoProjectId: null }} />);
    expect(screen.queryByTestId('highlight-made-chip')).toBeNull();
  });

  it('shows Framing while the highlight export is pending', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        layout="strip"
        framingInProgress
        existingClip={{ ...bareClip, rating: 5, autoProjectId: 42 }}
      />,
    );
    expect(screen.getByText('Framing')).toBeTruthy();
  });

  it.each([
    ['Framed', { has_working_video: true, has_final_video: false, is_published: false }],
    ['Overlaid', { has_working_video: true, has_final_video: true, is_published: false }],
    ['Published', { has_working_video: true, has_final_video: true, is_published: true }],
  ])('shows %s from the linked highlight project state', (label, projectState) => {
    useProjectsStore.setState({ projects: [{ id: 42, ...projectState }] });
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        layout="strip"
        existingClip={{ ...bareClip, rating: 4, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }}
      />,
    );
    expect(screen.getByText(label)).toBeTruthy();
  });
});

describe('DOM order — time precedes name+rating precedes Details (per layout)', () => {
  const order = (container, testids) => {
    const nodes = testids.map((id) => container.querySelector(`[data-testid="${id}"]`) || container.querySelector(`[aria-label="${id}"]`));
    for (let i = 0; i < nodes.length - 1; i += 1) {
      expect(nodes[i]).toBeTruthy();
      expect(nodes[i + 1]).toBeTruthy();
      // Node A precedes Node B in document order.
      expect(nodes[i].compareDocumentPosition(nodes[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  };

  it('strip: scrub region precedes rating pill precedes the Details button', () => {
    const { container } = render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    order(container, ['trim-field-start', 'rating-pill', 'add-details-button']);
  });

  it('portrait-strip: scrub region precedes rating pill precedes the Details button', () => {
    window.matchMedia = (query) => ({
      matches: true, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    });
    const { container } = render(<AnnotateFullscreenOverlay {...baseProps} layout="portrait-strip" existingClip={bareClip} />);
    order(container, ['trim-field-start', 'rating-pill', 'add-details-button']);
  });

  it('inline: scrub region precedes rating pill precedes the Details button', () => {
    window.matchMedia = (query) => ({
      matches: true, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    });
    const { container } = render(<AnnotateFullscreenOverlay {...baseProps} layout="inline" existingClip={bareClip} />);
    order(container, ['trim-field-start', 'rating-pill', 'add-details-button']);
  });

  it('overlay: scrub region precedes rating pill precedes the Details button', () => {
    const { container } = render(<AnnotateFullscreenOverlay {...baseProps} layout="overlay" existingClip={bareClip} />);
    order(container, ['trim-field-start', 'rating-pill', 'add-details-button']);
  });

  it('landscape-inline: time -> name field -> rating pill -> Details; tags/notes absent while Details closed', () => {
    window.matchMedia = (query) => ({
      matches: true, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    });
    const { container } = render(<AnnotateFullscreenOverlay {...baseProps} layout="landscape-inline" existingClip={bareClip} />);
    // The name input (aria-label "Play name") sits on the name+rating tier,
    // after time and before the rating pill / Details button.
    order(container, ['trim-field-start', 'Play name', 'rating-pill', 'add-details-button']);
    // Tags and Notes live ONLY behind Details — nothing rendered while closed.
    expect(screen.queryByText('Notes (optional)')).toBeNull();
    expect(screen.queryByText('Tags')).toBeNull();
    expect(screen.queryByPlaceholderText('Add a note about this play...')).toBeNull();
  });
});

describe('no user-visible "clip" wording remains in the editor (T11150)', () => {
  const assertNoClipWord = (container) => {
    // Check what a screen reader / eyeball would actually see: visible text
    // nodes AND the user-facing attributes (title tooltips, aria-labels,
    // placeholders). Internal-only attributes (data-testid, class, id/htmlFor
    // like `clip-notes`, data-add-clip-form) are NOT user-visible, so they are
    // deliberately excluded — only title/aria-label/placeholder are read.
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const seen = [];
    let node = walker.nextNode();
    while (node) {
      if (node.textContent.trim()) seen.push(node.textContent);
      node = walker.nextNode();
    }
    const scope = container === document.body ? container : container;
    scope.querySelectorAll('[title], [aria-label], [placeholder]').forEach((el) => {
      for (const attr of ['title', 'aria-label', 'placeholder']) {
        const v = el.getAttribute(attr);
        if (v) seen.push(v);
      }
    });
    // "Clipped" is now an intentional workflow state; keep rejecting the old
    // standalone Clip/Clips product wording without rejecting that phase name.
    expect(seen.join(' | ')).not.toMatch(/\bclips?\b/i);
  };

  it('strip layout (Details open)', () => {
    const { container } = render(
      <AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, autoProjectId: 42 }} />,
    );
    fireEvent.click(screen.getByTestId('add-details-button'));
    assertNoClipWord(container);
  });

  it('portrait-strip layout (Details open)', () => {
    window.matchMedia = (query) => ({
      matches: true, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    });
    render(<AnnotateFullscreenOverlay {...baseProps} layout="portrait-strip" existingClip={{ ...bareClip, autoProjectId: 42 }} />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    // The portrait-strip popup is portaled to document.body.
    assertNoClipWord(document.body);
  });

  it('inline layout (Details open)', () => {
    window.matchMedia = (query) => ({
      matches: true, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    });
    render(<AnnotateFullscreenOverlay {...baseProps} layout="inline" existingClip={{ ...bareClip, autoProjectId: 42 }} />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    assertNoClipWord(document.body);
  });

  it('overlay layout (Details open)', () => {
    const { container } = render(
      <AnnotateFullscreenOverlay {...baseProps} layout="overlay" existingClip={{ ...bareClip, autoProjectId: 42 }} />,
    );
    fireEvent.click(screen.getByTestId('add-details-button'));
    assertNoClipWord(container);
  });

  it('landscape-inline layout (Details open) — text AND title/aria-label/placeholder', () => {
    window.matchMedia = (query) => ({
      matches: true, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    });
    render(<AnnotateFullscreenOverlay {...baseProps} layout="landscape-inline" existingClip={{ ...bareClip, autoProjectId: 42 }} />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    // AddDetailsPopup is portaled to document.body.
    assertNoClipWord(document.body);
  });
});

describe('same-play identity churn keeps unsaved edits', () => {
  it('re-rendering with a new object for the same clip id preserves the 5-star edit and typed name', () => {
    const { rerender } = render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    fireEvent.click(screen.getByTestId('rating-pill'));
    fireEvent.click(screen.getByRole('radio', { name: '5 stars - Highlight' }));
    fireEvent.click(screen.getByTitle('Rename play'));
    fireEvent.change(screen.getByLabelText('Play name'), { target: { value: 'Banger' } });

    rerender(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, autoProjectId: 42 }} />);
    expect(screen.getByTestId('highlight-made-chip')).toBeTruthy();
    expect(screen.getByTestId('rating-pill').dataset.rating).toBe('5');
    expect(screen.getByLabelText('Play name').value).toBe('Banger');
  });

  it('a DIFFERENT clip id still resets the form', () => {
    const { rerender } = render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    fireEvent.click(screen.getByTestId('rating-pill'));
    fireEvent.click(screen.getByRole('radio', { name: '5 stars - Highlight' }));
    rerender(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, id: 'c2', rating: 3 }} />);
    fireEvent.click(screen.getByTestId('rating-pill'));
    expect(screen.getByRole('radio', { name: '3 stars - Interesting' }).getAttribute('aria-checked')).toBe('true');
  });
});
