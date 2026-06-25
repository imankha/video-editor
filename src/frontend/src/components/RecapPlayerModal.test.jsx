import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecapPlayerModal } from './RecapPlayerModal';

const { mockSetPendingGame, mockSetEditorMode } = vi.hoisted(() => ({
  mockSetPendingGame: vi.fn(),
  mockSetEditorMode: vi.fn(),
}));

vi.mock('../utils/pendingNavigation', () => ({
  setPendingGame: mockSetPendingGame,
}));

vi.mock('../stores/editorStore', () => ({
  EDITOR_MODES: { ANNOTATE: 'annotate' },
  useEditorStore: { getState: () => ({ setEditorMode: mockSetEditorMode }) },
}));

vi.mock('./shared/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('./shared/Button', () => ({
  Button: ({ children, onClick, disabled, ...props }) => (
    <button onClick={onClick} disabled={disabled} {...props}>{children}</button>
  ),
}));

vi.mock('./recap/useRecapPlayback', () => ({
  useRecapPlayback: () => ({
    isPlaying: false,
    virtualTime: 0,
    totalVirtualDuration: 60,
    segments: [],
    activeClipId: null,
    activeClipName: null,
    currentSegment: null,
    togglePlay: vi.fn(),
    restart: vi.fn(),
    seekVirtual: vi.fn(),
    seekWithinSegment: vi.fn(),
    startScrub: vi.fn(),
    endScrub: vi.fn(),
    seekToClip: vi.fn(),
    streamUrl: null,
    playbackRate: 1,
    changePlaybackRate: vi.fn(),
  }),
}));

vi.mock('./recap/useHighlightsPlayback', () => ({
  useHighlightsPlayback: () => ({
    isPlaying: false,
    virtualTime: 0,
    totalVirtualDuration: 30,
    segments: [],
    activeClipId: null,
    activeClipName: null,
    currentSegment: null,
    togglePlay: vi.fn(),
    restart: vi.fn(),
    seekVirtual: vi.fn(),
    seekWithinSegment: vi.fn(),
    startScrub: vi.fn(),
    endScrub: vi.fn(),
    seekToClip: vi.fn(),
    streamUrl: null,
    playbackRate: 1,
    changePlaybackRate: vi.fn(),
  }),
}));

vi.mock('./recap/RecapClipsSidebar', () => ({
  RecapClipsSidebar: () => <div data-testid="clips-sidebar" />,
}));

vi.mock('../modes/annotate/components/PlaybackControls', () => ({
  PlaybackControls: ({ onShare, isPlaying, onTogglePlay }) => (
    <div data-testid="playback-controls">
      <span data-testid="is-playing">{isPlaying ? 'playing' : 'paused'}</span>
      <button data-testid="toggle-play" onClick={onTogglePlay}>toggle</button>
      {onShare && <button onClick={onShare} title="Share highlights">Share</button>}
    </div>
  ),
}));

vi.mock('./SharePlaybackDialog', () => ({
  SharePlaybackDialog: ({ onClose, gameId, gameName }) => (
    <div data-testid="share-playback-dialog">
      <span data-testid="dialog-game-id">{gameId}</span>
      <span data-testid="dialog-game-name">{gameName}</span>
      <button onClick={onClose} data-testid="dialog-close">Close</button>
    </div>
  ),
}));

const RECAP_DATA_WITH_CLIPS = {
  clips: [
    { id: 1, name: 'Clip 1', tags: ['Jake'], start_time: 0, end_time: 5, duration: 5 },
    { id: 2, name: 'Clip 2', tags: ['Jake', 'Player 7'], start_time: 10, end_time: 15, duration: 5 },
    { id: 3, name: 'Clip 3', tags: ['Player 7'], start_time: 20, end_time: 25, duration: 5 },
  ],
  download_id: 'dl-123',
};

const RECAP_DATA_NO_CLIPS = {
  clips: [],
  download_id: 'dl-456',
};

