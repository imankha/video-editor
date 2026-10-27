import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('../config', () => ({ API_BASE: '' }));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel) => sel({ isAuthenticated: false }),
}));
vi.mock('./collections/CollectionPlayer', () => ({
  CollectionPlayer: ({ reels, onReelChange }) => (
    <div>
      <span data-testid="player">{reels.length}</span>
      <button onClick={() => onReelChange(1, reels[1])}>go-second</button>
    </div>
  ),
}));
vi.mock('./BrandedEndCard', () => ({ BrandedEndCard: () => null }));
vi.mock('./introcards/IntroPreRoll', () => ({ IntroPreRoll: () => null }));

import apiFetch from '../utils/apiFetch';
import { SharedCollectionView } from './SharedCollectionView';

const body = {
  title: 'Top Plays',
  aspect_ratio: '9:16',
  members: [
    { id: 1, name: 'Goal', duration: 5, presigned_url: 'https://r2/a.mp4' },
    { id: 2, name: 'Save', duration: 6, presigned_url: 'https://r2/b.mp4' },
  ],
};

describe('SharedCollectionView download', () => {
  beforeEach(() => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => body });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['x']),
    });
    global.URL.createObjectURL = vi.fn(() => 'blob:x');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('offers Download for the highlight now playing', async () => {
    const clicked = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicked.push(this.download); };
    render(<SharedCollectionView token="t" />);
    await waitFor(() => screen.getByTestId('player'));
    fireEvent.click(screen.getByText('go-second'));
    fireEvent.click(screen.getByLabelText('Download video'));
    await waitFor(() => expect(clicked.length).toBe(1));
    expect(global.fetch).toHaveBeenCalledWith('https://r2/b.mp4');
    expect(clicked[0]).toContain('Save');
    HTMLAnchorElement.prototype.click = orig;
  });

  it('tells viewers the link updates as highlights are added', async () => {
    render(<SharedCollectionView token="t" />);
    await waitFor(() => screen.getByTestId('player'));
    expect(screen.getByText(/updates as new highlights/i)).toBeTruthy();
  });
});
