import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

/**
 * T5890 regression: the poster <img> src must carry API_BASE so it points at the
 * backend host, NOT a bare `/api/...` that resolves against the Cloudflare Pages
 * origin on split-host staging/prod (returning the SPA shell instead of an image).
 *
 * We force a NON-EMPTY API_BASE here on purpose: with the default empty base (the
 * unit-test/dev value) a bare `/api/...` string is byte-identical to the fix, so an
 * empty-base assertion could not tell the bug from the fix. Pinning a real host is
 * the split-host simulation the local Vite proxy hides.
 */
const { API_HOST } = vi.hoisted(() => ({ API_HOST: 'https://reel-ballers-api-staging.fly.dev' }));

vi.mock('../../config', async (importOriginal) => ({
  ...(await importOriginal()),
  API_BASE: API_HOST,
}));

const h = vi.hoisted(() => ({
  profiles: [{ id: 'p1', name: 'Fall Soccer', sport: 'soccer', isCurrent: true }],
  currentProfileId: 'p1',
}));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../stores', () => ({
  useProfileStore: (sel) => sel({ profiles: h.profiles, currentProfileId: h.currentProfileId }),
}));

import { GameTile } from '../GameTile';

const baseGame = {
  id: 42,
  name: 'vs Rivals',
  created_at: '2026-07-01T12:00:00Z',
  clip_count: 3,
  recap_video_url: 'recaps/42.mp4',
  storage_status: 'active',
  can_extend: true,
};

const handlers = () => ({
  onLoad: vi.fn(), onDelete: vi.fn(), onExtend: vi.fn(),
  onPlayRecap: vi.fn(), onShare: vi.fn(), onEdit: vi.fn(),
});

beforeEach(() => {
  h.profiles = [{ id: 'p1', name: 'Fall Soccer', sport: 'soccer', isCurrent: true }];
  h.currentProfileId = 'p1';
});

describe('GameTile — poster URL (T5890 split-host)', () => {
  it('builds the poster src against API_BASE, not a bare /api path', () => {
    render(<GameTile game={baseGame} {...handlers()} />);
    const img = document.querySelector('img');
    expect(img).toBeTruthy();
    const src = img.getAttribute('src');
    // T7940: the poster URL carries the owner's profile_id as a cache-correctness
    // token so a URL-keyed cache can't cross-serve one account's poster for another
    // account's same-numbered game (currentProfileId is mocked as 'p1' above).
    expect(src).toBe(`${API_HOST}/api/games/42/poster.jpg?profile_id=p1`);
    // The defining regression check: an absolute host, never the bare Pages-origin path.
    expect(src.startsWith(API_HOST)).toBe(true);
    expect(src.startsWith('/api/')).toBe(false);
  });
});
