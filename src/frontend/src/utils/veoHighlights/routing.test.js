import { describe, it, expect } from 'vitest';
import { zipOpponent, rankCandidateGames, minGameLengthS } from './routing';

const games = [
  { id: 1, opponent_name: 'Rovers FC', game_date: '2026-09-05', video_duration: 5400 },
  { id: 2, opponent_name: 'Sporting Blue', game_date: '2026-09-12', video_duration: 5400 },
  { id: 3, opponent_name: 'Sporting Blue', game_date: '2026-08-01', video_duration: 600 },
  { id: 4, opponent_name: null, game_date: '2026-09-20', video_duration: 5400 },
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
  it('drops a matching game shorter than the last moment', () => {
    const ids = rankCandidateGames('Veo highlights Lions vs. Sporting Blue.zip', 3012, games).map((g) => g.id);
    expect(ids).not.toContain(3);
  });
  it('offers ONLY games whose opponent matches the zip (length alone is no evidence)', () => {
    // Real report: a zip matching no game offered "Vs LA Rebels" / "at Sporting" just for being long.
    const ids = rankCandidateGames('Veo highlights Lions vs. Sporting Blue.zip', 3012, games).map((g) => g.id);
    expect(ids).toEqual([2]);
    expect(rankCandidateGames('Veo highlights Lions vs. Nobody FC.zip', 3012, games)).toEqual([]);
  });
  it('orders several matching games newest first', () => {
    const g = [
      { id: 1, opponent_name: 'Legends', game_date: '2026-03-28', video_duration: 5400 },
      { id: 2, opponent_name: 'Legends', game_date: '2026-09-12', video_duration: 5400 },
    ];
    expect(rankCandidateGames('Veo highlights WCFC vs. Legends.zip', 900, g).map((x) => x.id)).toEqual([2, 1]);
  });
  it('matches a short opponent name against the longer Veo team name, either way', () => {
    // Real data: the game says "Legends", the Veo zip says "Legends FC San Diego".
    const g = [
      { id: 7, opponent_name: 'Other', game_date: '2026-09-20', video_duration: 5400 },
      { id: 6, opponent_name: 'Legends', game_date: '2026-03-28', video_duration: 5389 },
    ];
    expect(rankCandidateGames('Veo highlights WCFC  vs. Legends FC San Diego (1st Half).zip', 900, g).map((x) => x.id)).toEqual([6]);
    const g2 = [{ id: 8, opponent_name: 'Other', game_date: '2026-09-20', video_duration: 5400 },
      { id: 9, opponent_name: 'LA Breakers FC Long Beach', game_date: '2026-05-09', video_duration: 5400 }];
    expect(rankCandidateGames('Veo highlights WCFC vs. LA Breakers.zip', 900, g2).map((x) => x.id)).toEqual([9]);
  });
  it('does not match on a partial word', () => {
    const g = [{ id: 1, opponent_name: 'Leg', game_date: '2026-09-20', video_duration: 5400 }];
    expect(rankCandidateGames('Veo highlights WCFC vs. Legends FC.zip', 900, g)).toEqual([]);
  });
  it('a zip without "vs." matches no game', () => {
    expect(rankCandidateGames('Veo highlights Scrimmage Game 10_4_25.zip', 900, games)).toEqual([]);
  });
  it('excludes a game with no known video duration (cannot prove the moments fit)', () => {
    const g = [{ id: 1, opponent_name: 'Legends', game_date: '2026-09-20', video_duration: null }];
    expect(rankCandidateGames('Veo highlights WCFC vs. Legends.zip', 900, g)).toEqual([]);
  });
  it('is empty when no game is long enough', () => {
    expect(rankCandidateGames('x.zip', 99999, games)).toEqual([]);
  });
});
