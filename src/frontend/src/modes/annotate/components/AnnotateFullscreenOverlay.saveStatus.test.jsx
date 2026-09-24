import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

// T10610 § C.5: there is no more local saveStatus derived from a Save-button
// click. The `writeStatus` PROP (owned by AnnotateContainer, reflecting the
// per-gesture write chain's outcome) drives SaveStatusBadge directly.
// 'unsaved' is retired entirely — nothing is ever "unsaved" once every
// control autosaves on its own gesture (SAVE_STATUS_COPY.unsaved is deleted
// from the component). Replaces .explicitOutcomes.test.jsx's save-status
// coverage per design doc § E row 3.
//
// The strip layout (desktop under-canvas editor) dropped the SaveStatusBadge
// row entirely — every control there already autosaves on its own gesture,
// so a lingering "Saved" confirmation was redundant. The formBody
// (overlay/inline) layouts keep the badge.

function mockViewport(matches) {
  window.matchMedia = (query) => ({
    matches, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
}

const existingClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: true, name: 'My banger', notes: '',
};

const baseProps = {
  isVisible: true,
  currentTime: 30,
  videoDuration: 6000,
  existingClip,
  onUpdateClip: () => Promise.resolve({ saveOk: true }),
  onClose: () => {},
  onSeek: () => {},
  videoController: {},
  onDeleteClip: () => {},
  onAwaitWrites: () => Promise.resolve(true),
};

describe('AnnotateFullscreenOverlay — SaveStatusBadge driven by the writeStatus prop (T10610 § C.5)', () => {
  it('the strip layout never renders a status badge, for any writeStatus', () => {
    mockViewport(false);
    for (const writeStatus of ['idle', 'saving', 'saved', 'error']) {
      const { unmount } = render(
        <AnnotateFullscreenOverlay {...baseProps} layout="strip" writeStatus={writeStatus} />
      );
      expect(screen.queryByTestId('save-status')).toBeNull();
      unmount();
    }
  });

  it('idle (default) renders no status badge on the formBody (overlay) layout', () => {
    mockViewport(false);
    render(<AnnotateFullscreenOverlay {...baseProps} layout="overlay" />);
    expect(screen.queryByTestId('save-status')).toBeNull();
  });

  it('saving renders "Saving..." on the formBody (overlay) layout', () => {
    mockViewport(false);
    render(<AnnotateFullscreenOverlay {...baseProps} layout="overlay" writeStatus="saving" />);
    expect(screen.getByTestId('save-status').textContent).toBe('Saving...');
  });

  it('saved renders "Saved" on the formBody (overlay) layout', () => {
    mockViewport(false);
    render(<AnnotateFullscreenOverlay {...baseProps} layout="overlay" writeStatus="saved" />);
    expect(screen.getByTestId('save-status').textContent).toBe('Saved');
  });

  it('error renders the failure copy on the formBody (overlay) layout', () => {
    mockViewport(false);
    render(<AnnotateFullscreenOverlay {...baseProps} layout="overlay" writeStatus="error" />);
    expect(screen.getByTestId('save-status').textContent).toMatch(/couldn't save/i);
  });

  it('never renders "Unsaved changes" — the whole concept is retired', () => {
    mockViewport(false);
    for (const writeStatus of ['idle', 'saving', 'saved', 'error']) {
      const { unmount } = render(
        <AnnotateFullscreenOverlay {...baseProps} layout="overlay" writeStatus={writeStatus} />
      );
      expect(screen.queryByText('Unsaved changes')).toBeNull();
      unmount();
    }
  });
});
