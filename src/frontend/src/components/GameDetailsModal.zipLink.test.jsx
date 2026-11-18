import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// T17200: the Upload game window talked about "a zip of plays" twice to a parent with one
// game video. Now the drop zone says "Tap to choose your game video" / "MP4, MOV or WebM"
// and zips appear only in a quiet "Have a zip of plays?" link.

vi.mock('../stores/creditStore', () => {
  const state = { balance: 100, loaded: true, fetchCredits: vi.fn() };
  const useCreditStore = (sel) => sel(state);
  useCreditStore.getState = () => state;
  return { useCreditStore };
});
vi.mock('../utils/apiFetch', () => ({
  default: vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ tournaments: [] }) })),
}));
vi.mock('./shared', async (orig) => ({ ...(await orig()), toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { GameDetailsModal } from './GameDetailsModal';

describe('Upload game window zip copy (T17200:C3)', () => {
  it('mentions zips only in the "Have a zip of plays?" link', () => {
    const { container } = render(
      <GameDetailsModal isOpen onClose={vi.fn()} onCreateGame={vi.fn()} onVeoZip={vi.fn()} onSwitchToClipUpload={vi.fn()} />,
    );
    const link = screen.getByRole('button', { name: 'Have a zip of plays?' });
    const zipTexts = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (/zip/i.test(walker.currentNode.textContent) && !link.contains(walker.currentNode)) zipTexts.push(walker.currentNode.textContent);
    }
    expect(zipTexts).toEqual([]);
    expect(screen.getByText('Tap to choose your game video')).toBeTruthy();
    expect(screen.getByText('MP4, MOV or WebM')).toBeTruthy();
  });
});
