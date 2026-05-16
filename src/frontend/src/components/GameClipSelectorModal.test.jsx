import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GameClipSelectorModal } from './GameClipSelectorModal';

const MOCK_CLIPS = [
  { id: 1, name: 'My goal', rating: 5, tags: ['goal'], my_athlete: true, game_id: 1, start_time: 0, end_time: 10 },
  { id: 2, name: 'Teammate save', rating: 5, tags: ['save'], my_athlete: false, game_id: 1, start_time: 10, end_time: 20 },
  { id: 3, name: 'Old clip', rating: 4, tags: [], my_athlete: null, game_id: 1, start_time: 20, end_time: 30 },
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

describe('My Athlete Filter', () => {
  it('renders My Athlete and All Clips toggle buttons', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByText('My Athlete')).toBeDefined();
      expect(screen.getByText('All Clips')).toBeDefined();
    });
  });

  it('defaults to My Athlete selected', async () => {
    renderModal();
    await waitFor(() => {
      const btn = screen.getByText('My Athlete');
      expect(btn.className).toContain('bg-amber-600');
    });
  });

  it('hides teammate clips by default (my_athlete=false excluded)', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.queryByText('My goal')).not.toBeNull();
      expect(screen.queryByText('Old clip')).not.toBeNull();
      expect(screen.queryByText('Teammate save')).toBeNull();
    });
  });

  it('shows all clips when All Clips is selected', async () => {
    renderModal();
    await waitFor(() => screen.getByText('All Clips'));
    fireEvent.click(screen.getByText('All Clips'));
    await waitFor(() => {
      expect(screen.queryByText('My goal')).not.toBeNull();
      expect(screen.queryByText('Teammate save')).not.toBeNull();
      expect(screen.queryByText('Old clip')).not.toBeNull();
    });
  });

  it('pre-migration clips (my_athlete=null) appear in both modes', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.queryByText('Old clip')).not.toBeNull();
    });
    fireEvent.click(screen.getByText('All Clips'));
    await waitFor(() => {
      expect(screen.queryByText('Old clip')).not.toBeNull();
    });
  });
});
