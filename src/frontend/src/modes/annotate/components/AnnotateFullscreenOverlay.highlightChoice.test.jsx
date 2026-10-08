import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { ANNOTATE } from '../../../config/displayNames';

// T11130:
//  - H8 removed the editor's own stage buttons ("Frame this clip" / "Apply
//    Spotlight" / "View Final") and the first-clip "Keep marking plays"
//    invitation — the ONE surviving stage button lives on the main Annotate
//    screen (AnnotateModeView), not in this editor.
//  - Done on a Highlight-rated play not yet a highlight mode-swaps the edit strip
//    for the gold HighlightChoiceCard IN PLACE (showHighlightChoice). Escape is
//    the only no-save exit; there is no backdrop to click.

function mockViewport(matches) {
  window.matchMedia = (query) => ({
    matches, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
}

beforeEach(() => {
  mockViewport(false); // desktop strip
});
afterEach(() => {
  cleanup();
});

function baseProps(overrides = {}) {
  return {
    isVisible: true,
    currentTime: 30,
    videoDuration: 6000,
    onUpdateClip: vi.fn(() => Promise.resolve({ saveOk: true })),
    onClose: vi.fn(),
    onSeek: vi.fn(),
    videoController: {},
    onDeleteClip: vi.fn(),
    ...overrides,
  };
}

const editClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: 5, tags: [], my_athlete: true,
  name: 'My cool play', notes: '', tagged_teammates: [],
};

describe('AnnotateFullscreenOverlay — editor stage buttons removed (T11130 / H8)', () => {
  it('a made highlight (autoProjectId set) shows NO stage CTA and NO "Keep marking plays" in the editor', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps()}
        layout="strip"
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }}
      />
    );
    // The edit strip + Done are still there...
    expect(screen.getByTestId('annotate-editor-strip')).toBeTruthy();
    expect(screen.getByRole('button', { name: ANNOTATE.DONE })).toBeTruthy();
    // ...but the editor's own stage buttons / invitation are gone (H8).
    expect(screen.queryByRole('button', { name: 'Frame' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply Spotlight' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep marking plays' })).toBeNull();
  });
});

describe('AnnotateFullscreenOverlay — Done -> Highlight choice card (T11130)', () => {
  function renderCard(overrides = {}) {
    const onHighlightChoiceNow = vi.fn();
    const onHighlightChoiceLater = vi.fn();
    const onHighlightChoiceDismiss = vi.fn();
    render(
      <AnnotateFullscreenOverlay
        {...baseProps(overrides)}
        layout="strip"
        existingClip={{ ...editClip }}
        showHighlightChoice
        onHighlightChoiceNow={onHighlightChoiceNow}
        onHighlightChoiceLater={onHighlightChoiceLater}
        onHighlightChoiceDismiss={onHighlightChoiceDismiss}
      />
    );
    return { onHighlightChoiceNow, onHighlightChoiceLater, onHighlightChoiceDismiss };
  }

  it('mode-swaps the edit strip for the gold choice card with the exact owner copy', () => {
    renderCard();
    // The edit strip is gone; the card is in its place.
    expect(screen.queryByTestId('annotate-editor-strip')).toBeNull();
    const card = screen.getByTestId('highlight-choice-card');
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('Highlight');
    expect(card.textContent).toContain('Make this a highlight now?');
    expect(screen.getByTestId('highlight-choice-now').textContent).toContain('Make highlight');
    const later = screen.getByTestId('highlight-choice-later');
    expect(later.textContent).toContain('Keep Marking Plays');
    expect(later.textContent).toContain('Saves play in Clips so you can make your highlight later');
  });

  it('"Make highlight" calls the now handler', () => {
    const { onHighlightChoiceNow } = renderCard();
    fireEvent.click(screen.getByTestId('highlight-choice-now'));
    expect(onHighlightChoiceNow).toHaveBeenCalledTimes(1);
  });

  it('"Keep Marking Plays" calls the later handler', () => {
    const { onHighlightChoiceLater } = renderCard();
    fireEvent.click(screen.getByTestId('highlight-choice-later'));
    expect(onHighlightChoiceLater).toHaveBeenCalledTimes(1);
  });

  it('a local double-tap only fires one create (button disables after the first click)', () => {
    // Handler returns a pending promise so the card's local pending flag latches.
    let resolve;
    const onHighlightChoiceNow = vi.fn(() => new Promise((r) => { resolve = r; }));
    render(
      <AnnotateFullscreenOverlay
        {...baseProps()}
        layout="strip"
        existingClip={{ ...editClip }}
        showHighlightChoice
        onHighlightChoiceNow={onHighlightChoiceNow}
        onHighlightChoiceLater={vi.fn()}
        onHighlightChoiceDismiss={vi.fn()}
      />
    );
    const btn = screen.getByTestId('highlight-choice-now');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onHighlightChoiceNow).toHaveBeenCalledTimes(1);
    resolve?.({ saveOk: true, projectId: 9 });
  });

  it('Escape dismisses the card (returns to the editor) and never closes the editor', () => {
    const onClose = vi.fn();
    const { onHighlightChoiceDismiss } = renderCard({ onClose });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onHighlightChoiceDismiss).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the X close button dismisses like Escape and creates nothing', () => {
    const onClose = vi.fn();
    const { onHighlightChoiceNow, onHighlightChoiceLater, onHighlightChoiceDismiss } = renderCard({ onClose });
    fireEvent.click(screen.getByRole('button', { name: ANNOTATE.RATE_MODAL_CLOSE_LABEL }));
    expect(onHighlightChoiceDismiss).toHaveBeenCalledTimes(1);
    expect(onHighlightChoiceNow).not.toHaveBeenCalled();
    expect(onHighlightChoiceLater).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clicking the card area (no backdrop) does not dismiss', () => {
    const { onHighlightChoiceDismiss } = renderCard();
    fireEvent.click(screen.getByTestId('highlight-choice-card'));
    expect(onHighlightChoiceDismiss).not.toHaveBeenCalled();
  });
});
