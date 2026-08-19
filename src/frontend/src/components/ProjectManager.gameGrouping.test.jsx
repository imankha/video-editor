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

import { groupGamesByMonth } from './ProjectManager';

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
