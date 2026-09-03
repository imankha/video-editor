import { describe, it, expect } from 'vitest';
import {
  deriveDraftSourceExpiry,
  isGameStorageAtRisk,
  computeStorageExpiryRisk,
} from './draftSourceExpiry';

// A game "n days from now" as list_games would report storage_expires_at.
function daysFromNow(n) {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
}

function gamesMap(entries) {
  return new Map(entries.map((g) => [g.id, g]));
}

describe('deriveDraftSourceExpiry (T8320)', () => {
  it('returns null when the draft has no game_ids', () => {
    expect(deriveDraftSourceExpiry({ game_ids: [] }, gamesMap([]))).toBeNull();
    expect(deriveDraftSourceExpiry({}, gamesMap([]))).toBeNull();
  });

  it('returns null when gamesById is missing', () => {
    expect(deriveDraftSourceExpiry({ game_ids: [1] }, null)).toBeNull();
  });

  it('returns null (no crash) when every referenced game row is absent (deleted game)', () => {
    const games = gamesMap([{ id: 99, storage_status: 'active' }]);
    expect(deriveDraftSourceExpiry({ game_ids: [1, 2] }, games)).toBeNull();
  });

  it('flags expired when ANY source game is expired', () => {
    const games = gamesMap([
      { id: 1, storage_status: 'active', storage_expires_at: daysFromNow(40) },
      { id: 2, storage_status: 'expired', storage_expires_at: null },
    ]);
    const r = deriveDraftSourceExpiry({ game_ids: [1, 2] }, games);
    expect(r).toEqual({ expired: true, daysLeft: 40 });
  });

  it('reports the MIN days-left across healthy source games', () => {
    const games = gamesMap([
      { id: 1, storage_status: 'active', storage_expires_at: daysFromNow(40) },
      { id: 2, storage_status: 'active', storage_expires_at: daysFromNow(6) },
    ]);
    const r = deriveDraftSourceExpiry({ game_ids: [1, 2] }, games);
    expect(r.expired).toBe(false);
    expect(r.daysLeft).toBe(6);
  });

  it('returns daysLeft null for a healthy game with no expiry (legacy/active-no-ref)', () => {
    const games = gamesMap([{ id: 1, storage_status: 'active', storage_expires_at: null }]);
    expect(deriveDraftSourceExpiry({ game_ids: [1] }, games)).toEqual({
      expired: false,
      daysLeft: null,
    });
  });

  it('treats a reference (null storage_status + null expiry) as no chip', () => {
    // T5800: references carry no storage semantics.
    const games = gamesMap([{ id: 1, storage_status: null, storage_expires_at: null }]);
    expect(deriveDraftSourceExpiry({ game_ids: [1] }, games)).toEqual({
      expired: false,
      daysLeft: null,
    });
  });

  it('skips absent rows but still evaluates the present ones', () => {
    const games = gamesMap([
      { id: 2, storage_status: 'active', storage_expires_at: daysFromNow(3) },
    ]);
    const r = deriveDraftSourceExpiry({ game_ids: [1, 2, 3] }, games);
    expect(r).toEqual({ expired: false, daysLeft: 3 });
  });
});

describe('isGameStorageAtRisk (T8330)', () => {
  it('is false for a missing/absent game', () => {
    expect(isGameStorageAtRisk(undefined)).toBe(false);
    expect(isGameStorageAtRisk(null)).toBe(false);
  });

  it('is false for a healthy game well outside the window', () => {
    expect(isGameStorageAtRisk({ storage_status: 'active', storage_expires_at: daysFromNow(40) })).toBe(false);
  });

  it('is true for an active game inside the 14-day window', () => {
    expect(isGameStorageAtRisk({ storage_status: 'active', storage_expires_at: daysFromNow(6) })).toBe(true);
  });

  it('is false right at the 14-day boundary (matches the chip threshold)', () => {
    expect(isGameStorageAtRisk({ storage_status: 'active', storage_expires_at: daysFromNow(14) })).toBe(false);
  });

  it('is true for an EXPIRED game still in the rescuable grace window (can_extend)', () => {
    expect(isGameStorageAtRisk({ storage_status: 'expired', can_extend: true })).toBe(true);
  });

  it('is false for a permanently-deleted game (expired, not extendable — nothing to rescue)', () => {
    expect(isGameStorageAtRisk({ storage_status: 'expired', can_extend: false })).toBe(false);
  });

  it('is false for a reference (null storage_status/expiry, T5800)', () => {
    expect(isGameStorageAtRisk({ storage_status: null, storage_expires_at: null })).toBe(false);
  });
});

