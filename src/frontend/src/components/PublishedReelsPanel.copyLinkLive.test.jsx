// T13620: a reel link is LIVE (user decision 2026-10-27). The one-tap Copy link
// skips the share dialog, so its toast is the only place the sharer learns that.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../utils/apiFetch', () => ({
  default: (...args) => globalThis.apiFetchImpl(...args),
}));

const captured = vi.hoisted(() => ({ onCopyCollectionLink: null, success: vi.fn() }));

vi.mock('./shared/Toast', () => ({ toast: { success: captured.success, error: vi.fn() } }));

vi.mock('../hooks/useDownloads', () => ({
  useDownloads: () => ({
    downloads: [], deleteDownload: vi.fn(), downloadFile: vi.fn(), downloadingId: null,
    renameDownload: vi.fn(), setIntroCard: vi.fn(), pruneDanglingIntroCards: vi.fn(),
    markWatched: vi.fn(), formatDate: () => '',
  }),
}));

vi.mock('../hooks/useCollections', () => ({
  useCollections: () => ({
    summary: null, summaryState: 'ready', members: {}, memberStates: {},
    fetchSummary: vi.fn(), fetchMembers: vi.fn(), removeMember: vi.fn(),
    patchMember: vi.fn(), resortMembers: vi.fn(), pruneDanglingIntroCards: vi.fn(),
  }),
}));

vi.mock('./collections/CollectionsTab', () => ({
  CollectionsTab: (props) => {
    captured.onCopyCollectionLink = props.onCopyCollectionLink;
    return <div data-testid="collections-tab" />;
  },
}));
vi.mock('./ranking/ConfidenceBanner', () => ({ ConfidenceBanner: () => null }));
vi.mock('./ranking/RankingGame', () => ({ RankingGame: () => null }));
vi.mock('./introcards/IntroStoryPlayer', () => ({ IntroStoryPlayer: () => null }));

import { PublishedReelsPanel } from './PublishedReelsPanel';
import { useProfileStore } from '../stores/profileStore';

describe('T13620 Copy link on a reel says the link is live', () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    useProfileStore.setState({ profiles: [{ id: 'p1', isCurrent: true }], currentProfileId: 'p1' });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue() }, configurable: true });
    globalThis.apiFetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ shares: [{ share_token: 'tok' }] }) }));
    captured.success.mockClear();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
    cleanup();
  });

  it('T13620:C1 the copied-link toast tells the sharer the link updates as highlights are added', async () => {
    render(<PublishedReelsPanel active onOpenProject={() => {}} />);
    await screen.findByTestId('collections-tab');
    await captured.onCopyCollectionLink({ scope: { type: 'top' } });
    expect(captured.success).toHaveBeenCalledTimes(1);
    const [, opts] = captured.success.mock.calls[0];
    expect(opts.message).toMatch(/updates as (new )?highlights are added/i);
  });
});
