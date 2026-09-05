import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppStateProvider } from '../contexts';

// T8380: "Add Video" direct clip upload entry point on the In Progress Clips
// tab. These tests cover the parts unique to this task: the consequence notice
// gates the file picker (shown once, before any file is chosen), and a failed
// upload surfaces a Retry in the rail (never a silent loss). The guard-rework /
// tab-reachability coverage lives in ProjectManager.homeTabDefaults.test.jsx.

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver = MockIntersectionObserver;

vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
  useIsCoarsePointer: () => false,
  useIsLandscape: () => false,
}));

// The upload capability itself is T8370's; this task only wires the entry point,
// so we mock the hook to drive success/failure deterministically.
const uploadClipsMock = vi.fn();
vi.mock('../hooks/useClipUpload', () => ({
  useClipUpload: () => ({
    uploadClips: uploadClipsMock,
    progressByFile: {},
    isUploading: false,
    error: null,
  }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('./shared/Toast', () => ({
  toast: {
    success: (...a) => toastSuccess(...a),
    error: (...a) => toastError(...a),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { projectFilters: { statusFilter: 'all', aspectFilter: 'all', creationFilter: 'all' } },
    setStatusFilter: vi.fn(),
    setAspectFilter: vi.fn(),
    setCreationFilter: vi.fn(),
  }),
}));
vi.mock('../stores/authStore', () => {
  // requireAuth must invoke its callback so the notice opens (the user is auth'd).
  const state = { requireAuth: (cb) => cb(), isAuthenticated: true };
  const useAuthStore = (sel) => sel(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});
vi.mock('../stores/profileStore', () => {
  const state = { currentProfileId: 'p1', switchProfile: vi.fn() };
  const useProfileStore = (sel) => sel(state);
  useProfileStore.getState = () => state;
  return { useProfileStore };
});
vi.mock('../stores/gamesDataStore', () => {
  const state = { getGameVideoUrl: () => null };
  const useGamesDataStore = () => state;
  useGamesDataStore.getState = () => state;
  return { useGamesDataStore };
});

vi.mock('./Logo', () => ({ LogoWithText: () => <div />, Logo: () => <div />, default: () => <div /> }));
vi.mock('./CreditBalance', () => ({ CreditBalance: () => <div /> }));
vi.mock('./InstallButton', () => ({ InstallButton: () => <div /> }));
vi.mock('./SignInButton', () => ({ SignInButton: () => <div />, default: () => <div /> }));
vi.mock('./ProfileSportButton', () => ({ ProfileSportButton: () => <div />, default: () => <div /> }));
vi.mock('./ProfileDropdown', () => ({ ProfileDropdown: () => <div /> }));
vi.mock('./GameTile', () => ({ GameTile: () => <div data-testid="game-tile" /> }));
vi.mock('./DraftTile', () => ({ DraftTile: () => <div data-testid="draft-tile" />, default: () => <div /> }));
vi.mock('./PublishedReelsPanel', () => ({
  PublishedReelsPanel: (props) => <div data-testid="published-tab-panel" data-active={String(!!props.active)} />,
}));

import { ProjectManager } from './ProjectManager';
import { useGalleryStore } from '../stores/galleryStore';

const APP_STATE = { unseenReelsCount: 0, exportingProject: null };

function renderOnClipsTab(props = {}) {
  window.history.replaceState(null, '', '/home/reels');
  return render(
    <AppStateProvider value={APP_STATE}>
      <ProjectManager
        projects={[]}
        loading={false}
        games={[]}
        gamesLoading={false}
        onSelectProject={vi.fn()}
        onCreateProject={vi.fn()}
        onRefreshProjects={vi.fn()}
        onDeleteProject={vi.fn()}
        onAnnotateWithFile={vi.fn()}
        onLoadGame={vi.fn()}
        onDeleteGame={vi.fn()}
        onFetchGames={vi.fn()}
        {...props}
      />
    </AppStateProvider>
  );
}

const clipsTab = () => screen.getByRole('button', { name: /^In Progress Clips/i });
const mp4 = (name) => new File(['bytes'], name, { type: 'video/mp4' });

describe('ProjectManager Add Video flow (T8380)', () => {
  beforeEach(() => {
    uploadClipsMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    window.history.replaceState(null, '', '/home/reels');
    useGalleryStore.setState({ isOpen: false });
  });

  it('gates the file picker behind the consequence notice (does not upload on the button click)', async () => {
    renderOnClipsTab();
    fireEvent.click(clipsTab());

    fireEvent.click(await screen.findByRole('button', { name: 'Add Video' }));

    // The notice appears; nothing has been uploaded yet.
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText(/won’t be linked to a game/i)).toBeTruthy();
    expect(uploadClipsMock).not.toHaveBeenCalled();

    // Cancel closes it without uploading.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(uploadClipsMock).not.toHaveBeenCalled();
  });

  it('Continue -> selecting files uploads the whole batch, and success toasts the count', async () => {
    uploadClipsMock.mockResolvedValue({
      results: [{ ok: true, raw_clip_id: 1, project_id: 10 }, { ok: true, raw_clip_id: 2, project_id: 11 }],
      charged: 4,
      balance: 6,
    });
    renderOnClipsTab();
    fireEvent.click(clipsTab());
    fireEvent.click(await screen.findByRole('button', { name: 'Add Video' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    const input = screen.getByTestId('clip-upload-input');
    fireEvent.change(input, { target: { files: [mp4('a.mp4'), mp4('b.mp4')] } });

    await waitFor(() => expect(uploadClipsMock).toHaveBeenCalledTimes(1));
    const passed = uploadClipsMock.mock.calls[0][0];
    expect(passed.map((f) => f.name)).toEqual(['a.mp4', 'b.mp4']);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Added 2 clips (4 credits)'));
  });

  it('a file that fails to reach R2 surfaces a Retry that re-runs just that file', async () => {
    uploadClipsMock.mockResolvedValue({
      results: [{ ok: false, original_filename: 'bad.mp4', error: 'network' }],
      charged: 0,
      balance: null,
    });
    renderOnClipsTab();
    fireEvent.click(clipsTab());
    fireEvent.click(await screen.findByRole('button', { name: 'Add Video' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    fireEvent.change(screen.getByTestId('clip-upload-input'), { target: { files: [mp4('bad.mp4')] } });

    // The rail shows the failed file with a Retry (never a silent loss).
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByTestId('clip-uploading-rail')).toBeTruthy();
    expect(screen.getByText('bad.mp4')).toBeTruthy();

    // Retry re-invokes the upload for just that file.
    uploadClipsMock.mockClear();
    fireEvent.click(retry);
    await waitFor(() => expect(uploadClipsMock).toHaveBeenCalledTimes(1));
    expect(uploadClipsMock.mock.calls[0][0].map((f) => f.name)).toEqual(['bad.mp4']);
  });

  it('Add Video also appears as an action row when clips already exist', async () => {
    renderOnClipsTab({ projects: [{ id: 7, name: 'A clip', game_ids: [], is_auto_created: true }] });
    // Lands on Clips (drafts present); the action-row button carries the anchor.
    const addVideo = await screen.findByRole('button', { name: 'Add Video' });
    expect(addVideo.getAttribute('data-tutorial-target')).toBe('clips-add-video');
  });
});
