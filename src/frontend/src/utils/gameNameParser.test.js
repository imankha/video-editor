import { describe, it, expect } from 'vitest';
import { parseGameFilename } from './gameNameParser';

describe('parseGameFilename', () => {
  it('parses a Veo-style "match-<team>-vs-<opponent>-<date>" filename', () => {
    expect(
      parseGameFilename('match-west-coast-fc-ecnl-vs-sporting-ca-ecnl-2026-09-13.mp4')
    ).toEqual({
      ourTeamName: 'West Coast FC ECNL',
      opponentName: 'Sporting CA ECNL',
      gameDate: '2026-09-13',
    });
  });

  it('works without the leading "match-" prefix', () => {
    expect(parseGameFilename('riverside-fc-vs-carlsbad-sc-2026-04-01.mov')).toEqual({
      ourTeamName: 'Riverside FC',
      opponentName: 'Carlsbad SC',
      gameDate: '2026-04-01',
    });
  });

  it('flips which side is "ours" when the profile already names the SECOND team', () => {
    const result = parseGameFilename(
      'match-west-coast-fc-ecnl-vs-sporting-ca-ecnl-2026-09-13.mp4',
      'Sporting CA ECNL'
    );
    expect(result).toEqual({
      ourTeamName: 'Sporting CA ECNL',
      opponentName: 'West Coast FC ECNL',
      gameDate: '2026-09-13',
    });
  });

  it('is case-insensitive when matching the existing profile team', () => {
    const result = parseGameFilename(
      'match-west-coast-fc-ecnl-vs-sporting-ca-ecnl-2026-09-13.mp4',
      'sporting ca ecnl'
    );
    expect(result.ourTeamName).toBe('Sporting CA ECNL');
  });

  it('returns null for filenames with no recognizable "vs" pattern', () => {
    expect(parseGameFilename('GX010045.MP4')).toBeNull();
    expect(parseGameFilename('game.mp4')).toBeNull();
    expect(parseGameFilename('2nd-half.mp4')).toBeNull();
  });

  it('returns null when the trailing date is not a real calendar date', () => {
    expect(parseGameFilename('match-a-vs-b-2026-13-40.mp4')).toBeNull();
  });

  it('tolerates trailing suffixes after the date', () => {
    expect(parseGameFilename('match-a-fc-vs-b-sc-2026-09-13-1080p.mp4')).toEqual({
      ourTeamName: 'A FC',
      opponentName: 'B SC',
      gameDate: '2026-09-13',
    });
  });
});
