import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// T7290: the Games tab organizes by MATCH date (game_date), not upload date
// (created_at). These tests exercise `groupGamesByMonth` directly -- it is the single
// function that decides both the month header a game lands under and its position
// inside that header, so the grouping rules are testable without rendering the screen.

// A negative-UTC-offset timezone for the whole file: it is the condition under which
// the old `new Date("2026-03-01")` parse (UTC midnight) reads as Feb 28 locally and
// files a March 1st game under February. Under UTC the bug is invisible, so pinning
// the zone is what makes the month-boundary case meaningful.
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/Los_Angeles'; });
afterAll(() => { process.env.TZ = ORIGINAL_TZ; });

// ProjectManager pulls in the whole home screen; these tests only need the exported
// pure function, so the stores/hooks its module graph touches are stubbed out.
vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
  useIsCoarsePointer: () => false,
  useIsLandscape: () => false,
}));

import { groupGamesForTab, gamesGridColumns, GAMES_TILE_GRID_BY_COLUMNS } from './ProjectManager';

// T7330 replaced the {groups, order} pair with ONE ordered array (two kinds of group make a
// string-keyed map inexpressive). Every T7290 case below keeps its fixtures and assertions
// BYTE-IDENTICAL and reads through this adapter, so a change of return shape cannot quietly
// weaken what they pin down. Tournament behaviour is covered separately, further down.
function groupGamesByMonth(games) {
  const groups = {};
  const order = [];
  for (const group of groupGamesForTab(games)) {
    groups[group.label] = group.games;
    order.push(group.label);
  }
  return { groups, order };
}

// created_at deliberately says June for every game -- the reported bug was six games
// uploaded in one June batch, all filed under "June 2026" despite March/April/May
// match dates printed in their own titles. The "YYYY-MM-DD HH:MM:SS" shape is what
// production actually stores (games.created_at defaults to sqlite CURRENT_TIMESTAMP);
// fixtures must not use a form the app never writes, since the whole fallback path
// turns on how that string is read.
function game(id, gameDate, createdAt = '2026-06-11 18:00:00') {
  return { id, name: `game-${id}`, game_date: gameDate, created_at: createdAt, clip_count: 0 };
}

function flatOrder(games) {
  const { groups, order } = groupGamesByMonth(games);
  return order.flatMap(key => groups[key].map(g => g.id));
}

