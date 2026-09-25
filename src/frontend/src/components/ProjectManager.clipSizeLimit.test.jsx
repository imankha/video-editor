import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppStateProvider } from '../contexts';

// T10250 + T10260: the direct clip-upload UX hardening.
//  - T10250 pre-flight: a file over the server cap never enters the hash/upload
//    pipeline — it shows the ClipSizeLimitModal, and "Add Game instead" carries
//    the file into the Add Game flow. Refused server failures show the reason
//    inline with NO Retry; transient ones keep Retry.
//  - T10260 completion: a finished single upload opens straight into Framing when
//    the user is still on the Clips tab; if they navigated away it offers an
//    "Open" toast instead of yanking them.

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
vi.mock('../hooks/useClipUpload', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useClipUpload: () => ({
      uploadClips: uploadClipsMock,
      progressByFile: {},
      isUploading: false,
    }),
  };
});

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
// The Add Game modal is heavy (footage picker, apiFetch); stub it to a marker
// that echoes whether files were pre-seeded, which is all T10250 needs to assert.
vi.mock('./GameDetailsModal', () => ({
  GameDetailsModal: ({ isOpen, initialFiles }) =>
    isOpen ? <div data-testid="game-details-modal" data-prefill={(initialFiles || []).map((f) => f.name).join(',')} /> : null,
}));

import { ProjectManager } from './ProjectManager';
import { useGalleryStore } from '../stores/galleryStore';
import { useConfigStore } from '../stores/configStore';
import { CLIP_UPLOAD } from '../config/displayNames';

const APP_STATE = { unseenReelsCount: 0, exportingProject: null };
const CAP = 5 * 1024 * 1024; // 5MB test cap

