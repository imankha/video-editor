// T14570: resuming an upload with a differently named file asks in an in-app dialog.
// ProjectManager owns the resume file picker, so "Pick another" reopens it.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppStateProvider } from '../contexts';

// jsdom lacks IntersectionObserver (used by the games-grid cache-warming effect).
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver = MockIntersectionObserver;

// jsdom lacks matchMedia (useIsMobile) — stub it.
vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
  useIsCoarsePointer: () => false,
  useIsLandscape: () => false,
}));

// Store mocks — ProjectManager only reads a few fields from each.
vi.mock('../stores/settingsStore', () => ({
  useGuidanceSettings: () => ({ coachEnabled: false }),
  useSettingsStore: () => ({
    settings: { projectFilters: { statusFilter: 'all', aspectFilter: 'all', creationFilter: 'all' } },
    setStatusFilter: vi.fn(),
    setAspectFilter: vi.fn(),
    setCreationFilter: vi.fn(),
  }),
}));
vi.mock('../stores/authStore', () => {
  const state = { requireAuth: vi.fn(), isAuthenticated: false };
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

// Stub the header chrome + tiles so their own store usage doesn't leak into this test.
vi.mock('./Logo', () => ({ LogoWithText: () => <div />, Logo: () => <div />, default: () => <div /> }));
vi.mock('./CreditBalance', () => ({ CreditBalance: () => <div /> }));
vi.mock('./InstallButton', () => ({ InstallButton: () => <div /> }));
vi.mock('./SignInButton', () => ({ SignInButton: () => <div />, default: () => <div /> }));
vi.mock('./ProfileSportButton', () => ({ ProfileSportButton: () => <div />, default: () => <div /> }));
vi.mock('./ProfileDropdown', () => ({ ProfileDropdown: () => <div /> }));
vi.mock('./GameTile', () => ({ GameTile: () => <div data-testid="game-tile" /> }));
vi.mock('./UploadingGameTile', () => ({
  UploadingGameTile: ({ onResume }) => <button type="button" data-testid="resume-tile" onClick={onResume}>Resume</button>,
}));
vi.mock('./ReferenceGameCard', () => ({ ReferenceGameCard: () => <div data-testid="reference-card" /> }));
// DraftTile echoes the project id/name so tests can assert WHICH drafts rendered
// (single-clip drafts in the Clips gallery, legacy multi-clip drafts in the
// Legacy reels group).
vi.mock('./DraftTile', () => ({
  DraftTile: (props) => (
    <div data-testid="draft-tile" data-project-id={props.project?.id}>
      {props.project?.name}
    </div>
  ),
  default: () => <div />,
}));
vi.mock('./PublishedReelsPanel', () => ({
  PublishedReelsPanel: (props) => (
    <div data-testid="published-tab-panel" data-active={String(!!props.active)} />
  ),
}));

import { ProjectManager } from './ProjectManager';

const APP_STATE = { unseenReelsCount: 0, exportingProject: null };

function renderManager(props = {}, path = '/home') {
  window.history.replaceState(null, '', path);
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

const BODY = 'This file has a different name than the one you started with. Is it the same video?';
const PENDING = [{ session_id: 's1', original_filename: 'game.mp4' }];

describe('ProjectManager resume with a different file name (T14570)', () => {
  let pickerClick;
  let resumeInput;

  beforeEach(() => {
    pickerClick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function record() { resumeInput = this; });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  function pick(name, onResumeUpload) {
    renderManager({ games: [], pendingUploads: PENDING, onResumeUpload, onCancelPendingUpload: vi.fn() }, '/home/games');
    fireEvent.click(screen.getByTestId('resume-tile'));
    const file = new File(['x'], name, { type: 'video/mp4' });
    fireEvent.change(resumeInput, { target: { files: [file] } });
    return file;
  }

  it('T14570:C6 a different name asks first and does not resume yet', () => {
    const onResumeUpload = vi.fn();
    pick('renamed.mp4', onResumeUpload);
    expect(screen.getByText(BODY)).toBeTruthy();
    expect(onResumeUpload).not.toHaveBeenCalled();
  });

  it('T14570:C6 "Yes, use it" resumes with the chosen file', () => {
    const onResumeUpload = vi.fn();
    const file = pick('renamed.mp4', onResumeUpload);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, use it' }));
    expect(onResumeUpload).toHaveBeenCalledTimes(1);
    expect(onResumeUpload).toHaveBeenCalledWith(file);
    expect(screen.queryByText(BODY)).toBeNull();
  });

  it('T14570:C6 "Pick another" reopens the picker, resumes nothing, and asks again on a second wrong name', () => {
    const onResumeUpload = vi.fn();
    pick('renamed.mp4', onResumeUpload);
    pickerClick.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Pick another' }));
    expect(pickerClick).toHaveBeenCalledTimes(1);
    expect(onResumeUpload).not.toHaveBeenCalled();
    expect(screen.queryByText(BODY)).toBeNull();
    fireEvent.change(resumeInput, { target: { files: [new File(['x'], 'other.mp4', { type: 'video/mp4' })] } });
    expect(screen.getByText(BODY)).toBeTruthy();
    expect(onResumeUpload).not.toHaveBeenCalled();
  });

  it('T14570:C6 closing the dialog cancels: nothing resumes and the picker stays shut', () => {
    const onResumeUpload = vi.fn();
    pick('renamed.mp4', onResumeUpload);
    pickerClick.mockClear();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText(BODY)).toBeNull();
    expect(onResumeUpload).not.toHaveBeenCalled();
    expect(pickerClick).not.toHaveBeenCalled();
  });

  it('T14570:C6 the same name resumes straight away with no dialog', () => {
    const onResumeUpload = vi.fn();
    const file = pick('game.mp4', onResumeUpload);
    expect(onResumeUpload).toHaveBeenCalledWith(file);
    expect(screen.queryByText(BODY)).toBeNull();
  });
});
