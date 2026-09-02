import { describe, it, expect } from 'vitest';
import { deriveDraftSourceExpiry } from './draftSourceExpiry';

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
