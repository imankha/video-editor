import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppStateProvider } from '../contexts';

// T17500: a play uploaded directly as a clip from a file this browser can only play
// the sound of (iPhone HEVC without an HEVC decoder: real duration, 0x0 picture) gets
// the same message as a game upload and is never uploaded. The probe itself
// (extractVideoMetadata rejecting with VIDEO_PICTURE_UNSUPPORTED) is covered by
// utils/videoMetadata.pictureUnsupported.test.js; here it is stubbed per file name.

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
const toastInfo = vi.fn();
vi.mock('./shared/Toast', () => ({
  toast: {
    success: (...a) => toastSuccess(...a),
    error: (...a) => toastError(...a),
    info: (...a) => toastInfo(...a),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

const { probe } = vi.hoisted(() => ({ probe: { unsupported: new Set() } }));
vi.mock('../utils/videoMetadata', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    extractVideoMetadata: vi.fn(async (file) => {
      if (probe.unsupported.has(file.name)) throw new actual.VideoPictureUnsupportedError(file.name);
      return { width: 1920, height: 1080, duration: 10 };
    }),
  };
});

vi.mock('../stores/settingsStore', () => ({
  useGuidanceSettings: () => ({ coachEnabled: true }),
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
  const state = { currentProfileId: 'p1', profiles: [{ id: 'p1' }], isInitialized: true, switchProfile: vi.fn() };
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
import { UPLOAD } from '../config/displayNames';

const APP_STATE = { unseenReelsCount: 0, exportingProject: null };

function renderOnClipsTab() {
  window.history.replaceState(null, '', '/home/reels');
  return render(
    <AppStateProvider value={APP_STATE}>
      <ProjectManager
        projects={[]}
        loading={false}
        games={[]}
        gamesLoading={false}
        onSelectProject={vi.fn()}
        onRefreshProjects={vi.fn()}
        onDeleteProject={vi.fn()}
        onAnnotateWithFile={vi.fn()}
        onLoadGame={vi.fn()}
        onDeleteGame={vi.fn()}
        onFetchGames={vi.fn()}
      />
    </AppStateProvider>
  );
}

const mp4 = (name) => new File(['bytes'], name, { type: 'video/mp4' });

async function pickClipFiles(files) {
  fireEvent.click(screen.getByRole('button', { name: /^Plays/i }));
  fireEvent.click(await screen.findByRole('button', { name: 'Upload a play' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.change(screen.getByTestId('clip-upload-input'), { target: { files } });
}

describe('ProjectManager direct clip upload of a sound-only file (T17500)', () => {
  beforeEach(() => {
    uploadClipsMock.mockReset();
    uploadClipsMock.mockResolvedValue({ results: [{ ok: true, raw_clip_id: 1, project_id: 10 }], charged: 1, balance: 5 });
    toastSuccess.mockReset();
    toastError.mockReset();
    toastInfo.mockReset();
    probe.unsupported = new Set();
    useGalleryStore.setState({ isOpen: false });
  });

  it('refuses the file with the game-upload message and does not upload it', async () => {
    probe.unsupported = new Set(['iphone.mov']);
    renderOnClipsTab();
    await pickClipFiles([mp4('iphone.mov')]);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(UPLOAD.VIDEO_PICTURE_UNSUPPORTED));
    // The rail keeps a refused row carrying the same message (no Retry: the same bytes fail again).
    const rail = await screen.findByTestId('clip-uploading-rail');
    expect(rail.textContent).toContain('iphone.mov');
    expect(rail.textContent).toContain(UPLOAD.VIDEO_PICTURE_UNSUPPORTED);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(uploadClipsMock).not.toHaveBeenCalled();
  });

  it('uploads the drawable files of a mixed pick and refuses only the sound-only one', async () => {
    probe.unsupported = new Set(['iphone.mov']);
    renderOnClipsTab();
    await pickClipFiles([mp4('iphone.mov'), mp4('h264.mp4')]);
    fireEvent.click(await screen.findByTestId('clip-upload-cost-confirm')); // T17760 price confirm

    await waitFor(() => expect(uploadClipsMock).toHaveBeenCalledTimes(1));
    expect(uploadClipsMock.mock.calls[0][0].map((f) => f.name)).toEqual(['h264.mp4']);
    expect(toastError).toHaveBeenCalledWith(UPLOAD.VIDEO_PICTURE_UNSUPPORTED);
  });

  it('an H.264 file shows no message and uploads as before', async () => {
    renderOnClipsTab();
    await pickClipFiles([mp4('h264.mp4')]);
    fireEvent.click(await screen.findByTestId('clip-upload-cost-confirm')); // T17760 price confirm

    await waitFor(() => expect(uploadClipsMock).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalled();
    expect(screen.queryByText(UPLOAD.VIDEO_PICTURE_UNSUPPORTED)).toBeNull();
  });
});
