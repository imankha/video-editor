import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CollectionPlayer } from './CollectionPlayer';

// T13050: the Guidance switch is a fixed layer pinned top-right over the Home page. The Finished
// viewer (a fullscreen player) must reserve a row beneath it so the switch never sits on Share /
// Download, and its title must wrap rather than truncate to "0...". jsdom has no layout, so this
// pins the class contract.

vi.mock('../shared/Button', () => ({
  Button: ({ onClick, children }) => <button onClick={onClick}>{children}</button>,
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

  it('leaves other players unchanged', () => {
    render(<CollectionPlayer reels={reel} title="Play 1" onClose={vi.fn()} />);
    const h3 = screen.getByRole('heading', { name: 'Play 1' });
    expect(h3.className).toContain('truncate');
    expect(h3.parentElement.parentElement.className).not.toContain('pt-16');
  });
});
