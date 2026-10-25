import { describe, it, expect } from 'vitest';
import { zipOpponent, rankCandidateGames, minGameLengthS } from './routing';

const games = [
  { id: 1, opponent_name: 'Rovers FC', game_date: '2026-09-05', effective_duration: 5400 },
  { id: 2, opponent_name: 'Sporting Blue', game_date: '2026-09-12', effective_duration: 5400 },
  { id: 3, opponent_name: 'Sporting Blue', game_date: '2026-08-01', effective_duration: 600 },
  { id: 4, opponent_name: null, game_date: '2026-09-20', effective_duration: 5400 },
];

describe('zipOpponent', () => {
  it('reads the opponent from "Veo highlights {Team} vs. {Opponent}.zip"', () => {
    expect(zipOpponent('Veo highlights Lions vs. Sporting Blue.zip')).toBe('sporting blue');
    expect(zipOpponent('Veo highlights Lions vs. Sporting Blue (1st Half).zip')).toBe('sporting blue');
  });
  it('is null for a name without "vs."', () => {
    expect(zipOpponent('highlights.zip')).toBeNull();
  });
});

describe('minGameLengthS', () => {
  it('is the last stamp plus that moment duration', () => {
    expect(minGameLengthS([{ stamp_s: 10, duration_s: 5 }, { stamp_s: 3000, duration_s: 12 }])).toBe(3012);
  });
});

describe('rankCandidateGames', () => {
  it('drops games shorter than the last moment', () => {
    const ids = rankCandidateGames('Veo highlights Lions vs. Sporting Blue.zip', 3012, games).map((g) => g.id);
    expect(ids).not.toContain(3);
  });
  it('ranks the opponent match first, then newest date', () => {
    const ids = rankCandidateGames('Veo highlights Lions vs. Sporting Blue.zip', 3012, games).map((g) => g.id);
    expect(ids).toEqual([2, 4, 1]);
  });
  it('is empty when no game is long enough', () => {
    expect(rankCandidateGames('x.zip', 99999, games)).toEqual([]);
  });
});