function mockFetch(recapData = RECAP_DATA_WITH_CLIPS, highlightClips = []) {
  return vi.fn(async (url) => {
    if (url.includes('/recap-data')) {
      return { ok: true, json: async () => recapData };
    }
    if (url.includes('/brilliant-clips')) {
      return { ok: true, json: async () => ({ clips: highlightClips }) };
    }
    if (url.includes('/contacts')) {
      return { ok: true, json: async () => ({ contacts: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

describe('RecapPlayerModal - Share Button', () => {
  const defaultProps = {
    game: { id: 42, name: 'Big Game' },
    initialTab: 'annotations',
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch();
  });

  it('shows share button when clips exist', async () => {
    render(<RecapPlayerModal {...defaultProps} />);
    await waitFor(() => {
      const shareBtn = screen.getByTitle('Share highlights');
      expect(shareBtn).toBeTruthy();
    });
  });

  it('hides share button when no clips', async () => {
    globalThis.fetch = mockFetch(RECAP_DATA_NO_CLIPS);
    render(<RecapPlayerModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.queryByTitle('Share highlights')).toBeNull();
    });
  });

  it('opens SharePlaybackDialog on share button click', async () => {
    render(<RecapPlayerModal {...defaultProps} />);
    await waitFor(() => screen.getByTitle('Share highlights'));

    fireEvent.click(screen.getByTitle('Share highlights'));

    await waitFor(() => {
      expect(screen.getByTestId('share-playback-dialog')).toBeTruthy();
    });
  });

  it('passes correct gameId to SharePlaybackDialog', async () => {
    render(<RecapPlayerModal {...defaultProps} />);
    await waitFor(() => screen.getByTitle('Share highlights'));
    fireEvent.click(screen.getByTitle('Share highlights'));

    await waitFor(() => {
      expect(screen.getByTestId('dialog-game-id').textContent).toBe('42');
    });
  });

  it('passes correct gameName to SharePlaybackDialog', async () => {
    render(<RecapPlayerModal {...defaultProps} />);
    await waitFor(() => screen.getByTitle('Share highlights'));
    fireEvent.click(screen.getByTitle('Share highlights'));

    await waitFor(() => {
      expect(screen.getByTestId('dialog-game-name').textContent).toBe('Big Game');
    });
  });

  it('closes SharePlaybackDialog when onClose is called', async () => {
    render(<RecapPlayerModal {...defaultProps} />);
    await waitFor(() => screen.getByTitle('Share highlights'));
    fireEvent.click(screen.getByTitle('Share highlights'));

    await waitFor(() => screen.getByTestId('share-playback-dialog'));
    fireEvent.click(screen.getByTestId('dialog-close'));

    await waitFor(() => {
      expect(screen.queryByTestId('share-playback-dialog')).toBeNull();
    });
  });

  it('uses "Untitled Game" when game has no name', async () => {
    render(<RecapPlayerModal {...defaultProps} game={{ id: 42, name: null }} />);
    await waitFor(() => screen.getByTitle('Share highlights'));
    fireEvent.click(screen.getByTitle('Share highlights'));

    await waitFor(() => {
      expect(screen.getByTestId('dialog-game-name').textContent).toBe('Untitled Game');
    });
  });
});

describe('RecapPlayerModal - expired game (T3970)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch();
  });

  it('suppresses the in-modal share button for an expired game', async () => {
    render(
      <RecapPlayerModal
        game={{ id: 42, name: 'Big Game', storage_status: 'expired' }}
        initialTab="annotations"
        onClose={vi.fn()}
      />
    );
    // Clips load, but sharing an expired game is blocked => no share affordance.
    await waitFor(() => screen.getByTestId('playback-controls'));
    expect(screen.queryByTitle('Share highlights')).toBeNull();
  });

  it('keeps the share button for an active game with clips', async () => {
    render(
      <RecapPlayerModal
        game={{ id: 42, name: 'Big Game', storage_status: 'active' }}
        initialTab="annotations"
        onClose={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByTitle('Share highlights')).toBeTruthy();
    });
  });

  it('plays the game video for an expired in-grace game (video_kind="game")', async () => {
    globalThis.fetch = mockFetch({
      url: 'https://r2.example.com/games/abc.mp4',
      clips: RECAP_DATA_WITH_CLIPS.clips,
      video_kind: 'game',
    });
    const { container } = render(
      <RecapPlayerModal
        game={{ id: 42, name: 'Big Game', storage_status: 'expired' }}
        initialTab="annotations"
        onClose={vi.fn()}
      />
    );
    await waitFor(() => {
      const video = container.querySelector('video');
      expect(video).toBeTruthy();
      expect(video.getAttribute('src')).toBe('https://r2.example.com/games/abc.mp4');
    });
    // Video present => no graceful fallback message.
    expect(screen.queryByText(/no longer available/i)).toBeNull();
  });

  it('shows a graceful message when the recap video is gone but annotations persist', async () => {
    globalThis.fetch = mockFetch({ url: null, clips: RECAP_DATA_WITH_CLIPS.clips, video_kind: null });
    const { container } = render(
      <RecapPlayerModal
        game={{ id: 42, name: 'Big Game', storage_status: 'expired' }}
        initialTab="annotations"
        onClose={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByText(/no longer available/i)).toBeTruthy();
    });
    // No video element when url is null.
    expect(container.querySelector('video')).toBeNull();
  });
});

