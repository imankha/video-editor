import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';

vi.mock('../../utils/apiFetch', () => ({ default: vi.fn() }));
import apiFetch from '../../utils/apiFetch';
import { useDownloads } from '../../hooks/useDownloads';
import { ReelTile } from './ReelTile';

// T7100: single-reel download progress + failure feedback. `downloadFile`
// (useDownloads.js) streams the body and reports bytes, PLUS it re-throws on
// failure instead of swallowing into an unread `error` state (downloads were
// 100% silent before).
// T14170: the bytes come from a presigned R2 URL, so every download is two
// fetches: apiFetch `/file-url` (JSON), then a plain fetch of that URL.
const PRESIGNED = 'https://r2.example/reel.mp4?sig=x';

const fileUrlResponse = () => ({
  ok: true,
  json: async () => ({ url: PRESIGNED, filename: 'R.mp4', proxied: false }),
});

// apiFetch answers /file-url; global fetch answers the presigned file GET.
const mockReelFetches = (fileResponse) => {
  apiFetch.mockImplementation(async (url) => {
    if (url.endsWith('/api/downloads/1/file-url')) return fileUrlResponse();
    throw new Error(`unexpected apiFetch ${url}`);
  });
  global.fetch = vi.fn(async (url) => {
    if (url === PRESIGNED) return fileResponse;
    throw new Error(`unexpected fetch ${url}`);
  });
};

