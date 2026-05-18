import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecapPlayerModal } from './RecapPlayerModal';

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
  PlaybackControls: ({ onShare }) => (
    <div data-testid="playback-controls">
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

function mockFetch(recapData = RECAP_DATA_WITH_CLIPS) {
  return vi.fn(async (url) => {
    if (url.includes('/recap-data')) {
      return { ok: true, json: async () => recapData };
    }
    if (url.includes('/brilliant-clips')) {
      return { ok: true, json: async () => [] };
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
