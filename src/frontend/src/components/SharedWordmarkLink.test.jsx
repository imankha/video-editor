import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('./GoogleOneTap', () => ({ GoogleOneTap: () => null }));
vi.mock('./SharePageInstallBanner', () => ({ SharePageInstallBanner: () => null }));

import apiFetch from '../utils/apiFetch';
import { useAuthStore } from '../stores/authStore';
import { SharedGameView } from './SharedGameView';
import { SharedAnnotationView } from './SharedAnnotationView';

const HOME = 'https://www.reelballers.com/';

function jsonResp(body) {
  return { ok: true, status: 200, json: async () => body };
}

describe('T8430: header wordmark links home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false });
    globalThis.fetch = vi.fn(() => Promise.resolve({}));
  });

  it('SharedGameView wordmark is a link to reelballers.com', async () => {
    apiFetch.mockResolvedValue(jsonResp({ game_name: 'Cup Final', clips: [] }));
    render(<SharedGameView token="tok" />);
    const link = (await screen.findByText('REEL BALLERS')).closest('a');
    expect(link).not.toBeNull();
    expect(link.href).toBe(HOME);
  });

  it('SharedAnnotationView wordmark is a link to reelballers.com', async () => {
    apiFetch.mockResolvedValue(jsonResp({ game_name: 'Cup Final', clips: [], pending_ids: [] }));
    render(<SharedAnnotationView shareToken="tok" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('ReelBallers')).toBeTruthy());
    const link = screen.getByText('ReelBallers').closest('a');
    expect(link).not.toBeNull();
    expect(link.href).toBe(HOME);
  });
});
