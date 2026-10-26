import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CollectionPlayer } from './CollectionPlayer';

// T13050: the Guidance switch is a fixed layer pinned top-right over the Home page. The Finished
// viewer (a fullscreen player) must reserve a row beneath it so the switch never sits on Share /
// Download, and its title must wrap rather than truncate to "0...". jsdom has no layout, so this
// pins the class contract.

vi.mock('../shared/Button', () => ({
  Button: ({ onClick, children, 'data-testid': testId }) => <button onClick={onClick} data-testid={testId}>{children}</button>,
}));
vi.mock('./useStoryPlayback', () => ({
  useStoryPlayback: (_ref, reels) => ({
    activeIndex: 0, activeReel: reels[0], isPlaying: false, segmentProgress: 0,
    next: vi.fn(), prev: vi.fn(), goTo: vi.fn(), togglePlay: vi.fn(),
  }),
}));

const reel = [{ id: 1, name: 'R', streamUrl: 's', aspect_ratio: '9:16', duration: null }];

describe('CollectionPlayer clears the Guidance switch (T13050)', () => {
  it('reserves a header row under the switch and wraps the title', () => {
    render(<CollectionPlayer reels={reel} title="Play 1 long name" onClose={vi.fn()} onDownload={vi.fn()} clearGuidanceToggle />);
    const h3 = screen.getByRole('heading', { name: 'Play 1 long name' });
    expect(h3.className).not.toContain('truncate');
    expect(h3.parentElement.parentElement.className).toContain('pt-16');
  });

  // T13190: at 390 the action cluster (Share, Download, Re-edit, Re-rank, Play, Fullscreen, Close)
  // is wider than the screen; a non-shrinking, non-wrapping cluster pushed Fullscreen and Close
  // off the right edge. The cluster must be allowed to shrink and wrap so Close stays on-screen.
  it('lets the header buttons wrap so Close stays on-screen (T13190)', () => {
    render(<CollectionPlayer reels={reel} title="Play 1" onClose={vi.fn()} onDownload={vi.fn()} clearGuidanceToggle />);
    const cluster = screen.getByTestId('player-close').parentElement;
    expect(cluster.className).toContain('flex-wrap');
    expect(cluster.className).not.toContain('shrink-0');
  });

  it('leaves other players unchanged', () => {
    render(<CollectionPlayer reels={reel} title="Play 1" onClose={vi.fn()} />);
    const h3 = screen.getByRole('heading', { name: 'Play 1' });
    expect(h3.className).toContain('truncate');
    expect(h3.parentElement.parentElement.className).not.toContain('pt-16');
  });
});