function bytesFile(name, size) {
  // A File whose reported .size is `size` without allocating that many bytes.
  const f = new File(['x'], name, { type: 'video/mp4' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

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

const clipsTab = () => screen.getByRole('button', { name: /^Clips/i });

async function openPicker() {
  fireEvent.click(clipsTab());
  fireEvent.click(await screen.findByRole('button', { name: 'Upload clip' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  return screen.getByTestId('clip-upload-input');
}

describe('ProjectManager clip size limit + completion nav (T10250/T10260)', () => {
  beforeEach(() => {
    uploadClipsMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    window.history.replaceState(null, '', '/home/reels');
    useGalleryStore.setState({ isOpen: false });
    // Server cap hydrated (as bootstrap would) so the pre-flight gate is active.
    useConfigStore.setState({ maxClipUploadBytes: CAP, maxClipDurationS: 600 });
  });

  it('an over-cap file shows the size-limit dialog and never enters the upload pipeline (T10250)', async () => {
    renderOnClipsTab();
    const input = await openPicker();
    fireEvent.change(input, { target: { files: [bytesFile('huge.mp4', CAP + 1)] } });

    expect(await screen.findByTestId('clip-size-limit-modal')).toBeTruthy();
    expect(screen.getByText(CLIP_UPLOAD.sizeLimitBody(5))).toBeTruthy();
    // No hashing, no batch — the file was refused before the pipeline.
    expect(uploadClipsMock).not.toHaveBeenCalled();
  });

  it('"Add Game instead" carries the over-cap file into the Add Game flow (T10250)', async () => {
    renderOnClipsTab();
    const input = await openPicker();
    fireEvent.change(input, { target: { files: [bytesFile('huge.mp4', CAP + 1)] } });

    fireEvent.click(await screen.findByRole('button', { name: CLIP_UPLOAD.SIZE_LIMIT_ADD_GAME }));

    const gameModal = await screen.findByTestId('game-details-modal');
    expect(gameModal.getAttribute('data-prefill')).toBe('huge.mp4');
    // The size-limit dialog is dismissed once we hand off.
    expect(screen.queryByTestId('clip-size-limit-modal')).toBeNull();
  });

  it('a within-cap file uploads normally (pre-flight only gates over-cap) (T10250)', async () => {
    uploadClipsMock.mockResolvedValue({ results: [{ ok: true, project_id: 3 }], charged: 1, balance: 9 });
    renderOnClipsTab();
    const input = await openPicker();
    fireEvent.change(input, { target: { files: [bytesFile('ok.mp4', CAP - 1)] } });

    await waitFor(() => expect(uploadClipsMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('clip-size-limit-modal')).toBeNull();
  });

  it('a refused server failure shows the reason inline with NO Retry (T10250)', async () => {
    uploadClipsMock.mockResolvedValue({
      results: [{ ok: false, original_filename: 'long.mp4', code: 'duration_exceeds_cap', retryable: false }],
      charged: 0,
      balance: null,
    });
    renderOnClipsTab();
    const input = await openPicker();
    fireEvent.change(input, { target: { files: [bytesFile('long.mp4', 1024)] } });

    // The server reason (parameterized by the 600s => 10-minute cap) is visible.
    expect(await screen.findByText(/10-minute limit/i)).toBeTruthy();
    // Refused rows never offer a Retry.
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    // A batch-coded refusal (duration cap) is NOT the over-cap "too large" popup.
    expect(screen.queryByTestId('clip-upload-too-large-modal')).toBeNull();
  });

  it('a prepare-upload over-cap refusal that missed pre-flight pops the "too large" modal with Games/Upload game instructions (T10310)', async () => {
    // Shape mirrors ensureVideoInR2's prepare-upload 400 refusal — no `.code`
    // (batch-coded refusals like duration_exceeds_cap always have one), which is
    // the signal runClipUpload uses to detect this class regardless of whether
    // maxClipUploadBytes had hydrated by pick time.
    uploadClipsMock.mockResolvedValue({
      results: [{ ok: false, original_filename: 'huge.mp4', error: CLIP_UPLOAD.sizeLimitBody(5), retryable: false }],
      charged: 0,
      balance: null,
    });
    renderOnClipsTab();
    const input = await openPicker();
    fireEvent.change(input, { target: { files: [bytesFile('huge.mp4', 1024)] } });

    const modal = await screen.findByTestId('clip-upload-too-large-modal');
    const withinModal = within(modal);
    expect(withinModal.getByText(CLIP_UPLOAD.postUploadTooLargeBody(5))).toBeTruthy();
    expect(withinModal.getByText('huge.mp4')).toBeTruthy();

    fireEvent.click(withinModal.getByRole('button', { name: CLIP_UPLOAD.POST_UPLOAD_TOO_LARGE_DISMISS }));
    expect(screen.queryByTestId('clip-upload-too-large-modal')).toBeNull();
  });

  it('a finished single upload opens the clip in Framing while on the Clips tab (T10260)', async () => {
    const onSelectProjectWithMode = vi.fn();
    uploadClipsMock.mockResolvedValue({
      results: [{ ok: true, project_id: 55 }],
      charged: 1,
      balance: 9,
    });
    renderOnClipsTab({ onSelectProjectWithMode });
    const input = await openPicker();
    fireEvent.change(input, { target: { files: [bytesFile('clip.mp4', 1024)] } });

    await waitFor(() => expect(onSelectProjectWithMode).toHaveBeenCalledWith(55, { mode: 'framing' }));
  });

  it('navigating away mid-upload yields a toast with Open, not a forced navigation (T10260)', async () => {
    const onSelectProjectWithMode = vi.fn();
    let resolveUpload;
    uploadClipsMock.mockReturnValue(new Promise((res) => { resolveUpload = res; }));
    renderOnClipsTab({ onSelectProjectWithMode });
    const input = await openPicker();
    fireEvent.change(input, { target: { files: [bytesFile('clip.mp4', 1024)] } });

    // User leaves the Clips tab before the upload resolves.
    fireEvent.click(screen.getByRole('button', { name: /^Games/i }));
    resolveUpload({ results: [{ ok: true, project_id: 77 }], charged: 1, balance: 9 });

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    // No forced navigation.
    expect(onSelectProjectWithMode).not.toHaveBeenCalled();
    // The success toast carried an "Open" action instead.
    const opts = toastSuccess.mock.calls.at(-1)[1];
    expect(opts?.action?.label).toMatch(/Open/);
    opts.action.onClick();
    expect(onSelectProjectWithMode).toHaveBeenCalledWith(77, { mode: 'framing' });
  });
});