describe('computeStorageExpiryRisk (T8330)', () => {
  it('returns zeros when there are no drafts or no games', () => {
    expect(computeStorageExpiryRisk([], gamesMap([]))).toEqual({ atRiskGameCount: 0, dependentDraftCount: 0 });
    expect(computeStorageExpiryRisk(null, gamesMap([{ id: 1, storage_status: 'active' }]))).toEqual({
      atRiskGameCount: 0,
      dependentDraftCount: 0,
    });
  });

  it('ignores an at-risk game that NO draft depends on (bare expiry is the business model)', () => {
    const games = gamesMap([{ id: 1, storage_status: 'active', storage_expires_at: daysFromNow(3) }]);
    expect(computeStorageExpiryRisk([{ id: 'p1', game_ids: [] }], games)).toEqual({
      atRiskGameCount: 0,
      dependentDraftCount: 0,
    });
  });

  it('counts a game once and the draft once when a draft depends on an expiring game', () => {
    const games = gamesMap([
      { id: 1, storage_status: 'active', storage_expires_at: daysFromNow(5) },
      { id: 2, storage_status: 'active', storage_expires_at: daysFromNow(40) },
    ]);
    const projects = [{ id: 'p1', game_ids: [1, 2] }];
    expect(computeStorageExpiryRisk(projects, games)).toEqual({ atRiskGameCount: 1, dependentDraftCount: 1 });
  });

  it('includes grace-window (expired + rescuable) games the same as expiring ones', () => {
    const games = gamesMap([{ id: 1, storage_status: 'expired', can_extend: true }]);
    expect(computeStorageExpiryRisk([{ id: 'p1', game_ids: [1] }], games)).toEqual({
      atRiskGameCount: 1,
      dependentDraftCount: 1,
    });
  });

  it('excludes a permanently-deleted source game from the risk set', () => {
    const games = gamesMap([{ id: 1, storage_status: 'expired', can_extend: false }]);
    expect(computeStorageExpiryRisk([{ id: 'p1', game_ids: [1] }], games)).toEqual({
      atRiskGameCount: 0,
      dependentDraftCount: 0,
    });
  });

  it('dedupes a shared at-risk game across drafts but counts each dependent draft', () => {
    const games = gamesMap([{ id: 1, storage_status: 'active', storage_expires_at: daysFromNow(2) }]);
    const projects = [
      { id: 'p1', game_ids: [1] },
      { id: 'p2', game_ids: [1] },
    ];
    expect(computeStorageExpiryRisk(projects, games)).toEqual({ atRiskGameCount: 1, dependentDraftCount: 2 });
  });

  it('counts multiple distinct at-risk games and only the drafts that touch them', () => {
    const games = gamesMap([
      { id: 1, storage_status: 'active', storage_expires_at: daysFromNow(3) },
      { id: 2, storage_status: 'expired', can_extend: true },
      { id: 3, storage_status: 'active', storage_expires_at: daysFromNow(90) }, // healthy
    ]);
    const projects = [
      { id: 'p1', game_ids: [1] },
      { id: 'p2', game_ids: [2, 3] },
      { id: 'p3', game_ids: [3] }, // depends only on a healthy game — not counted
    ];
    expect(computeStorageExpiryRisk(projects, games)).toEqual({ atRiskGameCount: 2, dependentDraftCount: 2 });
  });
});
