import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// T13560 - a 10 KB file must read "10 KB", not "0.0 MB".

vi.mock('../hooks/useFootageIntake', () => {
  const item = { name: 'game2-test.mp4', size: 10 * 1024, duration: 5, creationTime: null, file: new File(['x'], 'game2-test.mp4', { type: 'video/mp4' }) };
  return {
    useFootageIntake: () => ({
      status: 'ready', items: [item], order: [item], confidence: 'unknown', gaps: [],
      placement: 'sequence', lanes: [], question: null, skipped: [], proxies: {},
      addFiles: vi.fn(), removeItem: vi.fn(), setManualOrder: vi.fn(), setPlacementMode: vi.fn(),
    }),
  };
});
vi.mock('./shared', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import { GameFootagePicker } from './GameFootagePicker';
import { GameDetailsFields } from './GameDetailsFields';

describe('T13560', () => {
  it('shows a small file in KB', () => {
    render(<GameFootagePicker onFootageChange={vi.fn()} />);
    expect(screen.getByText('10 KB')).toBeTruthy();
  });

  it('game type buttons wrap in a grid that fits 390px', () => {
    render(
      <GameDetailsFields
        opponent="" setOpponent={vi.fn()} gameDate="" setGameDate={vi.fn()}
        gameType="home" setGameType={vi.fn()} tournamentName="" setTournamentName={vi.fn()}
        existingTournaments={[]}
      />
    );
    const row = screen.getByText('Tournament').parentElement;
    expect(row.className).toContain('grid-cols-2');
    expect(row.className).not.toMatch(/(^|\s)flex(\s|$)/);
  });
});
