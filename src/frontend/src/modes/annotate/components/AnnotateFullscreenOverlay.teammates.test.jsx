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
// edit overlay renders ONLY when the clip's layer is Team, on desktop AND
// mobile. Switching the Layer control TO My Athlete clears the teammate tags
// in the SAME gesture (design doc § 2.2's row for the layer control).
//
// T10610: there is no create mode (newClipLayerIsMine is retired). Every
// TeammateTagInput onChange now calls onUpdateClip(existingClip.id,
// {tagged_teammates}) DIRECTLY — not through a Save-gesture commit. The old
// "auto-commit pending teammate text on Save" behavior (T7540) is GONE: there
// is no save gesture left to hang it off. A half-typed, not-Enter-committed
// teammate name is lost on close, same as any other field requiring its own
// explicit commit (design doc § E row 13 — a known, accepted behavior
// change, not preserved here).

const baseClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], name: 'Play 1', notes: '',
};

function baseProps(overrides = {}) {
  return {
    isVisible: true,
    currentTime: 30,
    videoDuration: 6000,
    existingClip: baseClip,
    onUpdateClip: vi.fn(() => Promise.resolve({ saveOk: true })),
    onClose: () => {},
    onSeek: () => {},
    videoController: {},
    onDeleteClip: () => {},
    ...overrides,
  };
}

const TEAMMATES_LABEL = 'Teammates';

describe('AnnotateFullscreenOverlay — Teammates control gating (T5725)', () => {
  it('SHOWS teammates for a Team clip', () => {
    render(<AnnotateFullscreenOverlay {...baseProps({ existingClip: { ...baseClip, my_athlete: false, tagged_teammates: [] } })} />);
    expect(screen.getByText(TEAMMATES_LABEL)).toBeTruthy();
  });

  it('HIDES teammates for a My Athlete clip', () => {
    render(<AnnotateFullscreenOverlay {...baseProps({ existingClip: { ...baseClip, my_athlete: true, tagged_teammates: [] } })} />);
    expect(screen.queryByText(TEAMMATES_LABEL)).toBeNull();
  });

  it('SHOWS teammates for a Team clip on MOBILE too (dropped the !isMobile gate)', () => {
    mockViewport(true);
    render(<AnnotateFullscreenOverlay {...baseProps({ existingClip: { ...baseClip, my_athlete: false, tagged_teammates: [] } })} layout="inline" />);
    expect(screen.getByText(TEAMMATES_LABEL)).toBeTruthy();
  });
});

describe('AnnotateFullscreenOverlay — teammate commit is direct, per-gesture (T10610)', () => {
  it('adding a teammate (Enter) persists the full array via onUpdateClip directly', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(
      <AnnotateFullscreenOverlay
        {...baseProps({ onUpdateClip, existingClip: { ...baseClip, my_athlete: false, tagged_teammates: [] } })}
      />
    );
    const input = screen.getByPlaceholderText('Tag a teammate...');
    fireEvent.change(input, { target: { value: 'Alex' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { tagged_teammates: ['Alex'] });
  });

  it('a typed-but-not-Entered teammate name is NOT committed (no auto-commit-on-close mechanism anymore)', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(
      <AnnotateFullscreenOverlay
        {...baseProps({ onUpdateClip, existingClip: { ...baseClip, my_athlete: false, tagged_teammates: [] } })}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('Tag a teammate...'), { target: { value: 'Alex' } });
    expect(onUpdateClip).not.toHaveBeenCalled();
  });
});

describe('AnnotateFullscreenOverlay — clear-on-switch to My Athlete (T5725)', () => {
  it('editing a tagged Team clip, switching TO My Athlete hides the control and persists cleared tags immediately', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(
      <AnnotateFullscreenOverlay
        {...baseProps({
          onUpdateClip,
          existingClip: { ...baseClip, my_athlete: false, tagged_teammates: ['Alex'] },
        })}
      />
    );
    // Team clip: control + existing chip are visible.
    expect(screen.getByText(TEAMMATES_LABEL)).toBeTruthy();
    expect(screen.getByText('Alex')).toBeTruthy();

    // Switch to My Athlete: the control (and its chip) disappear immediately,
    // AND the gesture persists my_athlete=true with cleared teammate tags —
    // no separate Save step.
    fireEvent.click(screen.getByRole('radio', { name: 'My athlete' }));
    expect(screen.queryByText(TEAMMATES_LABEL)).toBeNull();
    expect(screen.queryByText('Alex')).toBeNull();
    expect(onUpdateClip).toHaveBeenCalledTimes(1);
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { my_athlete: true, tagged_teammates: [] });
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
        {...baseProps({ existingClip: { ...baseClip, my_athlete: false, tagged_teammates: ['Alex'] } })}
        layout="strip"
      />
    );
    // The input's placeholder is empty once a chip exists — assert presence
    // via its unique class instead.
    expect(container.querySelector('input.bg-transparent')).toBeTruthy();
    expect(screen.getByText('Alex')).toBeTruthy();
  });

  it('switching the strip button-row Layer control to My Athlete hides teammates and persists cleared tags immediately', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(
      <AnnotateFullscreenOverlay
        {...baseProps({
          onUpdateClip,
          existingClip: { ...baseClip, my_athlete: false, tagged_teammates: ['Alex'] },
        })}
        layout="strip"
      />
    );
    expect(screen.getByText('Alex')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'My athlete' }));
    expect(screen.queryByPlaceholderText('Tag a teammate...')).toBeNull();
    expect(screen.queryByText('Alex')).toBeNull();
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { my_athlete: true, tagged_teammates: [] });
  });
});
