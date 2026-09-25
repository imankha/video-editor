import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GameClipSelectorModal } from './GameClipSelectorModal';

const MOCK_CLIPS = [
  { id: 1, name: 'My goal', rating: 5, tags: [], my_athlete: true, game_id: 1, start_time: 0, end_time: 10 },
  { id: 2, name: 'My other goal', rating: 5, tags: [], my_athlete: true, game_id: 1, start_time: 10, end_time: 20 },
];

const MOCK_GAMES = [
  { id: 1, name: 'Test Game', date: '2026-01-01' },
];

beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_CLIPS) })
  );
});

function renderModal(props = {}) {
  return render(
    <GameClipSelectorModal
      isOpen={true}
      onClose={() => {}}
      onCreate={() => {}}
      games={MOCK_GAMES}
      existingProjectNames={[]}
      {...props}
    />
  );
}

describe('T11110: suggested collection name for an all-5-star selection', () => {
  it('reads Highlight(s), never Brilliant', async () => {
    renderModal();
    await waitFor(() => screen.getByText('5 Only'));
    fireEvent.click(screen.getByText('5 Only'));

    await waitFor(() => {
      const input = screen.getByPlaceholderText('My Highlight Reel');
      expect(input.value).toContain('Highlight');
      expect(input.value).not.toContain('Brilliant');
    });
  });
});
