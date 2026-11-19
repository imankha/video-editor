import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppStateProvider } from '../contexts';

// T17760: a play upload charges credits, so the price is shown before anything uploads.
// The notice states the rule before the picker opens; after the pick, a confirm dialog shows
// the total for the whole batch (one charge on summed bytes, mirroring clips.py
// upload_clips_batch -> calculate_storage_cost) and the upload starts only on its Upload click.

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

// T13247: a zip of clips on Add Clip. jsdom's Blob cannot be sliced into bytes, so the zip
// reader is stubbed (the real unzip is covered by utils/zipClips.test.js).
const { zipEntries } = vi.hoisted(() => ({ zipEntries: { current: [] } }));
vi.mock('../utils/veoHighlights', async (importOriginal) => ({
  ...(await importOriginal()),
  readZipEntries: vi.fn(async () => zipEntries.current),
  extractEntry: vi.fn(async (zip, entry, type) => new File(['v'], entry.name, { type })),
}));

// T17500: startClipUpload probes each file for a drawable picture; jsdom's <video>
// never loads, so the probe is stubbed to "drawable" (covered by
// ProjectManager.clipPictureUnsupported.test.jsx).
vi.mock('../utils/videoMetadata', async (importOriginal) => ({
  ...(await importOriginal()),
  extractVideoMetadata: vi.fn(async () => ({ width: 1920, height: 1080, duration: 10 })),
}));

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

const clipsTab = () => screen.getByRole('button', { name: /^Plays/i });

import { useCreditStore } from '../stores/creditStore';

const MB = 1024 ** 2;
const sized = (name, bytes) => {
  const f = new File(['bytes'], name, { type: 'video/mp4' });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
};

async function pickFiles(files) {
  renderOnClipsTab();
  fireEvent.click(clipsTab());
  fireEvent.click(await screen.findByRole('button', { name: 'Upload a play' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.change(screen.getByTestId('clip-upload-input'), { target: { files } });
}

describe('T17760 play upload shows its price before charging', () => {
  beforeEach(() => {
    uploadClipsMock.mockReset();
    uploadClipsMock.mockResolvedValue({ results: [], charged: 0, balance: null });
    toastInfo.mockReset();
    useGalleryStore.setState({ isOpen: false });
    useCreditStore.setState({ balance: 51, loaded: true });
  });

  it('the notice states the upload price before the picker opens', async () => {
    renderOnClipsTab();
    fireEvent.click(clipsTab());
    fireEvent.click(await screen.findByRole('button', { name: 'Upload a play' }));
    expect(screen.getByRole('alertdialog').textContent).toMatch(/1 credit per GB/);
  });

  it('a picked file waits on a confirm showing its cost; Upload starts the charged upload', async () => {
    await pickFiles([sized('a.mp4', 5 * MB)]);
    const dialog = await screen.findByTestId('clip-upload-cost');
    expect(dialog.textContent).toContain('Cost: 1 credit');
    expect(dialog.textContent).toContain('Balance: 51 credits');
    expect(uploadClipsMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(uploadClipsMock).toHaveBeenCalledTimes(1));
    expect(uploadClipsMock.mock.calls[0][0].map((f) => f.name)).toEqual(['a.mp4']);
    expect(toastInfo).toHaveBeenCalledWith('Uploading a.mp4...');
  });

  it('the total covers every file in the batch on summed bytes (3 x 400MB = 2 credits)', async () => {
    await pickFiles([sized('a.mp4', 400 * MB), sized('b.mp4', 400 * MB), sized('c.mp4', 400 * MB)]);
    const dialog = await screen.findByTestId('clip-upload-cost');
    expect(dialog.textContent).toContain('Cost: 2 credits');
    expect(dialog.textContent).toMatch(/3 plays/);
  });

  it('Cancel on the confirm uploads nothing', async () => {
    await pickFiles([sized('a.mp4', 5 * MB), sized('b.mp4', 5 * MB)]);
    await screen.findByTestId('clip-upload-cost');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('clip-upload-cost')).toBeNull());
    expect(uploadClipsMock).not.toHaveBeenCalled();
  });
});
