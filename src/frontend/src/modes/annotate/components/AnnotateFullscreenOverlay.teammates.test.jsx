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
  surface: 'dock_fullscreen',
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

// T7540: typing a teammate name and clicking Save WITHOUT pressing Enter first
// used to dead-end on an OK-only "Tag not submitted" dialog that never saved.
// Save now auto-commits the pending text (same as Enter) and proceeds — no dialog.
describe('AnnotateFullscreenOverlay — auto-commit pending teammate tag on Save (T7540)', () => {
  it('create mode: typed-but-not-Entered tag is included in the saved clip, no dialog', () => {
    const onCreateClip = vi.fn();
    const { container } = render(
      <AnnotateFullscreenOverlay {...baseProps} newClipLayerIsMine={false} onCreateClip={onCreateClip} />
    );
    // Type a teammate name but do NOT press Enter.
    fireEvent.change(screen.getByPlaceholderText('Tag a teammate...'), { target: { value: 'Alex' } });
    fireEvent.click(container.querySelector('button.bg-green-600'));

    expect(onCreateClip).toHaveBeenCalledTimes(1);
    expect(onCreateClip.mock.calls[0][0]).toMatchObject({ tagged_teammates: ['Alex'] });
    // The old dead-end dialog must never appear.
    expect(screen.queryByText('Tag not submitted')).toBeNull();
  });

  it('edit mode: pending tag is committed alongside existing tags on Update', () => {
    const onUpdateClip = vi.fn();
    const { container } = render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: false, tagged_teammates: ['Jake'] }}
        onUpdateClip={onUpdateClip}
      />
    );
    // Existing chip present; type a new name without pressing Enter. The teammate
    // input has an empty placeholder once chips exist, so target its unique class
    // (bg-transparent — the clip-name input is bg-gray-800).
    expect(screen.getByText('Jake')).toBeTruthy();
    fireEvent.change(container.querySelector('input.bg-transparent'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    expect(onUpdateClip).toHaveBeenCalledTimes(1);
    expect(onUpdateClip.mock.calls[0][1]).toMatchObject({ tagged_teammates: ['Jake', 'Alex'] });
    expect(screen.queryByText('Tag not submitted')).toBeNull();
  });
});

// T8600: the desktop strip (layout="strip") re-implements the controls row as
// separate markup from formBody (used by the overlay/inline layouts above),
// including its own clear-on-switch closure — so the T5725 invariant needs
// its own strip-scoped coverage rather than relying on the overlay-layout
// tests above to transitively exercise it.
describe('AnnotateFullscreenOverlay — Teammates in the desktop strip (T8600)', () => {
  // The strip's controls row places TeammateTagInput directly (no "Teammates"
  // label, per the ui spec's compact single-row layout) — assert via the
  // input's own placeholder and existing chips, not the formBody label text.
  it('SHOWS the teammate input + existing chips inline in the strip for a Team clip', () => {
    const { container } = render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        layout="strip"
        surface="inline_desktop"
        existingClip={{ id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: false, tagged_teammates: ['Alex'] }}
      />
    );
    // The input's placeholder is empty once a chip exists (see the T7540 tests
    // above) — assert its presence via the same unique class those tests use.
    expect(container.querySelector('input.bg-transparent')).toBeTruthy();
    expect(screen.getByText('Alex')).toBeTruthy();
  });

  it('switching the strip button-row Layer control to My Athlete hides teammates and clears tags on save', () => {
    const onUpdateClip = vi.fn();
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        layout="strip"
        surface="inline_desktop"
        existingClip={{ id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: false, tagged_teammates: ['Alex'] }}
        onUpdateClip={onUpdateClip}
      />
    );
    expect(screen.getByText('Alex')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'My Athlete layer' }));
    expect(screen.queryByPlaceholderText('Tag a teammate...')).toBeNull();
    expect(screen.queryByText('Alex')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(onUpdateClip.mock.calls[0][1]).toMatchObject({ my_athlete: true, tagged_teammates: [] });
  });
});
