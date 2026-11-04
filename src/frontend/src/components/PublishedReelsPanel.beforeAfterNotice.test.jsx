// T14570: before/after failures show an in-app toast, never a native alert, and the
// toast never carries raw error text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';

const DOWNLOAD = vi.hoisted(() => ({ id: 8, project_id: 9, project_name: 'Play 1', filename: 'final_9.mp4', game_ids: [4] }));
const hoisted = vi.hoisted(() => ({
  onBeforeAfter: null,
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
    hoisted.onBeforeAfter = (e) => props.renderCard(DOWNLOAD).props.onBeforeAfter(e, DOWNLOAD);
    return <div data-testid="collections-tab" />;
  },
}));
vi.mock('./ranking/ConfidenceBanner', () => ({ ConfidenceBanner: () => null }));
vi.mock('./ranking/RankingGame', () => ({ RankingGame: () => null }));
vi.mock('./introcards/IntroStoryPlayer', () => ({ IntroStoryPlayer: () => null }));

import { PublishedReelsPanel } from './PublishedReelsPanel';
import { useProfileStore } from '../stores/profileStore';

import { useToastStore } from './shared/Toast';
import { ERROR_COPY } from '../config/displayNames';

const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title);

function mockApi({ status, generate }) {
  globalThis.apiFetchImpl = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/before-after/') && u.endsWith('/status')) return { ok: true, json: async () => status };
    if (u.includes('/before-after/')) return generate();
    if (u.endsWith('/projects')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({ count: 0, unwatched_count: 0 }) };
  });
}

async function tapBeforeAfter() {
  render(<PublishedReelsPanel active onOpenProject={vi.fn()} />);
  await waitFor(() => expect(hoisted.onBeforeAfter).toBeTruthy());
  await act(async () => { await hoisted.onBeforeAfter({ stopPropagation: () => {} }); });
}

describe('PublishedReelsPanel before/after notices (T14570)', () => {
  beforeEach(() => {
    hoisted.onBeforeAfter = null;
    useToastStore.setState({ toasts: [] });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useProfileStore.setState({ profiles: [{ id: 'p1', isCurrent: true }], currentProfileId: 'p1' });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('T14570:C4 an unavailable comparison toasts and generates nothing', async () => {
    mockApi({ status: { available: false, error: 'no working video row' }, generate: vi.fn() });
    await tapBeforeAfter();
    expect(toastTitles()).toEqual([ERROR_COPY.COMPARISON_UNAVAILABLE]);
    expect(window.alert).not.toHaveBeenCalled();
    expect(globalThis.apiFetchImpl.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(false);
  });

  it('T14570:C5 a thrown generate error toasts fixed copy, not its message', async () => {
    mockApi({ status: { available: true }, generate: () => { throw new Error('ffmpeg exited with code 1'); } });
    await tapBeforeAfter();
    expect(toastTitles()).toEqual([ERROR_COPY.COMPARISON]);
    expect(window.alert).not.toHaveBeenCalled();
  });
});
