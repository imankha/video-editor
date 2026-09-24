import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AnnotateTimeline } from './AnnotateTimeline';

// jsdom lacks ResizeObserver; ClipRegionLayer only uses it for mobile marker sizing.
beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function stubMatchMedia(mobile) {
  window.matchMedia = (query) => ({
    matches: mobile && query.includes('max-width'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

const baseProps = {
  currentTime: 0,
  duration: 100,
  regions: [],
  onSelectRegion: () => {},
};

const mockRect = (el) => {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: 0, width: 220, top: 0, height: 48, right: 220, bottom: 48, x: 0, y: 0, toJSON() {},
  });
};

// T11050: AnnotateTimeline must actually THREAD onSeek/onLayerSelect down to every
// ClipRegionLayer instance it renders (mobile single lane, desktop "mine" lane,
// desktop "team" lane) — dropping the prop on any one of them silently reintroduces
// the reported bug for that lane alone, invisible to ClipRegionLayer's own
// unit tests (which exercise the prop contract in isolation, not this wiring).
describe('AnnotateTimeline — threads onSeek/onLayerSelect into every clips lane (T11050)', () => {
  it('desktop: clicking empty space in the "mine" lane seeks and selects the clips layer', () => {
    stubMatchMedia(false);
    const onSeek = vi.fn();
    const onLayerSelect = vi.fn();
    render(<AnnotateTimeline {...baseProps} onSeek={onSeek} onLayerSelect={onLayerSelect} />);

    const track = within(screen.getByTestId('clip-lane-mine')).getByTestId('clip-track');
    mockRect(track);
    fireEvent.click(track, { clientX: 100 });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onLayerSelect).toHaveBeenCalledWith('clips');
  });

  it('desktop: clicking empty space in the "team" lane seeks and selects the clips layer', () => {
    stubMatchMedia(false);
    const onSeek = vi.fn();
    const onLayerSelect = vi.fn();
    render(<AnnotateTimeline {...baseProps} onSeek={onSeek} onLayerSelect={onLayerSelect} />);

    const track = within(screen.getByTestId('clip-lane-team')).getByTestId('clip-track');
    mockRect(track);
    fireEvent.click(track, { clientX: 100 });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onLayerSelect).toHaveBeenCalledWith('clips');
  });

  it('phone: clicking empty space in the single mobile track seeks and selects the clips layer', () => {
    stubMatchMedia(true);
    const onSeek = vi.fn();
    const onLayerSelect = vi.fn();
    render(<AnnotateTimeline {...baseProps} onSeek={onSeek} onLayerSelect={onLayerSelect} />);

    const track = within(screen.getByTestId('clip-track-mobile')).getByTestId('clip-track');
    mockRect(track);
    fireEvent.click(track, { clientX: 100 });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onLayerSelect).toHaveBeenCalledWith('clips');
  });
});