const GAME_VIDEO_DATA = {
  url: 'https://r2.example.com/games/abc.mp4',
  clips: RECAP_DATA_WITH_CLIPS.clips,
  video_kind: 'game',
};

describe('RecapPlayerModal - transport + create clip (T3970)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom does not implement media playback.
    window.HTMLMediaElement.prototype.play = vi.fn();
    window.HTMLMediaElement.prototype.pause = vi.fn();
    globalThis.fetch = mockFetch(GAME_VIDEO_DATA);
  });

  it('reflects play/pause state from the active video element', async () => {
    const { container } = render(
      <RecapPlayerModal
        game={{ id: 42, name: 'Big Game' }}
        initialTab="annotations"
        onClose={vi.fn()}
      />
    );
    await waitFor(() => screen.getByTestId('playback-controls'));
    const video = container.querySelector('video');
    expect(video).toBeTruthy();
    // Not autoplaying in jsdom -> paused.
    expect(screen.getByTestId('is-playing').textContent).toBe('paused');

    fireEvent.play(video);
    await waitFor(() => expect(screen.getByTestId('is-playing').textContent).toBe('playing'));

    fireEvent.pause(video);
    await waitFor(() => expect(screen.getByTestId('is-playing').textContent).toBe('paused'));
  });

  it('toggles play/pause on Spacebar and prevents default', async () => {
    const { container } = render(
      <RecapPlayerModal
        game={{ id: 42, name: 'Big Game' }}
        initialTab="annotations"
        onClose={vi.fn()}
      />
    );
    await waitFor(() => screen.getByTestId('playback-controls'));
    const video = container.querySelector('video');

    const ev = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(true);
    expect(video.play).toHaveBeenCalled(); // paused -> play()
  });

  it('shows "Create clip" on Highlights and navigates to Annotate for the game', async () => {
    globalThis.fetch = mockFetch(GAME_VIDEO_DATA, [{ id: 101, name: 'Highlight 1', duration: 5 }]);
    const onClose = vi.fn();
    render(
      <RecapPlayerModal
        game={{ id: 42, name: 'Big Game', storage_status: 'expired' }}
        initialTab="highlights"
        onClose={onClose}
      />
    );
    const createBtn = await screen.findByTitle('Create a clip in Annotate at this moment');
    expect(createBtn.textContent).toContain('Create clip');

    fireEvent.click(createBtn);

    expect(mockSetPendingGame).toHaveBeenCalled();
    expect(mockSetPendingGame.mock.calls[0][0]).toBe(42); // navigates to THIS game
    expect(mockSetEditorMode).toHaveBeenCalledWith('annotate');
    expect(onClose).toHaveBeenCalled();
  });

  it('hides "Create clip" when the source video is gone (video_kind null)', async () => {
    globalThis.fetch = mockFetch(
      { url: null, clips: RECAP_DATA_WITH_CLIPS.clips, video_kind: null },
      [{ id: 101, name: 'Highlight 1', duration: 5 }],
    );
    render(
      <RecapPlayerModal
        game={{ id: 42, name: 'Big Game', storage_status: 'expired' }}
        initialTab="highlights"
        onClose={vi.fn()}
      />
    );
    await waitFor(() => screen.getByTestId('playback-controls'));
    expect(screen.queryByTitle('Create a clip in Annotate at this moment')).toBeNull();
  });
});
