import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CollectionPlayer } from './CollectionPlayer';
import { useAuthStore } from '../../stores/authStore';
import { RESULT_SURFACE } from '../../config/displayNames';

// T12560: a lost session (401) while the viewer loads must route to sign-in with ONE
// message -- not "Loading your highlight..." and "Couldn't load the video" at once
// with a Retry that cannot work.

vi.mock('../shared/Button', () => ({
  Button: ({ onClick, disabled, title, children }) => (
    <button onClick={onClick} disabled={disabled} title={title}>{children}</button>
  ),
}));

vi.mock('./useStoryPlayback', () => ({
  useStoryPlayback: (_ref, reels) => ({
    activeIndex: 0, activeReel: reels[0], isPlaying: false, segmentProgress: 0,
    next: vi.fn(), prev: vi.fn(), goTo: vi.fn(), togglePlay: vi.fn(),
  }),
}));

const apiFetchMock = vi.fn();
vi.mock('../../utils/apiFetch', () => ({ default: (...a) => apiFetchMock(...a) }));

const reel = [{ id: 1, name: 'R', streamUrl: 's', aspect_ratio: '9:16', duration: null }];

describe('CollectionPlayer lost session (T12560)', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    useAuthStore.setState({ isAuthenticated: true, showAuthModal: false, pendingAction: null });
  });

  it('a 401 behind a failed load shows one sign-in message and opens sign-in', async () => {
    apiFetchMock.mockResolvedValue({ status: 401, ok: false });
    render(<CollectionPlayer reels={reel} title="T" onClose={vi.fn()} />);
    fireEvent.error(screen.getByTestId('collection-player-video'));

    await waitFor(() =>
      expect(screen.getByTestId('collection-player-load-error').textContent)
        .toContain(RESULT_SURFACE.SESSION_EXPIRED));
    expect(screen.queryByText(RESULT_SURFACE.LOAD_ERROR)).toBeNull();
    expect(screen.queryByTestId('collection-player-skeleton')).toBeNull();
    expect(useAuthStore.getState().showAuthModal).toBe(true);
  });

  it('a non-401 failure keeps the ordinary load-error + Retry', async () => {
    apiFetchMock.mockResolvedValue({ status: 200, ok: true });
    render(<CollectionPlayer reels={reel} title="T" onClose={vi.fn()} />);
    fireEvent.error(screen.getByTestId('collection-player-video'));
    expect(screen.getByTestId('collection-player-load-error').textContent).toContain(RESULT_SURFACE.LOAD_ERROR);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(screen.getByTestId('collection-player-load-error').textContent).toContain(RESULT_SURFACE.LOAD_ERROR);
  });
});
