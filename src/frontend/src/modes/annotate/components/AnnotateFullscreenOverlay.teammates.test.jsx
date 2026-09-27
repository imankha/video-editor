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

// T5725: teammate tagging is Team-layer-only. The Teammates control renders
// ONLY when the clip's layer is Team, on desktop AND mobile. Switching the
// Layer control TO My Athlete clears the teammate tags in the SAME gesture
// (design doc § 2.2's row for the layer control).
//
// T11150 (Play editor hierarchy): the Play-category (Layer) control AND the
// Teammates control moved OFF the strip/formBody top level INTO the "Details"
// disclosure (H16). So every assertion below first OPENS Details
// (add-details-button) — desktop expands the panel in place, mobile opens the
// AddDetailsPopup — then reaches the control there. The layer-gating,
// per-gesture persistence (T10610) and clear-on-switch (T5725) behaviors are
// unchanged; only their UI location moved.
//
// T10610: there is no create mode. Every TeammateTagInput onChange calls
// onUpdateClip(existingClip.id, {tagged_teammates}) DIRECTLY. A half-typed,
// not-Enter-committed teammate name is lost on close (design doc § E row 13).

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
const openDetails = () => fireEvent.click(screen.getByTestId('add-details-button'));

describe('AnnotateFullscreenOverlay — Teammates control gating (T5725), inside Details (T11150)', () => {
  it('SHOWS teammates for a Team clip', () => {
    render(<AnnotateFullscreenOverlay {...baseProps({ existingClip: { ...baseClip, my_athlete: false, tagged_teammates: [] } })} />);
    openDetails();
    expect(screen.getByText(TEAMMATES_LABEL)).toBeTruthy();
  });

  it('HIDES teammates for a My Athlete clip (Details open, but the Team-only control is absent)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps({ existingClip: { ...baseClip, my_athlete: true, tagged_teammates: [] } })} />);
    openDetails();
    expect(screen.queryByText(TEAMMATES_LABEL)).toBeNull();
  });

  it('SHOWS teammates for a Team clip on MOBILE too (AddDetailsPopup; dropped the !isMobile gate)', () => {
    mockViewport(true);
    render(<AnnotateFullscreenOverlay {...baseProps({ existingClip: { ...baseClip, my_athlete: false, tagged_teammates: [] } })} layout="inline" />);
    openDetails();
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
    openDetails();
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
    openDetails();
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
    openDetails();
    // Team clip: control + existing chip are visible inside Details.
    expect(screen.getByText(TEAMMATES_LABEL)).toBeTruthy();
    expect(screen.getByText('Alex')).toBeTruthy();

    // Switch to My Athlete (the Layer control now lives in Details too): the
    // control (and its chip) disappear immediately, AND the gesture persists
    // my_athlete=true with cleared teammate tags — no separate Save step.
    fireEvent.click(screen.getByRole('radio', { name: 'My athlete' }));
    expect(screen.queryByText(TEAMMATES_LABEL)).toBeNull();
    expect(screen.queryByText('Alex')).toBeNull();
    expect(onUpdateClip).toHaveBeenCalledTimes(1);
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { my_athlete: true, tagged_teammates: [] });
  });
});

// T8600/T11150: the desktop strip (layout="strip") re-implements the Details
// panel as separate markup from formBody (used by the overlay/inline layouts
// above), including its own clear-on-switch closure — so the T5725 invariant
// needs its own strip-scoped coverage.
describe('AnnotateFullscreenOverlay — Teammates in the desktop strip Details (T8600/T11150)', () => {
  it('SHOWS the teammate input + existing chips in the strip Details for a Team clip', () => {
    const { container } = render(
      <AnnotateFullscreenOverlay
        {...baseProps({ existingClip: { ...baseClip, my_athlete: false, tagged_teammates: ['Alex'] } })}
        layout="strip"
      />
    );
    openDetails();
    // The input's placeholder is empty once a chip exists — assert presence
    // via its unique class instead.
    expect(container.querySelector('input.bg-transparent')).toBeTruthy();
    expect(screen.getByText('Alex')).toBeTruthy();
  });

  it('switching the strip Details Layer control to My Athlete hides teammates and persists cleared tags immediately', () => {
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
    openDetails();
    expect(screen.getByText('Alex')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'My athlete' }));
    expect(screen.queryByPlaceholderText('Tag a teammate...')).toBeNull();
    expect(screen.queryByText('Alex')).toBeNull();
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { my_athlete: true, tagged_teammates: [] });
  });
});
