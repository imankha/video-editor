// T13680: deleting a finished highlight asks with an in-app dialog that names
// the highlight (project_name), never a native confirm with the raw file name.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';

const DOWNLOAD = vi.hoisted(() => ({ id: 8, project_name: 'Play 1', filename: 'final_9_b251cb00.mp4' }));
const hoisted = vi.hoisted(() => ({
  onDelete: null,
  deleteDownload: vi.fn(),
  removeMember: vi.fn(),
}));

vi.mock('../utils/apiFetch', () => ({
  default: (...args) => globalThis.apiFetchImpl(...args),
}));

vi.mock('../hooks/useDownloads', () => ({
  useDownloads: () => ({
    downloads: [],
    deleteDownload: hoisted.deleteDownload,
    downloadFile: vi.fn(),
    downloadingId: null,
    renameDownload: vi.fn(),
    setIntroCard: vi.fn(),
    pruneDanglingIntroCards: vi.fn(),
    markWatched: vi.fn(),
    formatDate: () => '',
  }),
}));

vi.mock('../hooks/useCollections', () => ({
  useCollections: () => ({
    summary: null, summaryState: 'ready', members: {}, memberStates: {},
    fetchSummary: vi.fn(), fetchMembers: vi.fn(), removeMember: hoisted.removeMember,
    patchMember: vi.fn(), resortMembers: vi.fn(), pruneDanglingIntroCards: vi.fn(),
  }),
}));

vi.mock('./collections/CollectionsTab', () => ({
  CollectionsTab: (props) => {
    hoisted.onDelete = props.renderCard(DOWNLOAD).props.onDelete;
    return <div data-testid="collections-tab" />;
  },
}));
vi.mock('./ranking/ConfidenceBanner', () => ({ ConfidenceBanner: () => null }));
vi.mock('./ranking/RankingGame', () => ({ RankingGame: () => null }));
vi.mock('./introcards/IntroStoryPlayer', () => ({ IntroStoryPlayer: () => null }));

import { PublishedReelsPanel } from './PublishedReelsPanel';
import { useProfileStore } from '../stores/profileStore';

const inAct = (fn) => act(async () => { await fn(); });

describe('PublishedReelsPanel delete confirm (T13680)', () => {
  let confirmSpy;

  beforeEach(() => {
    hoisted.deleteDownload.mockReset();
    hoisted.removeMember.mockReset();
    useProfileStore.setState({ profiles: [{ id: 'p1', isCurrent: true }], currentProfileId: 'p1' });
    globalThis.apiFetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
    cleanup();
  });

  async function openDelete() {
    render(<PublishedReelsPanel active onOpenProject={() => {}} />);
    await screen.findByTestId('collections-tab');
    await waitFor(() => expect(hoisted.onDelete).toBeTruthy());
    await inAct(() => hoisted.onDelete({ stopPropagation: () => {} }, DOWNLOAD));
  }

  it('T13680:C1 names the highlight in an in-app dialog, not window.confirm or the file name', async () => {
    await openDelete();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await screen.findByText(/Delete "Play 1"\?/)).toBeTruthy();
    expect(screen.queryByText(/final_9_b251cb00/)).toBeNull();
    expect(screen.getByText(/can't be undone/i)).toBeTruthy();
    expect(screen.getByText(/share links/i)).toBeTruthy();
    expect(hoisted.deleteDownload).not.toHaveBeenCalled();
  });

  it('T13680:C1 Cancel keeps the highlight; Delete removes it', async () => {
    await openDelete();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(hoisted.deleteDownload).not.toHaveBeenCalled();
    expect(screen.queryByText(/Delete "Play 1"\?/)).toBeNull();

    await inAct(() => hoisted.onDelete({ stopPropagation: () => {} }, DOWNLOAD));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(hoisted.deleteDownload).toHaveBeenCalledWith(8, true));
    expect(hoisted.removeMember).toHaveBeenCalledWith(8);
  });
});
