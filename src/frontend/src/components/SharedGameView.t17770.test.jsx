import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('./GoogleOneTap', () => ({ GoogleOneTap: () => null }));
vi.mock('./SharePageInstallBanner', () => ({ SharePageInstallBanner: () => null }));

import apiFetch from '../utils/apiFetch';
import { useAuthStore } from '../stores/authStore';
import { SharedGameView } from './SharedGameView';

// T17770: a public game link whose recap object is gone must say so, not sit as an
// empty player that never plays.
describe('T17770: shared game viewer when the video cannot load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false });
    globalThis.fetch = vi.fn(() => Promise.resolve({}));
  });

  it('replaces the player with a readable message when the video fails to load', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ game_name: 'Cup Final', clips: [], recap_url: 'https://r2.example.com/gone.mp4' }),
    });
    const { container } = render(<SharedGameView token="tok" />);
    await screen.findByText('Cup Final');
    fireEvent.error(container.querySelector('video'));
    expect(await screen.findByText("These game plays aren't available right now.")).toBeTruthy();
    expect(screen.getByText('Ask the person who shared this link to send it again.')).toBeTruthy();
    expect(container.querySelector('video')).toBeNull();
  });

  it('shows the same recovery line when the link has no playable video', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ game_name: 'Cup Final', clips: [], recap_url: null }),
    });
    render(<SharedGameView token="tok" />);
    expect(await screen.findByText('Ask the person who shared this link to send it again.')).toBeTruthy();
  });
});
