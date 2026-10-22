import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VideoLane, { MIN_BLOCK_PX } from './VideoLane';
import { AnnotateTimeline } from './AnnotateTimeline';

// jsdom has no layout; capture the ResizeObserver callback so a test can feed a width.
let roCallback = null;
beforeEach(() => {
  roCallback = null;
  global.ResizeObserver = class {
    constructor(cb) { roCallback = cb; }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
function stubMatchMedia(mobile) {
  window.matchMedia = (query) => ({
    matches: mobile, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
}

// The measured user game: 18.84s then 85 minutes appended at 0:18.
const videos = [
  { sequence: 1, name: 'IMG_4412', kind: 'main', virtualStart: 0, virtualEnd: 18.84, placedAtEnd: false },
  { sequence: 2, name: 'oct-5-2…-10-05', kind: 'main', virtualStart: 18.84, virtualEnd: 5135.7, placedAtEnd: true },
];
const duration = 5135.7;

describe('VideoLane (T13280)', () => {
  it('renders a block per video, marks the active one, and tapping picks it', () => {
    const onPick = vi.fn();
    render(<VideoLane videos={videos} activeSequence={2} duration={duration} onPick={onPick} />);
    expect(screen.getByTestId('video-block-1').textContent).toContain('IMG_4412');
    expect(screen.getByTestId('video-block-2').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('video-block-2').getAttribute('title')).toMatch(/added at the end/i);
    fireEvent.click(screen.getByTestId('video-block-1'));
    expect(onPick).toHaveBeenCalledWith(1);
  });

  it('a 19s video next to an 85 minute one is still at least MIN_BLOCK_PX wide and does not overlap its neighbour', () => {
    const { act } = require('@testing-library/react');
    render(<VideoLane videos={videos} activeSequence={2} duration={duration} />);
    act(() => { roCallback([{ contentRect: { width: 1000 } }]); });
    const b1 = screen.getByTestId('video-block-1');
    const b2 = screen.getByTestId('video-block-2');
    const w1 = parseFloat(b1.style.width);
    const l1 = parseFloat(b1.style.left);
    const l2 = parseFloat(b2.style.left);
    expect(w1).toBeGreaterThanOrEqual(MIN_BLOCK_PX);           // was ~3.7px proportionally
    expect(l2).toBeGreaterThanOrEqual(l1 + w1);                 // pushed right of block 1
    expect(l2 + parseFloat(b2.style.width)).toBeLessThanOrEqual(1000 + 0.01);
  });

  // T13280 follow-up (2026-10-22, user: "user should be able to drag the video to
  // different spots on the timeline"): the fix-target block becomes draggable
  // (same mechanism AngleLanes' drag-in-mode uses); every other block ignores the
  // same pointer sequence, and click-to-pick is suppressed on the fix target.
  it('reports a pixel delta as seconds via onFixDragTo only for the fix-target block', () => {
    const { act } = require('@testing-library/react');
    const onFixDragTo = vi.fn();
    const onPick = vi.fn();
    render(<VideoLane videos={videos} activeSequence={2} duration={duration} onPick={onPick} fixSequence={2} fixPendingOffset={18.84} onFixDragTo={onFixDragTo} />);
    act(() => { roCallback([{ contentRect: { width: 1000 } }]); });
    const target = screen.getByTestId('video-block-2');
    expect(target.getAttribute('data-fix-target')).toBe('true');
    fireEvent.pointerDown(target, { clientX: 100 });
    fireEvent.pointerMove(target, { clientX: 150 });
    expect(onFixDragTo).toHaveBeenCalledWith(18.84 + (50 / 1000) * duration);
    fireEvent.pointerUp(target);

    // The other block never responds to the same drag sequence.
    const other = screen.getByTestId('video-block-1');
    expect(other.getAttribute('data-fix-target')).toBe('false');
    fireEvent.pointerDown(other, { clientX: 100 });
    fireEvent.pointerMove(other, { clientX: 150 });
    expect(onFixDragTo).toHaveBeenCalledTimes(1); // still just the one call from above

    // Click-to-pick is suppressed on the fix target (dragging, not switching).
    fireEvent.click(target);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('renders nothing without videos or duration', () => {
    const a = render(<VideoLane videos={[]} duration={100} />);
    expect(a.container.innerHTML).toBe('');
    a.unmount();
    const b = render(<VideoLane videos={videos} duration={0} />);
    expect(b.container.innerHTML).toBe('');
  });
});

describe('AnnotateTimeline mounts the Videos lane on desktop only (T13280)', () => {
  const baseProps = { currentTime: 0, duration, onSeek: () => {}, regions: [], onSelectRegion: () => {} };
  const videoLane = { videos, activeSequence: 2, onPick: () => {}, pulseSequence: null };

  it('desktop: lane + label mount and the boundary is a visible flag', () => {
    stubMatchMedia(false);
    render(<AnnotateTimeline {...baseProps} videoLane={videoLane} boundaryOffsets={[18.84]} />);
    expect(screen.getByTestId('video-lane')).toBeTruthy();
    expect(screen.getByTestId('video-lane-label').textContent).toContain('Videos');
    const flag = screen.getByTestId('video-boundary');
    expect(flag.className).toContain('w-0.5');
    expect(flag.querySelector('span')).toBeTruthy();
  });

  it('phone: no lane (the SourceBar is the control there)', () => {
    stubMatchMedia(true);
    render(<AnnotateTimeline {...baseProps} videoLane={videoLane} boundaryOffsets={[18.84]} />);
    expect(screen.queryByTestId('video-lane')).toBeNull();
    expect(screen.queryByTestId('video-lane-label')).toBeNull();
    expect(screen.getByTestId('video-boundary')).toBeTruthy();
  });

  it('single-video games render byte-identically with videoLane null', () => {
    stubMatchMedia(false);
    const a = render(<AnnotateTimeline {...baseProps} />);
    const html = a.container.innerHTML;
    a.unmount();
    const b = render(<AnnotateTimeline {...baseProps} videoLane={null} />);
    expect(b.container.innerHTML).toBe(html);
    expect(screen.queryByTestId('video-lane')).toBeNull();
  });
});