describe('groupGamesByMonth — match date is the organizing key (T7290)', () => {
  it('groups by match month, not by the month the file was uploaded', () => {
    const games = [
      game(1, '2026-03-21'),
      game(2, '2026-03-28'),
      game(3, '2026-04-25'),
      game(4, '2026-04-26'),
      game(5, '2026-05-02'),
      game(6, '2026-05-09'),
    ];

    const { groups, order } = groupGamesByMonth(games);

    // The exact regrouping the reporting user expects: June 2026 (5) / May 2026 (1)
    // becomes May (2) / April (2) / March (2).
    expect(order).toEqual(['May 2026', 'April 2026', 'March 2026']);
    expect(groups['May 2026'].map(g => g.id)).toEqual([6, 5]);
    expect(groups['April 2026'].map(g => g.id)).toEqual([4, 3]);
    expect(groups['March 2026'].map(g => g.id)).toEqual([2, 1]);
    expect(order).not.toContain('June 2026');
  });

  it('orders months newest first and games newest-match-first within a month', () => {
    // Fed in shuffled order: the output order must come from the match dates alone.
    const games = [
      game(1, '2026-04-10'),
      game(2, '2026-05-30'),
      game(3, '2026-04-28'),
      game(4, '2026-05-01'),
    ];

    const { groups, order } = groupGamesByMonth(games);

    expect(order).toEqual(['May 2026', 'April 2026']);
    expect(groups['May 2026'].map(g => g.id)).toEqual([2, 4]);
    expect(groups['April 2026'].map(g => g.id)).toEqual([3, 1]);
  });

  it('groups a match dated the 1st of the month into THAT month in a negative-UTC-offset zone', () => {
    // Precondition: without the zone actually applied this case proves nothing.
    expect(new Date('2026-03-01T00:00:00Z').getDate()).toBe(28);

    const { groups, order } = groupGamesByMonth([game(1, '2026-03-01')]);

    expect(order).toEqual(['March 2026']);
    expect(groups['March 2026'].map(g => g.id)).toEqual([1]);
    expect(groups['February 2026']).toBeUndefined();
  });

  it('places a game with no match date by its upload date, without dropping it', () => {
    // Pre-requirement and materialized/shared rows can carry a NULL game_date. The
    // backend already logs those loudly; here they must still appear on the tab.
    const games = [
      game(1, '2026-05-09'),
      game(2, null, '2026-02-14 09:00:00'),
      game(3, '2026-03-21'),
    ];

    const { groups, order } = groupGamesByMonth(games);

    expect(order).toEqual(['May 2026', 'March 2026', 'February 2026']);
    expect(groups['February 2026'].map(g => g.id)).toEqual([2]);
    expect(games.length).toBe(Object.values(groups).flat().length);
  });

  it('treats an empty-string match date the same as a missing one', () => {
    const { groups, order } = groupGamesByMonth([game(9, '', '2026-01-05 09:00:00')]);

    expect(order).toEqual(['January 2026']);
    expect(groups['January 2026'].map(g => g.id)).toEqual([9]);
  });

  it('warns instead of silently absorbing a malformed non-empty match date', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Both writers are <input type="date">, so this shape means OUR data is wrong --
    // it must not take the same quiet path as a legitimately missing date.
    const { order } = groupGamesByMonth([game(1, '03/21/2026', '2026-01-05 09:00:00')]);

    expect(order).toEqual(['January 2026']);   // still placed, never dropped
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('game_date');
    warn.mockRestore();
  });

  it('breaks a same-match-day tie on upload time, newest first, stably', () => {
    // A tournament day: two games share a match date, which carries no time. The
    // tiebreak matches list_games (ORDER BY match date DESC, created_at DESC), so the
    // rendered order can never contradict the server order.
    const games = [
      game(1, '2026-04-18', '2026-06-11 10:00:00'),
      game(2, '2026-04-18', '2026-06-11 18:00:00'),
      game(3, '2026-04-18', '2026-06-11 14:00:00'),
    ];

    const first = groupGamesByMonth(games).groups['April 2026'].map(g => g.id);
    const again = groupGamesByMonth([...games].reverse()).groups['April 2026'].map(g => g.id);

    expect(first).toEqual([2, 3, 1]);
    expect(again).toEqual(first);
  });

  it('returns empty structures for an empty games list', () => {
    expect(groupGamesByMonth([])).toEqual({ groups: {}, order: [] });
  });
});

