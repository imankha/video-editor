// T12790: dialog guide sentences (group B): share dialogs, shared-video viewer, tutorial video.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';
import { GUIDE } from '../config/displayNames';
import { ShareGameModal } from './ShareGameModal';
import { CollectionShareModal } from './CollectionShareModal';
import { ShareWithTeammatesModal } from './ShareWithTeammatesModal';
import { SharePlaybackDialog } from './SharePlaybackDialog';
import { SharedVideoOverlay } from './SharedVideoOverlay';
import { TutorialVideoModal } from './TutorialVideoModal';

vi.mock('./shared/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock('../utils/apiFetch', () => ({
  default: (...args) => globalThis.apiFetchImpl(...args),
}));

vi.mock('./shared/UserPicker', () => ({
  UserPicker: ({ emails, onChange }) => (
    <button data-testid="add-email" onClick={() => onChange([...emails, 'a@test.com'])}>add</button>
  ),
}));

vi.mock('./introcards/IntroCardCarousel', () => ({ IntroCardCarousel: () => <div /> }));
vi.mock('./MediaPlayer', () => ({ MediaPlayer: () => <div data-testid="player" /> }));
vi.mock('./BrandedEndCard', () => ({ BrandedEndCard: () => null }));
vi.mock('./introcards/IntroPreRoll', () => ({ IntroPreRoll: () => null }));
vi.mock('./SharePageInstallBanner', () => ({ SharePageInstallBanner: () => null }));
vi.mock('./shared/VideoControls', () => ({ VideoControls: () => null }));
vi.mock('./shared/VideoLoadingOverlay', () => ({ VideoLoadingOverlay: () => null }));
vi.mock('../hooks/useStandaloneVideo', async () => {
  const React = await import('react');
  return {
    useStandaloneVideo: () => ({
      videoRef: React.createRef(),
      isPlaying: false, currentTime: 0, duration: 0, volume: 1, isMuted: false, hasAudio: true, isLoading: false,
      play: vi.fn(), togglePlay: vi.fn(), seek: vi.fn(), seekForward: vi.fn(), seekBackward: vi.fn(),
      setVolume: vi.fn(), toggleMute: vi.fn(), handlers: {},
    }),
  };
});

const ok = (data) => ({ ok: true, status: 200, json: async () => data });
// The sentence only: the card also holds its Got it button.
const guideText = () => screen.getByTestId('modal-guide').querySelector('p').textContent;
const pulsing = (id) => screen.getByTestId(id).className;

beforeEach(() => {
  cleanup();
  useSettingsStore.setState((st) => ({
    settings: { ...st.settings, guidance: { ...st.settings.guidance, coachEnabled: true } },
  }));
  useAuthStore.setState({ isAuthenticated: false });
  globalThis.apiFetchImpl = vi.fn(async (url) => {
    if (url.includes('/contacts')) return ok({ contacts: [] });
    if (url.includes('/teammate-emails')) return ok({});
    return ok({});
  });
});

describe('dialog guides, group B', () => {
  it('share-game: sentence and pulsing submit', async () => {
    render(<ShareGameModal gameId={1} gameName="G" onClose={() => {}} />);
    expect(guideText()).toBe(GUIDE.modal.shareGame);
    fireEvent.click(screen.getByTestId('add-email'));
    await waitFor(() => expect(pulsing('share-game-submit')).toContain('coach-target-pulse'));
  });

  it('collection-share: form then done', async () => {
    render(<CollectionShareModal definition={{}} title="T" onClose={() => {}} />);
    expect(guideText()).toBe(GUIDE.modal.collectionShare);
    fireEvent.click(screen.getByTestId('add-email'));
    await waitFor(() => expect(pulsing('collection-share-submit')).toContain('coach-target-pulse'));
    globalThis.apiFetchImpl = vi.fn(async (url) => (url.includes('/collections/share')
      ? ok({ shares: [{ share_token: 't', email_sent: null }] }) : ok({ contacts: [] })));
    fireEvent.click(screen.getByTestId('collection-share-submit'));
    await waitFor(() => expect(guideText()).toBe(GUIDE.modal.collectionShareDone));
  });

  it('teammates: unsent and all shared', async () => {
    const props = { tagCounts: { Jake: 2 }, tagClipIds: { Jake: [1, 2] }, gameId: 1, onClose: () => {}, onSharedTagsChange: () => {} };
    const { unmount } = render(<ShareWithTeammatesModal {...props} sharedTagData={{}} />);
    await waitFor(() => expect(guideText()).toBe(GUIDE.modal.teammates));
    await waitFor(() => expect(pulsing('teammates-share-submit')).toBeTruthy());
    unmount();
    render(<ShareWithTeammatesModal {...props} sharedTagData={{ Jake: new Set([1, 2]) }} />);
    await waitFor(() => expect(guideText()).toBe(GUIDE.modal.teammatesDone));
  });

  it('share-playback: form and error', async () => {
    const { unmount } = render(<SharePlaybackDialog gameId={1} gameName="G" onClose={() => {}} />);
    expect(guideText()).toBe(GUIDE.modal.sharePlayback);
    fireEvent.click(screen.getByTestId('add-email'));
    await waitFor(() => expect(pulsing('share-playback-submit')).toContain('coach-target-pulse'));
    unmount();
    render(<SharePlaybackDialog gameId={null} gameName="G" onClose={() => {}} />);
    expect(guideText()).toBe(GUIDE.modal.sharePlaybackError);
  });

  it('shared-video: ready, sign-in, error, loading', async () => {
    globalThis.apiFetchImpl = vi.fn(async () => ok({ video_url: '', video_name: 'v' }));
    globalThis.fetch = vi.fn(async () => ({}));
    const a = render(<SharedVideoOverlay shareToken="t" onClose={() => {}} />);
    expect(screen.queryByTestId('modal-guide')).toBeNull();
    await waitFor(() => expect(guideText()).toBe(GUIDE.modal.sharedVideo));
    a.unmount();

    globalThis.apiFetchImpl = vi.fn(async () => ({ ok: false, status: 403 }));
    const b = render(<SharedVideoOverlay shareToken="t" onClose={() => {}} />);
    await waitFor(() => expect(guideText()).toBe(GUIDE.modal.sharedVideoSignIn));
    expect(pulsing('shared-video-sign-in')).toContain('coach-target-pulse');
    b.unmount();

    globalThis.apiFetchImpl = vi.fn(async () => ({ ok: false, status: 404 }));
    render(<SharedVideoOverlay shareToken="t" onClose={() => {}} />);
    await waitFor(() => expect(guideText()).toBe(GUIDE.modal.sharedVideoError));
  });

  it('tutorial-video: sentence below the caption strip', () => {
    render(<TutorialVideoModal questId="quest_1" assets={{ videoUrl: 'v', vttUrl: 'v', chaptersUrl: 'c' }} onClose={() => {}} />);
    expect(guideText()).toBe(GUIDE.modal.tutorialVideo);
  });
});
