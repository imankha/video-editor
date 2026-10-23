import { describe, it, expect } from 'vitest';
import { parseGameFilename } from './gameNameParser';

// Prod scan 2026-10-14: 200 original filenames, only 11 matched the Veo "a-vs-b-YYYY-MM-DD" form.
// These cover the other shapes that carry a date or an opponent (names here are made up).
const NOW = new Date(Date.UTC(2026, 9, 14));
const p = (name, team = '') => parseGameFilename(name, team, NOW);

describe('dates from camera, recorder and Veo names', () => {
  it.each([
    ['nov-16-2024-41308-pm-2024-11-17.mp4', '2024-11-16'], // Veo, no teams: the title's date wins over the trailing one
    ['match-sep-19-2026-2026-09-20 (2).mp4', '2026-09-19'],
    ['untitled-recording-2026-09-27_20-02-28-2026-09-27.mp4', '2026-09-27'],
    ['PXL_20260919_140034870.mp4', '2026-09-19'],
    ['dji_mimo_20261003_111124_20261003111125_1791037881444_video.MP4', '2026-10-03'],
    ['VID-20260925-WA0011.mp4', '2026-09-25'],
    ['2026-09-20-13-01-01_1789905661775.mp4', '2026-09-20'],
    ['2026-09-29 17-41-29.mp4', '2026-09-29'],
    ['filmaeu_2026_10_09.mp4', '2026-10-09'],
    ['LiveBarn-124000-30000-Some_Arena_Rink_3_2026-09-13T175956.mov', '2026-09-13'],
    ['Screen Recording 2026-10-06 at 3.27.19 pm.mov', '2026-10-06'],
    ['ScreenRecording_09-13-2026 18-30-16_1.mp4', '2026-09-13'], // iOS: MM-DD-YYYY
    ['Screen_Recording_20260925_172128_Facebook (1).mp4', '2026-09-25'],
    ['Cup final 27-12-2023 (2).mp4', '2023-12-27'], // day first when the first number cannot be a month
    ['Eastside - May 18 2026.mp4', '2026-05-18'],
    ['Friday Oct 2.MOV', '2026-10-02'], // no year: the most recent past Oct 2
    ['Saturday Dec 5.mov', '2025-12-05'], // Dec 5 2026 is in the future, so last year
  ])('%s -> %s', (name, date) => {
    expect(p(name)).toEqual({ ourTeamName: null, opponentName: null, gameDate: date });
  });
});

describe('matchups typed with spaces', () => {
  it.each([
    ['Tigers vs. Hawks September 26.mp4', 'Hawks', '2026-09-26'],
    ['Bay City SC U19 vs Lake Athletic U19.mp4', 'Lake Athletic U19', null],
    ['YBL S04 Game 1 Ravens v Ballers.mp4', 'Ballers', null],
    ['U16B 20260721 R17 v Logan.mp4', 'Logan', '2026-07-21'],
    ['2026_10_06_Varsity_PCS vs. HSRC.mp4', 'HSRC', '2026-10-06'],
    ["All Stars - North vs South (2).mp4", 'South', null],
  ])('%s -> opponent %s, date %s', (name, opponent, date) => {
    expect(p(name)).toEqual({ ourTeamName: null, opponentName: opponent, gameDate: date });
  });

  it('a loosely typed name never guesses "our team" (it would be saved to the profile)', () => {
    expect(p('Tigers vs. Hawks.mp4').ourTeamName).toBeNull();
  });

  it('the opponent is the side that is not the profile team', () => {
    expect(p('Tigers vs. Hawks.mp4', 'hawks').opponentName).toBe('Tigers');
  });

  it('skips the underscored, truncated export form (too noisy to trust)', () => {
    expect(p('RC_Club_vs_Acad_mie_de_Ville_match_Amical_1080p-Pressing et but.mp4')).toBeNull();
  });
});

describe('"<opponent> half N"', () => {
  it.each([
    ['Downtown United half 1.mp4', 'Downtown United'],
    ['Ridge Premier half 2.mp4', 'Ridge Premier'],
    ['Ridgeway 1st half.m4v', 'Ridgeway'],
  ])('%s -> %s', (name, opponent) => {
    expect(p(name)).toEqual({ ourTeamName: null, opponentName: opponent, gameDate: null });
  });
});

describe('names with nothing to read', () => {
  it.each(['IMG_5823.MOV', 'GX010324.MP4', 'C0018.MP4', '1000010886.mp4', '3617e124-60cf-444e-bacc-450e09c7cfae.mov',
    '09212026 Evie.mp4', '15:50:44.mov', 'Game_1.mp4', 'prep 2.mp4', '01 003305_-_Shot_on_goal.mp4', 'Hillcrest 2026 Grading.mp4',
  ])('%s -> null', (name) => {
    expect(p(name)).toBeNull();
  });
});

describe('T12870: leading ISO date + "Vs" opponent', () => {
  it('2026-10-10 Vs Rangers.mp4 -> opponent + date', () => {
    expect(p('2026-10-10 Vs Rangers.mp4')).toEqual({ ourTeamName: null, opponentName: 'Rangers', gameDate: '2026-10-10' });
  });
});
