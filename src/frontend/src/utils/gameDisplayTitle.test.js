import { describe, it, expect } from 'vitest';
import { gameDisplayTitle } from './gameDisplayTitle';
import { GameType } from '../constants/gameConstants';

// Frontend mirror of backend generate_game_display_name (routers/games.py).
describe('gameDisplayTitle (T13246)', () => {
  const fb = 'WCFC vs. Legends (1st Half)';
  it('keeps the fallback name without an opponent', () => {
    expect(gameDisplayTitle({ opponentName: '', gameDate: '2026-03-28', gameType: GameType.HOME }, fb)).toBe(fb);
  });
  it('Vs for home / unknown, at for away, tournament prefix', () => {
    expect(gameDisplayTitle({ opponentName: 'Legends', gameDate: '2026-03-28', gameType: GameType.UNKNOWN }, fb)).toBe('Vs Legends Mar 28');
    expect(gameDisplayTitle({ opponentName: 'Legends', gameDate: '2026-03-08', gameType: GameType.AWAY }, fb)).toBe('at Legends Mar 8');
    expect(gameDisplayTitle({ opponentName: 'Legends', gameDate: '', gameType: GameType.HOME }, fb)).toBe('Vs Legends');
    expect(gameDisplayTitle({ opponentName: 'Legends', gameDate: '2026-03-28', gameType: GameType.TOURNAMENT, tournamentName: 'Cup' }, fb)).toBe('Cup: Vs Legends Mar 28');
  });
});
