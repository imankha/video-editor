import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RecapPlayerModal } from './RecapPlayerModal';

const {
  mockSetPendingGame, mockSetEditorMode, mockUpdateClip,
  mockToastSuccess, mockFetchProjects, recapState,
} = vi.hoisted(() => ({
  mockSetPendingGame: vi.fn(),
  mockSetEditorMode: vi.fn(),
  mockUpdateClip: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockFetchProjects: vi.fn(),
  // Mutable so a test can pick which recap clip is "active"; defaults to none.
  recapState: { activeClipId: null },
}));

vi.mock('../utils/pendingNavigation', () => ({
  setPendingGame: mockSetPendingGame,
}));

vi.mock('../stores/editorStore', () => ({
  EDITOR_MODES: { ANNOTATE: 'annotate' },
  useEditorStore: { getState: () => ({ setEditorMode: mockSetEditorMode }) },
}));

vi.mock('./shared/Toast', () => ({
  toast: { success: mockToastSuccess, error: vi.fn() },
}));

vi.mock('../hooks/useRawClipSave', () => ({
  useRawClipSave: () => ({ updateClip: mockUpdateClip, isSaving: false }),
}));

vi.mock('../stores/projectsStore', () => ({
  useProjectsStore: { getState: () => ({ fetchProjects: mockFetchProjects }) },
}));

vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
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
    activeClipId: recapState.activeClipId,
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
  PlaybackControls: ({ onShare, isPlaying, onTogglePlay, isFullscreen, onToggleFullscreen }) => (
    <div data-testid="playback-controls">
      <span data-testid="is-playing">{isPlaying ? 'playing' : 'paused'}</span>
      <button data-testid="toggle-play" onClick={onTogglePlay}>toggle</button>
      {onShare && <button onClick={onShare} title="Share highlights">Share</button>}
      <span data-testid="is-fullscreen">{isFullscreen ? 'fullscreen' : 'windowed'}</span>
      <button data-testid="toggle-fullscreen" onClick={onToggleFullscreen}>fullscreen</button>
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

  it('opens on the Annotations tab but still exposes the Highlights tab', async () => {
    globalThis.fetch = mockFetch(GAME_VIDEO_DATA, [{ id: 101, name: 'Highlight 1', duration: 5 }]);
    render(
      <RecapPlayerModal
        game={{ id: 42, name: 'Big Game', storage_status: 'expired' }}
        initialTab="annotations"
        onClose={vi.fn()}
      />
    );
    // Tab bar present with both tabs; user can switch to Highlights inside the modal.
    const highlightsTab = await screen.findByRole('button', { name: 'Highlights' });
    expect(highlightsTab).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Annotations' })).toBeTruthy();

    fireEvent.click(highlightsTab);
    // After switching, the Highlights-only "Create clip" action appears.
    await waitFor(() =>
      expect(screen.getByTitle('Create a clip in Annotate at this moment')).toBeTruthy()
    );
  });
});

// T5645: mobile fullscreen toggle must exit via whichever API the browser
// actually exposes (standard or webkit-prefixed), and read/derive its state
// from the browser's real fullscreenElement instead of a flag that can desync.
describe('RecapPlayerModal - fullscreen toggle (T5645)', () => {
  const origRequestFullscreen = Element.prototype.requestFullscreen;
  const origWebkitRequestFullscreen = Element.prototype.webkitRequestFullscreen;
  const origExitFullscreen = document.exitFullscreen;
  const origWebkitExitFullscreen = document.webkitExitFullscreen;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch();
  });

  afterEach(() => {
    Element.prototype.requestFullscreen = origRequestFullscreen;
    Element.prototype.webkitRequestFullscreen = origWebkitRequestFullscreen;
    document.exitFullscreen = origExitFullscreen;
    document.webkitExitFullscreen = origWebkitExitFullscreen;
    delete document.fullscreenElement;
    delete document.webkitFullscreenElement;
  });

  it('enters via the standard API and exits via document.exitFullscreen when both exist', async () => {
    Element.prototype.requestFullscreen = vi.fn();
    document.exitFullscreen = vi.fn();

    render(<RecapPlayerModal game={{ id: 42, name: 'Big Game' }} initialTab="annotations" onClose={vi.fn()} />);
    await waitFor(() => screen.getByTestId('playback-controls'));

    fireEvent.click(screen.getByTestId('toggle-fullscreen'));
    expect(Element.prototype.requestFullscreen).toHaveBeenCalledTimes(1);

    // Browser confirms fullscreen was entered.
    Object.defineProperty(document, 'fullscreenElement', { value: document.body, configurable: true });
    fireEvent(document, new Event('fullscreenchange'));
    await waitFor(() => expect(screen.getByTestId('is-fullscreen').textContent).toBe('fullscreen'));

    fireEvent.click(screen.getByTestId('toggle-fullscreen'));
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('falls back to webkit-prefixed enter/exit when the standard API is unavailable', async () => {
    delete Element.prototype.requestFullscreen;
    delete document.exitFullscreen;
    Element.prototype.webkitRequestFullscreen = vi.fn();
    document.webkitExitFullscreen = vi.fn();

    render(<RecapPlayerModal game={{ id: 42, name: 'Big Game' }} initialTab="annotations" onClose={vi.fn()} />);
    await waitFor(() => screen.getByTestId('playback-controls'));

    fireEvent.click(screen.getByTestId('toggle-fullscreen'));
    expect(Element.prototype.webkitRequestFullscreen).toHaveBeenCalledTimes(1);

    // Browser confirms fullscreen via the webkit-prefixed property + event.
    Object.defineProperty(document, 'webkitFullscreenElement', { value: document.body, configurable: true });
    fireEvent(document, new Event('webkitfullscreenchange'));
    await waitFor(() => expect(screen.getByTestId('is-fullscreen').textContent).toBe('fullscreen'));

    fireEvent.click(screen.getByTestId('toggle-fullscreen'));
    expect(document.webkitExitFullscreen).toHaveBeenCalledTimes(1);
  });
});

