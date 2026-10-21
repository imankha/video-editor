import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateTimeline } from './AnnotateTimeline';
import { deriveVideoSegments } from './footageLanding';

beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
});

const baseProps = {
  currentTime: 0,
  duration: 200,
  onSeek: () => {},
  regions: [],
  onSelectRegion: () => {},
};

const videoSegments = [
  { sequence: 1, name: 'first-half', virtualStart: 0, virtualEnd: 100 },
  { sequence: 2, name: 'second-half', virtualStart: 100, virtualEnd: 200 },
];

describe('T13280: per-video labels on the Annotate timeline', () => {
  it('deriveVideoSegments lists every video with name and prefix-sum start', () => {
    const segs = deriveVideoSegments([
      { sequence: 2, duration: 60, original_filename: 'half2.mp4' },
      { sequence: 1, duration: 100, original_filename: 'half1.mp4' },
    ]);
    expect(segs).toEqual([
      { sequence: 1, name: 'half1', virtualStart: 0, virtualEnd: 100 },
      { sequence: 2, name: 'half2', virtualStart: 100, virtualEnd: 160 },
    ]);
  });

  it('deriveVideoSegments is empty for a single-video game', () => {
    expect(deriveVideoSegments([{ sequence: 1, duration: 100 }])).toEqual([]);
    expect(deriveVideoSegments(null)).toEqual([]);
  });

  it('renders a labelled chip per video and tapping one seeks to its start', () => {
    const onSeek = vi.fn();
    render(<AnnotateTimeline {...baseProps} onSeek={onSeek} videoSegments={videoSegments} boundaryOffsets={[100]} />);
    expect(screen.getByTestId('video-label-1').textContent).toContain('first-half');
    const second = screen.getByTestId('video-label-2');
    expect(second.textContent).toContain('second-half');
    fireEvent.click(second);
    expect(onSeek).toHaveBeenCalledWith(100);
  });

  it('single-video games render no video labels (DOM identical to default)', () => {
    const a = render(<AnnotateTimeline {...baseProps} />);
    const html = a.container.innerHTML;
    a.unmount();
    const b = render(<AnnotateTimeline {...baseProps} videoSegments={[]} />);
    expect(b.container.innerHTML).toBe(html);
    expect(screen.queryByTestId('video-label-1')).toBeNull();
  });
});
