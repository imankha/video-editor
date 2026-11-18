import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CollectionPlayer } from './CollectionPlayer';
import { RANKING_COPY } from '../../config/displayNames';

// T17180: the Highlights player shows a labeled Add/Edit spotlight button beside Share, labels
// the pencil "Edit highlight", and on a phone moves Re-rank and Play/Pause into a "More" menu
// with words, so a parent who left the Frame screen can find the spotlight without guessing icons.

vi.mock('./useStoryPlayback', () => ({
  useStoryPlayback: (_ref, reels) => ({
    activeIndex: 0, activeReel: reels[0], isPlaying: true, segmentProgress: 0,
    next: vi.fn(), prev: vi.fn(), goTo: vi.fn(), togglePlay: mockTogglePlay,
  }),
}));
const { mockTogglePlay } = vi.hoisted(() => ({ mockTogglePlay: vi.fn() }));

const reel = { id: 7, name: 'R', streamUrl: 's', aspect_ratio: '9:16', duration: null, project_id: 3, clip_count: 1 };

function setPhone(isPhone) {
  window.matchMedia = vi.fn((query) => ({
    matches: isPhone && query.includes('orientation: portrait'),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

function renderPlayer(props = {}) {
  return render(
    <CollectionPlayer reels={[reel]} title="R" onClose={vi.fn()} onShare={vi.fn()}
      onReEdit={vi.fn()} onReRank={vi.fn()} {...props} />,
  );
}

afterEach(() => { delete window.matchMedia; mockTogglePlay.mockClear(); });

describe('CollectionPlayer spotlight entry (T17180)', () => {
  it('shows a labeled Add spotlight button that opens the spotlight for the active highlight', () => {
    setPhone(true);
    const onSpotlight = vi.fn();
    renderPlayer({ onSpotlight, hasSpotlight: () => false });
    const button = screen.getByTestId('player-spotlight');
    expect(button.textContent).toBe('Add spotlight');
    fireEvent.click(button);
    expect(onSpotlight).toHaveBeenCalledWith(reel);
  });

  it('reads Edit spotlight once the highlight has one', () => {
    setPhone(false);
    renderPlayer({ onSpotlight: vi.fn(), hasSpotlight: (r) => r.id === 7 });
    expect(screen.getByTestId('player-spotlight').textContent).toBe('Edit spotlight');
  });

  it('labels the pencil "Edit highlight" in words', () => {
    setPhone(true);
    renderPlayer();
    expect(screen.getByTestId('player-edit-highlight').textContent).toBe('Edit highlight');
  });

  it('on a phone, Re-rank and Pause sit in a More menu with words', () => {
    setPhone(true);
    const onReRank = vi.fn();
    renderPlayer({ onReRank });
    expect(screen.queryByTitle(RANKING_COPY.MOVE)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const pause = screen.getByRole('menuitem', { name: 'Pause' });
    expect(pause.textContent).toBe('Pause');
    fireEvent.click(pause);
    expect(mockTogglePlay).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: RANKING_COPY.MOVE }));
    expect(onReRank).toHaveBeenCalledWith(reel);
  });

  it('keeps Re-rank and Pause in the header on a wider screen', () => {
    setPhone(false);
    renderPlayer();
    expect(screen.getByTitle(RANKING_COPY.MOVE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });
});
