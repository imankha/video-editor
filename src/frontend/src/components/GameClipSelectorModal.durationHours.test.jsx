import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { GameClipSelectorModal } from './GameClipSelectorModal';

/**
 * T9480 Stage D2 -- GameClipSelectorModal's private formatDuration gains the
 * hours case. Design section 1.2 #15: "No hours case -- a >1h total reads
 * 63:20." A 4000s clip (1h 6m 40s) used to render "66:40"; it now renders
 * "1:06:40".
 */

const MOCK_GAMES = [{ id: 1, name: 'Test Game', date: '2026-01-01' }];

const LONG_CLIP = {
  id: 1,
  name: 'Long clip',
  rating: 5,
  tags: [],
  my_athlete: true,
  game_id: 1,
  start_time: 0,
  end_time: 4000, // 1h 6m 40s
};

beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve([LONG_CLIP]) }),
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
    />,
  );
}

describe('GameClipSelectorModal duration past 1 hour (T9480 Stage D2)', () => {
  it('renders 1:06:40 for a 4000s clip, not the uncapped 66:40', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByText('Long clip')).toBeTruthy();
    });
    expect(screen.getAllByText('1:06:40').length).toBeGreaterThan(0);
    expect(screen.queryByText('66:40')).toBeNull();
  });
});
