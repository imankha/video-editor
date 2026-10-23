import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('./GoogleOneTap', () => ({ GoogleOneTap: () => null }));
vi.mock('./SharePageInstallBanner', () => ({ SharePageInstallBanner: () => null }));

import apiFetch from '../utils/apiFetch';
import { useAuthStore } from '../stores/authStore';
import { SharedGameView } from './SharedGameView';

const CTA_URL =
  'https://www.reelballers.com/?utm_source=share_endcard&utm_medium=viral&utm_campaign=reel_endcard';

describe('T8420: game-link share page shows the make-your-own CTA beside the claim button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false });
    globalThis.fetch = vi.fn(() => Promise.resolve({}));
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ game_name: 'Cup Final', clips: [] }),
    });
  });

  it('renders both the claim button and the tracked CTA link', async () => {
    render(<SharedGameView token="tok" />);
    const cta = await screen.findByText(/Make your own highlights at www\.reelballers\.com/);
    expect(cta.closest('a').href).toBe(CTA_URL);
    expect(screen.getByText('Add this game to your account')).toBeTruthy();
  });
});
