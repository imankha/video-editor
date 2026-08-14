import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook } from '@testing-library/react';

vi.mock('../../utils/apiFetch', () => ({ default: vi.fn() }));
import apiFetch from '../../utils/apiFetch';
import { useDownloads } from '../../hooks/useDownloads';

// T4945: the collection Download gesture. CollectionHeader enables the menu
// item only when onDownload is supplied and spins it while a download is in
// flight; CollectionCard owns the busy flag and folds the same budget the
// share/copy-link actions use into the definition it hands the caller.

import { CollectionHeader } from './CollectionHeader';
import { CollectionCard } from './CollectionCard';

const openMenu = () => {
  // The "..." menu button is titled "More actions".
  fireEvent.click(screen.getByTitle('More actions'));
};

describe('CollectionHeader download menu item', () => {
  it('is disabled (Coming soon) when onDownload is omitted', () => {
    render(<CollectionHeader title="Top Plays" ratio="9:16" reelCount={3} onPlayAll={() => {}} />);
    openMenu();
    const item = screen.getByText('Download').closest('button');
    expect(item.disabled).toBe(true);
  });

  it('is enabled and fires onDownload when provided', () => {
    const onDownload = vi.fn();
    render(
      <CollectionHeader title="Top Plays" ratio="9:16" reelCount={3}
        onPlayAll={() => {}} onDownload={onDownload} />,
    );
    openMenu();
    const item = screen.getByText('Download').closest('button');
    expect(item.disabled).toBe(false);
    fireEvent.click(item);
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('shows a spinning "Downloading…" state while in flight', () => {
    render(
      <CollectionHeader title="Top Plays" ratio="9:16" reelCount={3}
        onPlayAll={() => {}} onDownload={() => {}} downloadLoading />,
    );
    openMenu();
    const item = screen.getByText('Downloading…').closest('button');
    expect(item.disabled).toBe(true);
    expect(item.querySelector('.animate-spin')).toBeTruthy();
  });
});

describe('CollectionCard download gesture', () => {
  const baseProps = {
    title: 'Top Plays',
    ratio: '9:16',
    reelCount: 3,
    ratioDuration: 100,
    hasNullDurations: false,
    requestMembers: vi.fn(async () => []),
    onPlay: vi.fn(),
    shareDefinition: { scope: { type: 'game', game_id: 7 }, filter: {}, aspect_ratio: '9:16' },
  };

  beforeEach(() => vi.clearAllMocks());

  it('passes the share definition to onDownload (no budget when untrimmed)', async () => {
    const onDownload = vi.fn(async () => {});
    render(<CollectionCard {...baseProps} onDownload={onDownload} />);
    openMenu();
    fireEvent.click(screen.getByText('Download').closest('button'));
    await waitFor(() => expect(onDownload).toHaveBeenCalledTimes(1));
    const def = onDownload.mock.calls[0][0];
    expect(def.scope).toEqual({ type: 'game', game_id: 7 });
    expect(def.aspect_ratio).toBe('9:16');
    expect(def.budget_sec).toBeUndefined();
  });

  it('toggles the busy flag around the async download', async () => {
    let resolve;
    const onDownload = vi.fn(() => new Promise((r) => { resolve = r; }));
    render(<CollectionCard {...baseProps} onDownload={onDownload} />);
    openMenu();
    fireEvent.click(screen.getByText('Download').closest('button'));
    // While pending, the item reflects the busy state.
    await waitFor(() => expect(screen.getByText('Downloading…')).toBeTruthy());
    resolve();
    await waitFor(() => expect(screen.getByText('Download')).toBeTruthy());
  });

  it('never enables Download without a shareDefinition', () => {
    render(<CollectionCard {...baseProps} shareDefinition={undefined} onDownload={vi.fn()} />);
    openMenu();
    expect(screen.getByText('Download').closest('button').disabled).toBe(true);
  });
});

describe('useDownloads.downloadCollection (backend URL contract)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn(() => 'blob:x');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('maps a game collection definition to scope_type/game_id/tags/budget params', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['x'], { type: 'video/mp4' }),
      headers: { get: () => 'attachment; filename="Game_Highlights.mp4"' },
    });
    const { result } = renderHook(() => useDownloads(false));
    await result.current.downloadCollection({
      scope: { type: 'game', game_id: 7 }, filter: { tags: ['clutch', 'dunk'] },
      aspect_ratio: '9:16', budget_sec: 45,
    });
    const url = apiFetch.mock.calls.at(-1)[0];
    expect(url).toContain('/collections/download?');
    expect(url).toContain('scope_type=game');
    expect(url).toContain('game_id=7');
    expect(url).toContain('aspect_ratio=9%3A16');
    expect(url).toContain('tags=clutch%2Cdunk');
    expect(url).toContain('budget_sec=45');
  });

  it('omits game_id/tags/budget for a mixes collection', async () => {
    apiFetch.mockResolvedValue({
      ok: true, blob: async () => new Blob(['x']), headers: { get: () => null },
    });
    const { result } = renderHook(() => useDownloads(false));
    await result.current.downloadCollection({ scope: { type: 'mixes' }, filter: {}, aspect_ratio: '16:9' });
    const url = apiFetch.mock.calls.at(-1)[0];
    expect(url).toContain('scope_type=mixes');
    expect(url).not.toContain('game_id');
    expect(url).not.toContain('tags=');
    expect(url).not.toContain('budget_sec');
  });
});
