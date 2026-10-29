// T13870 (sync matrix S9a, 2026-10-28): a 503 sync_failed restore already unpublished
// the reel locally and does NOT navigate, so the panel must apply the same member
// change events delete does -- drop the tile and refresh the summary aggregate --
// instead of leaving the restored reel in the Finished list until a reload.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';

const DOWNLOAD = vi.hoisted(() => ({ id: 8, project_id: 9, project_name: 'Play 1', filename: 'final_9.mp4', game_ids: [4] }));
const hoisted = vi.hoisted(() => ({
  onOpenProject: null,
  removeMember: vi.fn(),
  fetchSummary: vi.fn(),
}));

vi.mock('../utils/apiFetch', () => ({
  default: (...args) => globalThis.apiFetchImpl(...args),
}));
vi.mock('../utils/reelReEditable', () => ({ canReEditReel: () => true }));

vi.mock('../hooks/useDownloads', () => ({
  useDownloads: () => ({
    downloads: [],
    deleteDownload: vi.fn(),
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
    fetchSummary: hoisted.fetchSummary, fetchMembers: vi.fn(), removeMember: hoisted.removeMember,
    patchMember: vi.fn(), resortMembers: vi.fn(), pruneDanglingIntroCards: vi.fn(),
  }),
}));

vi.mock('./collections/CollectionsTab', () => ({
  CollectionsTab: (props) => {
    hoisted.onOpenProject = props.renderCard(DOWNLOAD).props.onOpenProject;
    return <div data-testid="collections-tab" />;
  },
}));
vi.mock('./ranking/ConfidenceBanner', () => ({ ConfidenceBanner: () => null }));
vi.mock('./ranking/RankingGame', () => ({ RankingGame: () => null }));
vi.mock('./introcards/IntroStoryPlayer', () => ({ IntroStoryPlayer: () => null }));

import { PublishedReelsPanel } from './PublishedReelsPanel';
import { useProfileStore } from '../stores/profileStore';

// Route by URL (positional fetch mocks break under fire-and-forget beacons).
function mockApi(restoreResponse) {
  globalThis.apiFetchImpl = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/restore-project')) return restoreResponse;
    if (u.endsWith('/projects')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({ count: 0, unwatched_count: 0 }) };
  });
}

describe('PublishedReelsPanel: Open as Draft that cannot reach the cloud (T13870)', () => {
  let navigate;
  beforeEach(() => {
    hoisted.removeMember.mockReset();
    hoisted.fetchSummary.mockReset();
    navigate = vi.fn();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useProfileStore.setState({ profiles: [{ id: 'p1', isCurrent: true }], currentProfileId: 'p1' });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  async function openAsDraft() {
    render(<PublishedReelsPanel active onOpenProject={navigate} />);
    await waitFor(() => expect(hoisted.onOpenProject).toBeTruthy());
    await act(async () => { await hoisted.onOpenProject({ stopPropagation: () => {} }, DOWNLOAD); });
  }

  it('T13870:C3 503 sync_failed: the tile leaves the list and the summary refreshes, no navigation', async () => {
    mockApi({ ok: false, status: 503, json: async () => ({ code: 'sync_failed' }) });
    await openAsDraft();
    await waitFor(() => expect(hoisted.removeMember).toHaveBeenCalledWith(DOWNLOAD.id));
    expect(hoisted.fetchSummary).toHaveBeenCalledWith('restore');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('T13870:C3 a 404 restore leaves the member list untouched', async () => {
    mockApi({ ok: false, status: 404, json: async () => ({ detail: 'Project archive not found' }) });
    await openAsDraft();
    expect(hoisted.removeMember).not.toHaveBeenCalled();
    expect(hoisted.fetchSummary).not.toHaveBeenCalled();
  });
});