const T4130_CLIPS = [
  { id: 1, name: 'Overlay Clip', rating: 4, tags: ['Jake'], notes: 'great pass',
    start_time: 0, end_time: 5, recap_start: 0, recap_end: 5, duration: 5,
    game_start_time: 65, in_drafts: false },
  { id: 2, name: 'Draft Clip', rating: 5, tags: [], notes: '',
    start_time: 10, end_time: 15, recap_start: 5, recap_end: 10, duration: 5,
    game_start_time: 120, in_drafts: true },
];
const T4130_DATA = {
  url: 'https://r2.example.com/games/abc.mp4',
  clips: T4130_CLIPS,
  video_kind: 'game',
};

describe('RecapPlayerModal - annotations overlay + create clip (T4130)', () => {
  const renderModal = (props = {}) => render(
    <RecapPlayerModal
      game={{ id: 42, name: 'Big Game' }}
      initialTab="annotations"
      onClose={vi.fn()}
      {...props}
    />
  );

  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom does not implement media playback.
    window.HTMLMediaElement.prototype.play = vi.fn();
    window.HTMLMediaElement.prototype.pause = vi.fn();
    recapState.activeClipId = 1; // clip 1 active by default
    mockUpdateClip.mockResolvedValue({ project_id: 99, project_created: true });
    globalThis.fetch = mockFetch(T4130_DATA);
  });

  it('overlays the active clip annotation, visible by default', async () => {
    renderModal();
    // The active clip name appears via NotesOverlay (sidebar list is mocked out).
    expect(await screen.findByText('Overlay Clip')).toBeTruthy();
  });

  it('toggles the overlay off and back on', async () => {
    renderModal();
    await screen.findByText('Overlay Clip');

    fireEvent.click(screen.getByLabelText('Hide annotations'));
    await waitFor(() => expect(screen.queryByText('Overlay Clip')).toBeNull());

    fireEvent.click(screen.getByLabelText('Show annotations'));
    expect(await screen.findByText('Overlay Clip')).toBeTruthy();
  });

  it('does not render the overlay/toggle on the Highlights tab', async () => {
    globalThis.fetch = mockFetch(T4130_DATA, [{ id: 101, name: 'Highlight 1', duration: 5 }]);
    renderModal();
    await screen.findByText('Overlay Clip');

    fireEvent.click(screen.getByRole('button', { name: 'Highlights' }));

    await waitFor(() => expect(screen.queryByLabelText('Hide annotations')).toBeNull());
    expect(screen.queryByText('Overlay Clip')).toBeNull();
  });

  it('enables "Create clip" when a clip is active, source exists, and it is not a draft', async () => {
    renderModal();
    const btn = await screen.findByTitle('Create a draft reel from this clip');
    expect(btn.disabled).toBe(false);
  });

  it('disables "Create clip" when no clip is active', async () => {
    recapState.activeClipId = null;
    renderModal();
    const btn = await screen.findByTitle('Create a draft reel from this clip');
    expect(btn.disabled).toBe(true);
  });

  it('disables "Create clip" when no source video exists (video_kind null)', async () => {
    globalThis.fetch = mockFetch({ url: null, clips: T4130_CLIPS, video_kind: null });
    renderModal();
    const btn = await screen.findByTitle('Video source unavailable');
    expect(btn.disabled).toBe(true);
  });

  it('disables "Create clip" when the active clip is already a draft', async () => {
    recapState.activeClipId = 2; // in_drafts: true
    renderModal();
    const btn = await screen.findByTitle('This clip is already a draft reel');
    expect(btn.disabled).toBe(true);
  });

  it('creates a draft via updateClip and optimistically flips in_drafts', async () => {
    renderModal();
    const btn = await screen.findByTitle('Create a draft reel from this clip');
    fireEvent.click(btn);

    await waitFor(() =>
      expect(mockUpdateClip).toHaveBeenCalledWith(1, { create_project: true })
    );
    expect(mockToastSuccess).toHaveBeenCalledWith('Reel created!', { duration: 5000 });
    expect(mockFetchProjects).toHaveBeenCalledWith({ force: true });

    // Optimistic flip: the button now reflects the clip being a draft and is disabled.
    await waitFor(() =>
      expect(screen.getByTitle('This clip is already a draft reel').disabled).toBe(true)
    );
  });

  it('informs the user when the draft already existed (project_created false)', async () => {
    mockUpdateClip.mockResolvedValue({ project_id: 99, project_created: false });
    renderModal();
    const btn = await screen.findByTitle('Create a draft reel from this clip');
    fireEvent.click(btn);

    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith('This clip is already a draft reel', { duration: 5000 })
    );
  });
});

