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

// T7050: in-flight progress. The endpoint streams with NO Content-Length, so
// onProgress reports cumulative received bytes and a null total (indeterminate).
describe('useDownloads.downloadCollection (T7050 progress)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn(() => 'blob:x');
    global.URL.revokeObjectURL = vi.fn();
  });

  const streamResponse = (chunks, { contentLength = null } = {}) => {
    let i = 0;
    return {
      ok: true,
      headers: {
        get: (k) => {
          if (k === 'Content-Length') return contentLength;
          if (k === 'Content-Type') return 'video/mp4';
          if (k === 'Content-Disposition') return 'attachment; filename="C.mp4"';
          return null;
        },
      },
      body: {
        getReader: () => ({
          read: async () =>
            i < chunks.length
              ? { done: false, value: chunks[i++] }
              : { done: true, value: undefined },
        }),
      },
    };
  };

  it('reports cumulative bytes with a null total when Content-Length is absent', async () => {
    apiFetch.mockResolvedValue(
      streamResponse([new Uint8Array(10), new Uint8Array(5)]),
    );
    const onProgress = vi.fn();
    const { result } = renderHook(() => useDownloads(false));
    await result.current.downloadCollection(
      { scope: { type: 'mixes' }, filter: {}, aspect_ratio: '16:9' },
      { onProgress },
    );
    // Initial (0), then after each chunk (10, 15) — all with totalBytes null.
    expect(onProgress.mock.calls.map((c) => c[0].receivedBytes)).toEqual([0, 10, 15]);
    expect(onProgress.mock.calls.every((c) => c[0].totalBytes === null)).toBe(true);
  });

  it('surfaces a determinate total when Content-Length IS present', async () => {
    apiFetch.mockResolvedValue(
      streamResponse([new Uint8Array(20)], { contentLength: '20' }),
    );
    const onProgress = vi.fn();
    const { result } = renderHook(() => useDownloads(false));
    await result.current.downloadCollection(
      { scope: { type: 'mixes' }, filter: {}, aspect_ratio: '16:9' },
      { onProgress },
    );
    expect(onProgress.mock.calls.at(-1)[0]).toEqual({ receivedBytes: 20, totalBytes: 20 });
  });

  it('still downloads (blob fallback) when the body is not a readable stream', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['x'], { type: 'video/mp4' }),
      headers: { get: () => null },
    });
    const onProgress = vi.fn();
    const { result } = renderHook(() => useDownloads(false));
    await result.current.downloadCollection(
      { scope: { type: 'mixes' }, filter: {}, aspect_ratio: '16:9' },
      { onProgress },
    );
    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledWith({ receivedBytes: 0, totalBytes: null });
  });
});

// T7050: the header renders an in-flight progress indicator while a collection
// download is in flight. No Content-Length + T7040 fully builds the file
// server-side before the first byte -> receivedBytes stays 0 for the whole
// compose wait, so the "no total" case is a SPINNER (busy, not a fake bar
// implying fill-tracking that isn't happening) with a "Preparing…" readout
// that upgrades to a live byte count once bytes actually start arriving.
describe('CollectionHeader download progress (T7050)', () => {
  it('shows a "Preparing" spinner before any bytes arrive', () => {
    render(
      <CollectionHeader title="Top Plays" ratio="9:16" reelCount={3}
        onPlayAll={() => {}} onDownload={() => {}} downloadLoading downloadProgress={null} />,
    );
    const region = screen.getByTestId('collection-download-progress');
    expect(region.textContent).toContain('Preparing your download');
    expect(region.querySelector('.animate-spin')).toBeTruthy();
  });

  it('shows a byte readout once bytes are received (still no bar, no total known)', () => {
    render(
      <CollectionHeader title="Top Plays" ratio="9:16" reelCount={3}
        onPlayAll={() => {}} onDownload={() => {}} downloadLoading
        downloadProgress={{ receivedBytes: 2 * 1024 * 1024, totalBytes: null }} />,
    );
    const region = screen.getByTestId('collection-download-progress');
    expect(region.textContent).toContain('Downloading');
    expect(region.textContent).toContain('2.0 MB');
    expect(region.querySelector('.animate-spin')).toBeTruthy();
  });

  it('goes determinate (width %) when a total is known', () => {
    render(
      <CollectionHeader title="Top Plays" ratio="9:16" reelCount={3}
        onPlayAll={() => {}} onDownload={() => {}} downloadLoading
        downloadProgress={{ receivedBytes: 5, totalBytes: 10 }} />,
    );
    const region = screen.getByTestId('collection-download-progress');
    expect(region.querySelector('.animate-spin')).toBeFalsy();
    const bar = region.querySelector('[style*="width"]');
    expect(bar.style.width).toBe('50%');
  });

  it('renders no progress region when not downloading', () => {
    render(
      <CollectionHeader title="Top Plays" ratio="9:16" reelCount={3}
        onPlayAll={() => {}} onDownload={() => {}} />,
    );
    expect(screen.queryByTestId('collection-download-progress')).toBeNull();
  });
});