// The task requires server order and rendered order NOT to disagree: list_games'
// GAMES_MATCH_DATE_ORDER_BY and groupGamesByMonth are two halves of one contract, and
// consumers like GameClipSelectorModal render the store's array in raw server order
// with no re-sort. These fixtures are SHARED, row for row, with
// src/backend/tests/test_t7290_games_list_order.py -- the expected id order below is
// what the SQL produces; change one side and this goes red.
describe('groupGamesByMonth — agrees with the list_games server order (T7290)', () => {
  it('matches the server for a mixed set of present / NULL / empty match dates', () => {
    const games = [
      game(1, '2026-05-09', '2026-06-11 18:00:00'),
      game(2, null, '2026-04-02 09:00:00'),
      game(3, '', '2026-02-14 09:00:00'),
      game(4, '2026-03-21', '2026-06-11 18:00:00'),
    ];
    expect(flatOrder(games)).toEqual([1, 2, 4, 3]);
  });

  it('matches the server when a dated game and a dateless upload land on the SAME day', () => {
    // The case that exposed a real divergence in review: keying the fallback off the
    // full upload TIMESTAMP (rather than its calendar day) let game 2 win the primary
    // comparison outright, while the server tied them on the day and settled it on
    // created_at DESC -- putting game 1 first. Both must now say [1, 2].
    const games = [
      game(1, '2026-05-09', '2026-06-11 18:00:00'),   // old footage, uploaded in June
      game(2, null, '2026-05-09 08:00:00'),           // dateless row, uploaded May 9
    ];
    expect(flatOrder(games)).toEqual([1, 2]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7330: tournaments classify instead of months when several games share one.
// tournament_name is NULL on every game of the reporting account, so this path can
// only be proven by synthetic fixtures until a real tournament is recorded.
// ─────────────────────────────────────────────────────────────────────────────

function tournamentGame(id, gameDate, tournamentName, createdAt = '2026-08-01 12:00:00') {
  return { ...game(id, gameDate, createdAt), tournament_name: tournamentName };
}

const kinds = (games) => groupGamesForTab(games).map(g => `${g.kind}:${g.label}`);

describe('groupGamesForTab — tournament grouping (T7330)', () => {
  it('groups two games of one tournament instead of by month, and hoists them out of it', () => {
    const games = [
      game(1, '2026-07-26'),
      tournamentGame(2, '2026-07-06', 'Surf Cup'),
      tournamentGame(3, '2026-07-03', 'Surf Cup'),
    ];
    const groups = groupGamesForTab(games);

    expect(kinds(games)).toEqual(['month:July 2026', 'tournament:Surf Cup']);
    expect(groups[1].games.map(g => g.id)).toEqual([2, 3]);
    // The month keeps only the game that isn't in the tournament.
    expect(groups[0].games.map(g => g.id)).toEqual([1]);
  });

  it('leaves a LONE tournament game in its month — one game is not a group', () => {
    const games = [game(1, '2026-07-26'), tournamentGame(2, '2026-07-06', 'Surf Cup')];

    expect(kinds(games)).toEqual(['month:July 2026']);
    expect(groupGamesForTab(games)[0].games.map(g => g.id)).toEqual([1, 2]);
  });

  it('does NOT merge two annual instances of the same tournament name', () => {
    // The reason the name alone cannot be the key: a yearly cup would otherwise collapse
    // into one block spanning years.
    const games = [
      tournamentGame(1, '2026-07-06', 'Surf Cup'),
      tournamentGame(2, '2026-07-03', 'Surf Cup'),
      tournamentGame(3, '2025-07-06', 'Surf Cup'),
      tournamentGame(4, '2025-07-03', 'Surf Cup'),
    ];
    const groups = groupGamesForTab(games);

    expect(groups.filter(g => g.kind === 'tournament')).toHaveLength(2);
    expect(groups[0].games.map(g => g.id)).toEqual([1, 2]);
    expect(groups[1].games.map(g => g.id)).toEqual([3, 4]);
    expect(new Set(groups.map(g => g.key)).size).toBe(2);   // distinct React keys
  });

  it('splits one name into instances at the 90-day gap, not at a month boundary', () => {
    // ~30 days apart -> ONE instance (a long series). Also proves the split is by gap,
    // not by calendar month: these three span March, April and May.
    const games = [
      tournamentGame(1, '2026-05-02', 'Spring League'),
      tournamentGame(2, '2026-04-02', 'Spring League'),
      tournamentGame(3, '2026-03-03', 'Spring League'),
    ];
    const groups = groupGamesForTab(games);

    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('tournament');
    expect(groups[0].games.map(g => g.id)).toEqual([1, 2, 3]);
  });

  it('normalizes case and whitespace when matching a tournament name', () => {
    const games = [
      tournamentGame(1, '2026-07-06', 'Surf  Cup'),
      tournamentGame(2, '2026-07-03', '  surf cup '),
    ];
    const groups = groupGamesForTab(games);

    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('tournament');
    // Label keeps the ORIGINAL text of the newest member, not the normalized key.
    expect(groups[0].label).toBe('Surf  Cup');
  });

  it('sorts a tournament at its NEWEST match, interleaved with months', () => {
    const games = [
      game(1, '2026-08-15'),
      tournamentGame(2, '2026-07-06', 'Surf Cup'),
      tournamentGame(3, '2026-07-03', 'Surf Cup'),
      game(4, '2026-06-14'),
    ];
    expect(kinds(games)).toEqual(['month:August 2026', 'tournament:Surf Cup', 'month:June 2026']);
  });

  it('a straddling instance leaves BOTH months intact and sorts by its newest match', () => {
    const games = [
      game(1, '2026-04-05'),                            // April league game, after the cup
      tournamentGame(2, '2026-04-02', 'Border Cup'),
      tournamentGame(3, '2026-03-28', 'Border Cup'),
      game(4, '2026-03-31'),                            // March league game, mid-cup
    ];
    const groups = groupGamesForTab(games);

    expect(kinds(games)).toEqual(['month:April 2026', 'tournament:Border Cup', 'month:March 2026']);
    expect(groups[0].games.map(g => g.id)).toEqual([1]);
    expect(groups[2].games.map(g => g.id)).toEqual([4]);
    // The non-monotonic block is exactly why the header must carry its range.
    expect(groups[1].sublabel).toBe('Mar 28 – Apr 2');
  });

  it('drops a month left empty by a hoist rather than rendering an empty header', () => {
    const games = [
      game(1, '2026-08-15'),
      tournamentGame(2, '2026-07-06', 'Surf Cup'),
      tournamentGame(3, '2026-07-03', 'Surf Cup'),
    ];
    expect(kinds(games)).not.toContain('month:July 2026');
    expect(groupGamesForTab(games).every(g => g.games.length > 0)).toBe(true);
  });

  it('labels a single-day tournament with one date, not a range', () => {
    const games = [
      tournamentGame(1, '2026-04-18', 'One Day Cup', '2026-08-01 18:00:00'),
      tournamentGame(2, '2026-04-18', 'One Day Cup', '2026-08-01 10:00:00'),
    ];
    expect(groupGamesForTab(games)[0].sublabel).toBe('Apr 18');
  });

  it('builds the range from REAL match dates only, and omits it when none exist', () => {
    const dateless = [
      tournamentGame(1, null, 'Ghost Cup', '2026-04-05 10:00:00'),
      tournamentGame(2, null, 'Ghost Cup', '2026-04-03 10:00:00'),
    ];
    const [group] = groupGamesForTab(dateless);
    expect(group.kind).toBe('tournament');       // still grouped, by upload-day fallback
    expect(group.sublabel).toBeNull();           // never a range invented from upload dates

    const mixed = [
      tournamentGame(3, '2026-04-05', 'Half Cup'),
      tournamentGame(4, null, 'Half Cup', '2026-04-03 10:00:00'),
    ];
    expect(groupGamesForTab(mixed)[0].sublabel).toBe('Apr 5');
  });

  it('months never carry a sublabel', () => {
    const groups = groupGamesForTab([game(1, '2026-05-09'), game(2, '2026-04-26')]);
    expect(groups.every(g => g.sublabel === null)).toBe(true);
  });

  it('with no tournament_name anywhere, output is exactly the month grouping', () => {
    // The degradation that matters: this is the reporting account's real shape.
    const games = [
      game(1, '2026-05-09'), game(2, '2026-05-02'),
      game(3, '2026-04-26'), game(4, '2026-04-25'),
      game(5, '2026-03-28'), game(6, '2026-03-21'),
      game(7, '2025-01-11'),
    ];
    const groups = groupGamesForTab(games);

    expect(groups.every(g => g.kind === 'month')).toBe(true);
    expect(groups.map(g => g.label))
      .toEqual(['May 2026', 'April 2026', 'March 2026', 'January 2025']);
    expect(groups.map(g => g.games.length)).toEqual([2, 2, 2, 1]);
  });
});

describe('gamesGridColumns — desktop density follows the data (T7330)', () => {
  const groupsOf = (...sizes) => sizes.map(n => ({ games: Array.from({ length: n }) }));

  it('uses the largest group, so rows fill completely', () => {
    expect(gamesGridColumns(groupsOf(2, 2, 2, 1))).toBe(2);   // the reporting account
    expect(gamesGridColumns(groupsOf(3, 1))).toBe(3);
    expect(gamesGridColumns(groupsOf(4, 2))).toBe(4);
  });

  it('clamps to [2, 4] — never a lone giant tile, never a 30-column row', () => {
    expect(gamesGridColumns([])).toBe(2);
    expect(gamesGridColumns(groupsOf(1))).toBe(2);
    expect(gamesGridColumns(groupsOf(8))).toBe(4);
    expect(gamesGridColumns(groupsOf(30))).toBe(4);
  });

  it('every reachable column count has a LITERAL class string (Tailwind purge safety)', () => {
    for (const n of [0, 1, 2, 3, 4, 8, 30]) {
      const columns = gamesGridColumns(groupsOf(n));
      const cls = GAMES_TILE_GRID_BY_COLUMNS[columns];
      expect(cls, `no grid class for ${columns} columns`).toBeTruthy();
      expect(cls).toContain('grid-cols-2');   // the mobile floor is always present
    }
  });
});
