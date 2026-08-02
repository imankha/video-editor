import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

// jsdom lacks matchMedia; the overlay renders through the real useIsMobile hook.
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

// T5725: teammate tagging is Team-layer-only. The Teammates control in the
// add/edit overlay renders ONLY when the clip's layer is Team, on desktop AND
// mobile. Switching the Layer control TO My Athlete clears the in-progress
// teammate tags (persisted on Save), so a My Athlete clip is never saved with
// teammate tags.
const baseProps = {
  isVisible: true,
  currentTime: 30,
  videoDuration: 6000,
  onCreateClip: () => {},
  onUpdateClip: () => {},
  onResume: () => {},
  onClose: () => {},
  onSeek: () => {},
  videoController: {},
};

const TEAMMATES_LABEL = 'Teammates';

describe('AnnotateFullscreenOverlay — Teammates control gating (T5725)', () => {
  it('create mode with a Team default (newClipLayerIsMine=false) SHOWS teammates', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} newClipLayerIsMine={false} />);
    expect(screen.getByText(TEAMMATES_LABEL)).toBeTruthy();
  });

  it('create mode with a My Athlete default (newClipLayerIsMine=true) HIDES teammates', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} newClipLayerIsMine={true} />);
    expect(screen.queryByText(TEAMMATES_LABEL)).toBeNull();
  });

  it('edit mode SHOWS teammates for a Team clip', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: false }}
      />
    );
    expect(screen.getByText(TEAMMATES_LABEL)).toBeTruthy();
  });

  it('edit mode HIDES teammates for a My Athlete clip', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: true }}
      />
    );
    expect(screen.queryByText(TEAMMATES_LABEL)).toBeNull();
  });

  it('SHOWS teammates for a Team clip on MOBILE too (dropped the !isMobile gate)', () => {
    mockViewport(true);
    render(<AnnotateFullscreenOverlay {...baseProps} newClipLayerIsMine={false} />);
    expect(screen.getByText(TEAMMATES_LABEL)).toBeTruthy();
  });
});

describe('AnnotateFullscreenOverlay — clear-on-switch to My Athlete (T5725)', () => {
  it('editing a tagged Team clip, switching TO My Athlete hides the control and saves with cleared tags', () => {
    const onUpdateClip = vi.fn();
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: false, tagged_teammates: ['Alex'] }}
        onUpdateClip={onUpdateClip}
      />
    );
    // Team clip: control + existing chip are visible.
    expect(screen.getByText(TEAMMATES_LABEL)).toBeTruthy();
    expect(screen.getByText('Alex')).toBeTruthy();

    // Switch to My Athlete: the control (and its chip) disappear immediately.
    fireEvent.click(screen.getByRole('radio', { name: 'My Athlete layer' }));
    expect(screen.queryByText(TEAMMATES_LABEL)).toBeNull();
    expect(screen.queryByText('Alex')).toBeNull();

    // Save persists my_athlete=true with cleared teammate tags.
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(onUpdateClip).toHaveBeenCalledTimes(1);
    expect(onUpdateClip.mock.calls[0][1]).toMatchObject({ my_athlete: true, tagged_teammates: [] });
  });

  it('a new My Athlete clip is created with empty teammate tags', () => {
    const onCreateClip = vi.fn();
    const { container } = render(
      <AnnotateFullscreenOverlay {...baseProps} newClipLayerIsMine={true} onCreateClip={onCreateClip} />
    );
    // The Save submit button shares the label "Save" with a position tag pill;
    // scope to the submit button's own class (same approach as the layer spec).
    fireEvent.click(container.querySelector('button.bg-green-600'));
    expect(onCreateClip).toHaveBeenCalledTimes(1);
    expect(onCreateClip.mock.calls[0][0]).toMatchObject({ my_athlete: true, tagged_teammates: [] });
  });
});
