import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollectionPlayer } from './CollectionPlayer';

// T6320 CHARACTERIZATION — pins CollectionPlayer's current segmented-bar
// rendering and seek behaviour BEFORE extracting the shared ProgressTrack /
// PlayheadHandle primitives. These must stay GREEN through the mechanical move
// (step 5: "no visual change"). The "no playhead handle today" assertion
// deliberately pins the T5130 GAP (the sport ball never reached My Reels); it is
// the one characterization that step 6 intentionally supersedes when the handle
// is added to the active segment — until then it guards against an accidental
// handle appearing during the mechanical move.

vi.mock('../shared/Button', () => ({
  Button: ({ onClick, disabled, title, children }) => (
    <button onClick={onClick} disabled={disabled} title={title}>{children}</button>
  ),
}));

// Drive the playback hook deterministically: reel index 1 is active at 50%.
const { mockGoTo } = vi.hoisted(() => ({ mockGoTo: vi.fn() }));
vi.mock('./useStoryPlayback', () => ({
  useStoryPlayback: (_ref, reels) => ({
    activeIndex: 1,
    activeReel: reels[1],
    segmentProgress: 0.5,
    next: vi.fn(),
    prev: vi.fn(),
    goTo: mockGoTo,
    togglePlay: vi.fn(),
  }),
}));

const reels = [
  { id: 1, name: 'One', streamUrl: 'a', aspect_ratio: '9:16', duration: null },
  { id: 2, name: 'Two', streamUrl: 'b', aspect_ratio: '9:16', duration: null },
  { id: 3, name: 'Three', streamUrl: 'c', aspect_ratio: '9:16', duration: null },
];

const segmentButtons = () =>
  screen.getAllByRole('button').filter((b) => /^(One|Two|Three)/.test(b.getAttribute('aria-label') || ''));

describe('CollectionPlayer segmented bar rendering (T6320 characterization)', () => {
  beforeEach(() => mockGoTo.mockClear());

  it('lays the segments out in a flex gap-1 row with one button per reel', () => {
    const { container } = render(<CollectionPlayer reels={reels} title="T" onClose={vi.fn()} />);
    const row = container.querySelector('.flex.gap-1.px-3.pt-2');
    expect(row).not.toBeNull();
    expect(segmentButtons()).toHaveLength(3);
  });

  it('renders each segment as a flex-1 py-2 hit target (T4760 padding preserved)', () => {
    render(<CollectionPlayer reels={reels} title="T" onClose={vi.fn()} />);
    for (const seg of segmentButtons()) {
      expect(seg.className).toContain('flex-1');
      expect(seg.className).toContain('py-2');
    }
  });

  it('renders each track as h-1 rounded-full bg-white/25 with a bg-white fill', () => {
    render(<CollectionPlayer reels={reels} title="T" onClose={vi.fn()} />);
    for (const seg of segmentButtons()) {
      const trackEl = seg.querySelector('.h-1.rounded-full.bg-white\\/25');
      expect(trackEl).not.toBeNull();
      expect(trackEl.querySelector('.bg-white.rounded-full')).not.toBeNull();
    }
  });

  it('fills past segments 100%, the active segment by its progress, future segments 0%', () => {
    render(<CollectionPlayer reels={reels} title="T" onClose={vi.fn()} />);
    const [seg0, seg1, seg2] = segmentButtons();
    const fillOf = (seg) => seg.querySelector('.bg-white.rounded-full');
    expect(fillOf(seg0).style.width).toBe('100%'); // index 0 < activeIndex 1
    expect(fillOf(seg1).style.width).toBe('50%');  // active, segmentProgress 0.5
    expect(fillOf(seg2).style.width).toBe('0%');   // index 2 > activeIndex 1
  });

  it('has NO playhead handle on any segment today (the T5130 gap this task closes)', () => {
    const { container } = render(<CollectionPlayer reels={reels} title="T" onClose={vi.fn()} />);
    // No sport glyph anywhere in the segmented bar.
    expect(container.querySelector('[data-testid="scrub-handle-glyph"]')).toBeNull();
    // The active track holds ONLY the fill — no centred handle overlay.
    const activeTrack = segmentButtons()[1].querySelector('.h-1.rounded-full.bg-white\\/25');
    expect(activeTrack.children).toHaveLength(1);
  });
});

describe('CollectionPlayer segment seek behaviour (T6320 characterization)', () => {
  beforeEach(() => mockGoTo.mockClear());

  it('jumps to the clicked segment and seeks to the clicked fraction', () => {
    render(<CollectionPlayer reels={reels} title="T" onClose={vi.fn()} />);
    const seg2 = segmentButtons()[2];
    seg2.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, right: 100, bottom: 0, height: 20, x: 0, y: 0 });
    fireEvent.click(seg2, { clientX: 40 });
    expect(mockGoTo).toHaveBeenCalledWith(2, 0.4);
  });
});
