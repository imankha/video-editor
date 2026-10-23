import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('./GoogleOneTap', () => ({ GoogleOneTap: () => null }));
vi.mock('./SharePageInstallBanner', () => ({ SharePageInstallBanner: () => null }));

import apiFetch from '../utils/apiFetch';
import { useAuthStore } from '../stores/authStore';
import { SharedAnnotationView } from './SharedAnnotationView';

const CTA_URL =
  'https://www.reelballers.com/?utm_source=share_endcard&utm_medium=viral&utm_campaign=reel_endcard';

describe('T8410: teammate-tag signed-out page shows the make-your-own CTA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false });
    globalThis.fetch = vi.fn(() => Promise.resolve({}));
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ game_name: 'Cup Final', clips: [], pending_ids: [] }),
    });
  });

  it('renders the tracked CTA link alongside the sign-in gate', async () => {
    render(<SharedAnnotationView shareToken="tok" onClose={() => {}} />);
    const cta = await screen.findByText(/Make your own highlights at www\.reelballers\.com/);
    expect(cta.closest('a').href).toBe(CTA_URL);
    expect(screen.getByText('Sign in to watch')).toBeTruthy();
  });
});