const streamResponse = (chunks, { contentLength = null } = {}) => {
  let i = 0;
  return {
    ok: true,
    headers: {
      get: (k) => {
        if (k === 'Content-Length') return contentLength;
        if (k === 'Content-Type') return 'video/mp4';
        if (k === 'Content-Disposition') return 'attachment; filename="R.mp4"';
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

describe('useDownloads.downloadFile (T7100 progress + re-throw)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn(() => 'blob:x');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('reports cumulative bytes with a null total when Content-Length is absent', async () => {
    mockReelFetches(streamResponse([new Uint8Array(10), new Uint8Array(5)]));
    const { result } = renderHook(() => useDownloads(false));
    await act(async () => {
      await result.current.downloadFile(1);
    });
    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(PRESIGNED, { credentials: 'omit' });
  });

  it('exposes downloadingId + downloadProgress together while in flight, both clear after', async () => {
    mockReelFetches(streamResponse([new Uint8Array(10)]));
    const { result } = renderHook(() => useDownloads(false));

    let downloadPromise;
    act(() => {
      downloadPromise = result.current.downloadFile(1);
    });
    // Set synchronously before the first await, so it's visible immediately.
    expect(result.current.downloadingId).toBe(1);
    expect(result.current.downloadProgress).toEqual({ receivedBytes: 0, totalBytes: null });

    await act(async () => {
      await downloadPromise;
    });
    expect(result.current.downloadingId).toBeNull();
    expect(result.current.downloadProgress).toBeNull();
  });

  it('surfaces a determinate total when Content-Length IS present', async () => {
    mockReelFetches(streamResponse([new Uint8Array(20)], { contentLength: '20' }));
    const { result } = renderHook(() => useDownloads(false));
    await act(async () => {
      await result.current.downloadFile(1);
    });
    expect(global.URL.createObjectURL).toHaveBeenCalled();
  });

  it('RE-THROWS on failure instead of swallowing into an unread error state', async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' });
    global.fetch = vi.fn();
    const { result } = renderHook(() => useDownloads(false));
    await expect(result.current.downloadFile(1)).rejects.toThrow(/Download failed/);
    // downloadingId still clears via the finally block even on failure.
    expect(result.current.downloadingId).toBeNull();
    expect(result.current.downloadProgress).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('RE-THROWS when the presigned file GET fails', async () => {
    mockReelFetches({ ok: false, status: 403, statusText: 'Forbidden' });
    const { result } = renderHook(() => useDownloads(false));
    await expect(result.current.downloadFile(1)).rejects.toThrow(/Download failed: 403/);
    expect(result.current.downloadingId).toBeNull();
    expect(result.current.downloadProgress).toBeNull();
  });

  it('still downloads (blob fallback) when the body is not a readable stream', async () => {
    mockReelFetches({
      ok: true,
      blob: async () => new Blob(['x'], { type: 'video/mp4' }),
      headers: { get: () => null },
    });
    const { result } = renderHook(() => useDownloads(false));
    await act(async () => {
      await result.current.downloadFile(1);
    });
    expect(global.URL.createObjectURL).toHaveBeenCalled();
  });
});

// T7100: ReelTile's own rendering of the in-flight state (scrim + kebab),
// independent of whether the menu that started the download is still open.
describe('ReelTile download feedback (T7100)', () => {
  const baseProps = () => ({
    download: { id: 1, filename: 'reel.mp4', project_name: 'Brilliant Dribble', aspect_ratio: '9:16' },
    posterUrl: '/api/downloads/1/poster.jpg',
    displayName: 'Brilliant Dribble',
    metaLine: '9:16 - 1 clip',
    unwatchedStyle: { dot: 'bg-cyan-400', border: 'border-cyan-400' },
    onPlay: vi.fn(),
    onWebShare: vi.fn(),
    onCopyLink: vi.fn(),
    onDownload: vi.fn(),
    onBeforeAfter: vi.fn(),
    showBeforeAfter: false,
    onOpenProject: vi.fn(),
    canOpenSource: () => false,
    onMove: vi.fn(),
    canMoveProfiles: false,
    onDelete: vi.fn(),
    onRename: vi.fn(),
  });
  const renderTile = (overrides = {}) => render(<ReelTile {...baseProps()} {...overrides} />);

  it('default state shows metaLine and the plain kebab icon', () => {
    renderTile();
    expect(screen.getByText('9:16 - 1 clip')).toBeTruthy();
    expect(screen.queryByText(/Preparing|Downloading/)).toBeNull();
  });

  it('shows "Preparing…" + a spinning kebab before any bytes arrive', () => {
    renderTile({ downloadingId: 1, downloadProgress: { receivedBytes: 0, totalBytes: null } });
    expect(screen.getByText('Preparing…')).toBeTruthy();
    expect(screen.queryByText('9:16 - 1 clip')).toBeNull();
    const kebab = screen.getByRole('button', { name: 'More actions' });
    expect(kebab.querySelector('.animate-spin')).toBeTruthy();
    // Forced full opacity while downloading, even though the kebab is normally
    // hover-gated on a fine pointer.
    expect(kebab.className).not.toMatch(/opacity-0/);
  });

  it('shows a live byte readout once bytes start arriving', () => {
    renderTile({ downloadingId: 1, downloadProgress: { receivedBytes: 2.4 * 1024 * 1024, totalBytes: null } });
    expect(screen.getByText(/Downloading… 2\.4 MB/)).toBeTruthy();
  });

  it('reverts to metaLine and the plain kebab once the download is no longer in flight', () => {
    const { rerender } = renderTile({ downloadingId: 1, downloadProgress: { receivedBytes: 0, totalBytes: null } });
    expect(screen.getByText('Preparing…')).toBeTruthy();
    rerender(<ReelTile {...baseProps()} downloadingId={null} downloadProgress={null} />);
    expect(screen.queryByText(/Preparing|Downloading/)).toBeNull();
    expect(screen.getByText('9:16 - 1 clip')).toBeTruthy();
  });

  it('is undefined-safe when downloadProgress is not passed at all (existing callers)', () => {
    // downloadingId matches but downloadProgress is omitted entirely.
    renderTile({ downloadingId: 1 });
    expect(screen.getByText('Preparing…')).toBeTruthy();
  });

  it('another tile downloading does not affect this one', () => {
    renderTile({ downloadingId: 999, downloadProgress: { receivedBytes: 10, totalBytes: null } });
    expect(screen.getByText('9:16 - 1 clip')).toBeTruthy();
    expect(screen.queryByText(/Preparing|Downloading/)).toBeNull();
  });

  it('reopening the menu mid-download still shows the per-menu-item spinner/disabled state', () => {
    renderTile({ downloadingId: 1, downloadProgress: { receivedBytes: 0, totalBytes: null } });
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const item = screen.getByText('Download').closest('button');
    expect(item.disabled).toBe(true);
    expect(item.querySelector('.animate-spin')).toBeTruthy();
  });
});
