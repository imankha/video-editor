import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('../config', () => ({ API_BASE: '' }));
vi.mock('./SharePageInstallBanner', () => ({ SharePageInstallBanner: () => null }));
vi.mock('./introcards/IntroPreRoll', () => ({ IntroPreRoll: () => null }));
vi.mock('./instructions/Guide', () => ({ default: () => null }));
vi.mock('./MediaPlayer', () => ({
  MediaPlayer: ({ onEnded }) => <button onClick={onEnded}>finish</button>,
}));
vi.mock('./collections/CollectionPlayer', () => ({
  CollectionPlayer: ({ onEnded }) => <button onClick={onEnded}>finish</button>,
}));

import apiFetch from '../utils/apiFetch';
import { SharedVideoOverlay } from './SharedVideoOverlay';
import { SharedCollectionView } from './SharedCollectionView';

const EXPECTED =
  'https://www.reelballers.com/?ref=ab12cd34&sport=soccer&utm_source=share_endcard&utm_medium=viral&utm_campaign=reel_endcard';

async function endCardHref() {
  fireEvent.click(await screen.findByText('finish'));
  return (await screen.findByText(/Make your own highlights/)).closest('a').href;
}

function payload(body) {
  globalThis.fetch = vi.fn(() => Promise.resolve({}));
  apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => body });
}

describe('T15070: end cards carry the sharer code from the share payload', () => {
  it('SharedVideoOverlay', async () => {
    payload({
      video_url: 'https://r2/v.mp4', video_name: 'Goal', is_public: true,
      sharer_invite_code: 'ab12cd34', sport: 'soccer',
    });
    render(<SharedVideoOverlay shareToken="t" onClose={() => {}} />);
    expect(await endCardHref()).toBe(EXPECTED);
  });

  it('SharedCollectionView', async () => {
    payload({
      title: 'Top Plays', aspect_ratio: '9:16',
      members: [{ id: 1, name: 'Goal', duration: 5, presigned_url: 'https://r2/a.mp4' }],
      sharer_invite_code: 'ab12cd34', sharer_default_sport: 'soccer',
    });
    render(<SharedCollectionView token="t" />);
    expect(await endCardHref()).toBe(EXPECTED);
  });
});
