import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { useProfileStore } from '../../../stores';

// T8140: originally covered one-tap create-mode defaults ("Play N" naming),
// the add_clip_opened_no_save abandonment beacon, and the mobile no-amber
// sport-picker rule.
//
// T10610: create-mode naming and the whole create/save lifecycle moved to
// AnnotateContainer (the container creates the play, named, before this
// component ever opens) — that coverage now lives at the container level
// (AnnotateContainer.createAtTap.test.jsx / markPlayDefaults), out of scope
// for this component's own tests. The add_clip_opened_no_save beacon and the
// `surface` prop are deleted entirely (design doc § E row 6) — its render-site
// coverage is replaced by a container/render-site inventory test, also out of
// scope here. What survives in THIS file: the mobile no-amber no_sport rule,
// which is genuine overlay behavior independent of create/edit mode.

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

const profileOriginal = useProfileStore.getState();

beforeEach(() => {
  mockViewport(false); // desktop by default
  useProfileStore.setState({
    profiles: [{ id: 'p1', sport: 'no_sport' }],
    currentProfileId: 'p1',
  });
});

afterEach(() => {
  useProfileStore.setState(profileOriginal, true);
});

const existingClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], name: 'Play 1',
  notes: '', tagged_teammates: [], my_athlete: true,
};

function baseProps(overrides = {}) {
  return {
    isVisible: true,
    currentTime: 30,
    videoDuration: 6000,
    existingClip,
    onUpdateClip: () => Promise.resolve({ saveOk: true }),
    onClose: () => {},
    onSeek: () => {},
    videoController: {},
    onDeleteClip: () => {},
    ...overrides,
  };
}

describe('AnnotateFullscreenOverlay — no amber no_sport wall on mobile (T8140)', () => {
  it('mobile no_sport form shows no amber "Pick your sport" prompt', () => {
    mockViewport(true);
    render(<AnnotateFullscreenOverlay {...baseProps()} layout="inline" />);
    // The amber picker is replaced by the full-screen question (fired
    // elsewhere), so it must not render in-form.
    expect(screen.queryByText('Pick your sport to tag this clip')).toBeNull();
  });

  it('desktop no_sport form keeps the in-form picker (T7922 preserved), inside details', () => {
    render(<AnnotateFullscreenOverlay {...baseProps()} layout="overlay" />);
    // T9830/T10580: the sport prompt is an optional detail behind the
    // disclosure, which defaults CLOSED on every layout — hidden until
    // opened, hidden again when collapsed.
    expect(screen.queryByText('Pick your sport to tag this clip')).toBeNull();
    fireEvent.click(screen.getByTestId('add-details-button'));
    expect(screen.getByText('Pick your sport to tag this clip')).toBeTruthy();
    fireEvent.click(screen.getByTestId('add-details-button'));
    expect(screen.queryByText('Pick your sport to tag this clip')).toBeNull();
  });
});
