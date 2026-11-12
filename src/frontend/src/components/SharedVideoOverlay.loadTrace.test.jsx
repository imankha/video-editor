// T16050:C1 - the shared reel page (SharedVideoOverlay, opened from a
// /shared/{token} link) wires the [LOAD] trace (src/utils/loadTrace.js)
// around its share fetch.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

vi.mock('../utils/apiFetch', () => ({
  default: (...args) => globalThis.apiFetchImpl(...args),
}));

vi.mock('./MediaPlayer', () => ({ MediaPlayer: () => null }));
vi.mock('./BrandedEndCard', () => ({ BrandedEndCard: () => null }));
vi.mock('./introcards/IntroPreRoll', () => ({ IntroPreRoll: () => null }));
vi.mock('./SharePageInstallBanner', () => ({ SharePageInstallBanner: () => null }));
vi.mock('../stores/authStore', () => ({ useAuthStore: (sel) => sel({ isAuthenticated: false, requireAuth: vi.fn() }) }));
vi.mock('../utils/inviteEmail', () => ({ shareInvite: vi.fn() }));

import { SharedVideoOverlay } from './SharedVideoOverlay';

function infoLines() {
  return console.info.mock.calls.map((args) => args.join(' '));
}

describe('T16050 SharedVideoOverlay (shared reel page) [LOAD] trace wiring', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('T16050:C1 logs a waiting-for line, then an arrived+settled line when the share resolves', async () => {
    globalThis.apiFetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ video_url: 'https://cdn.example.com/v.mp4', video_name: 'Play 1' }),
    });

    render(<SharedVideoOverlay shareToken="tok123" onClose={() => {}} />);

    expect(infoLines().some((l) => l.includes('[LOAD] SharedReelPage waiting for share'))).toBe(true);
    expect(infoLines().some((l) => l.includes('shareToken=tok123'))).toBe(true);

    await waitFor(() => {
      expect(infoLines().some((l) => l.includes('[LOAD] SharedReelPage share arrived'))).toBe(true);
    });
    expect(infoLines().some((l) => l.includes('[LOAD] SharedReelPage settled in'))).toBe(true);
  });

  it('logs share failed when the fetch throws', async () => {
    globalThis.apiFetchImpl = vi.fn().mockRejectedValue(new Error('network down'));

    render(<SharedVideoOverlay shareToken="tok123" onClose={() => {}} />);

    await waitFor(() => {
      expect(infoLines().some((l) => l.includes('[LOAD] SharedReelPage share failed'))).toBe(true);
    });
  });

  it('logs share empty (dead link) when the share is not found', async () => {
    globalThis.apiFetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    render(<SharedVideoOverlay shareToken="tok123" onClose={() => {}} />);

    await waitFor(() => {
      expect(infoLines().some((l) => l.includes('[LOAD] SharedReelPage share empty'))).toBe(true);
    });
  });
});
