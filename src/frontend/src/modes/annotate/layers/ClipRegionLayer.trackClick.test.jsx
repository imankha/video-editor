import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ClipRegionLayer from './ClipRegionLayer';

// jsdom lacks ResizeObserver; the component only uses it for mobile marker sizing.
beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// T11050: clicking empty track space in the Annotate clips lane used to do
// nothing at all — no competing gesture claims that space (unlike Focus/Overlay's
// crop/highlight tracks, which already add a keyframe on background click), so it
// silently ate the click. Fixed to seek the playhead there, mirroring the video
// track above it.
describe('ClipRegionLayer — click empty track space seeks (T11050)', () => {
  const mockRect = (el, { left, width }) => {
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left, width, top: 0, height: 48, right: left + width, bottom: 48, x: left, y: 0, toJSON() {},
    });
  };

  it('calls onSeek with the time at the clicked position, honoring edge padding', () => {
    const onSeek = vi.fn();
    render(
      <ClipRegionLayer
        regions={[]}
        duration={100}
        selectedRegionId={null}
        onSelectRegion={() => {}}
        edgePadding={20}
        onSeek={onSeek}
      />
    );
    const track = screen.getByTestId('clip-track');
    mockRect(track, { left: 0, width: 220 }); // usable width = 220 - 2*20 = 180
    fireEvent.click(track, { clientX: 20 + 90 }); // 90px into the usable 180px = 50%

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek.mock.calls[0][0]).toBeCloseTo(50, 5);
  });

  it('clamps a click before the left edge padding to time 0', () => {
    const onSeek = vi.fn();
    render(
      <ClipRegionLayer regions={[]} duration={100} selectedRegionId={null} onSelectRegion={() => {}} edgePadding={20} onSeek={onSeek} />
    );
    const track = screen.getByTestId('clip-track');
    mockRect(track, { left: 0, width: 220 });
    fireEvent.click(track, { clientX: 0 });

    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it('calls onLayerSelect when the empty track is clicked', () => {
    const onLayerSelect = vi.fn();
    render(
      <ClipRegionLayer regions={[]} duration={100} selectedRegionId={null} onSelectRegion={() => {}} onSeek={() => {}} onLayerSelect={onLayerSelect} />
    );
    const track = screen.getByTestId('clip-track');
    mockRect(track, { left: 0, width: 220 });
    fireEvent.click(track, { clientX: 100 });

    expect(onLayerSelect).toHaveBeenCalledTimes(1);
  });

  it('does NOT seek when clicking a clip marker — only the marker select fires', () => {
    const onSeek = vi.fn();
    const onSelectRegion = vi.fn();
    const regions = [{ id: 'a', startTime: 10, endTime: 20, rating: 4, my_athlete: true }];
    render(
      <ClipRegionLayer
        regions={regions}
        duration={100}
        selectedRegionId={null}
        onSelectRegion={onSelectRegion}
        onSeek={onSeek}
      />
    );
    const track = screen.getByTestId('clip-track');
    mockRect(track, { left: 0, width: 220 });
    fireEvent.click(track.querySelector('.clip-marker'));

    expect(onSelectRegion).toHaveBeenCalledWith('a');
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('does NOT seek when clicking a clip span bar — only the marker select fires', () => {
    const onSeek = vi.fn();
    const onSelectRegion = vi.fn();
    const regions = [{ id: 'a', startTime: 10, endTime: 20, rating: 4, my_athlete: true }];
    render(
      <ClipRegionLayer
        regions={regions}
        duration={100}
        selectedRegionId={null}
        onSelectRegion={onSelectRegion}
        onSeek={onSeek}
      />
    );
    const track = screen.getByTestId('clip-track');
    mockRect(track, { left: 0, width: 220 });
    fireEvent.click(screen.getByTestId('clip-span'));

    expect(onSelectRegion).toHaveBeenCalledWith('a');
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('is a no-op when onSeek is not provided (harnesses without a seek concept)', () => {
    render(
      <ClipRegionLayer regions={[]} duration={100} selectedRegionId={null} onSelectRegion={() => {}} />
    );
    const track = screen.getByTestId('clip-track');
    mockRect(track, { left: 0, width: 220 });
    expect(() => fireEvent.click(track, { clientX: 100 })).not.toThrow();
  });
});