// T5290: mobile stacked layout — the clip list drops below the video as a
// collapsible pull-up. useIsMobile is mocked false + jsdom has no matchMedia, so
// the list starts EXPANDED here; we exercise the pull-up handle wiring directly.
describe('RecapPlayerModal - mobile clip-list pull-up (T5290)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLMediaElement.prototype.play = vi.fn();
    window.HTMLMediaElement.prototype.pause = vi.fn();
    recapState.activeClipId = 1;
    globalThis.fetch = mockFetch(T4130_DATA);
  });

  it('renders the clip list stacked below the video (order-2 sidebar, order-1 video)', async () => {
    const { container } = render(
      <RecapPlayerModal game={{ id: 42, name: 'Big Game' }} initialTab="annotations" onClose={vi.fn()} />
    );
    await waitFor(() => screen.getByTestId('clips-sidebar'));
    // The content row stacks as a column on phones and a row at >= sm.
    const contentRow = container.querySelector('.sm\\:flex-row');
    expect(contentRow).toBeTruthy();
    expect(contentRow.className).toContain('flex-col');
    // Sidebar sits after the video in DOM but is reordered below on phones.
    const sidebar = screen.getByTestId('clips-sidebar').closest('.order-2');
    expect(sidebar).toBeTruthy();
    expect(sidebar.className).toContain('w-full');
    expect(sidebar.className).toContain('sm:w-64');
  });

  it('pull-up handle collapses and re-expands the clip list', async () => {
    render(
      <RecapPlayerModal game={{ id: 42, name: 'Big Game' }} initialTab="annotations" onClose={vi.fn()} />
    );
    await waitFor(() => screen.getByTestId('clips-sidebar'));

    // Expanded by default (desktop-mocked): the list wrapper is not hidden.
    const listWrapper = screen.getByTestId('clips-sidebar').parentElement;
    expect(listWrapper.className).not.toContain('hidden');

    // Tap the pull-up handle -> collapse (list wrapper hidden on phones).
    fireEvent.click(screen.getByLabelText('Hide clip list'));
    expect(screen.getByTestId('clips-sidebar').parentElement.className).toContain('hidden');
    expect(screen.getByLabelText('Show clip list')).toBeTruthy();

    // Tap again -> expand.
    fireEvent.click(screen.getByLabelText('Show clip list'));
    expect(screen.getByTestId('clips-sidebar').parentElement.className).not.toContain('hidden');
  });

  it('Highlights tab has the same pull-up handle', async () => {
    globalThis.fetch = mockFetch(T4130_DATA, [{ id: 101, name: 'Highlight 1', duration: 5 }]);
    render(
      <RecapPlayerModal game={{ id: 42, name: 'Big Game' }} initialTab="highlights" onClose={vi.fn()} />
    );
    await waitFor(() => screen.getByTestId('clips-sidebar'));
    fireEvent.click(screen.getByLabelText('Hide highlights list'));
    expect(screen.getByLabelText('Show highlights list')).toBeTruthy();
  });
});
