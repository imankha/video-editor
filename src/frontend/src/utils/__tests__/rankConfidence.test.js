import { vi } from 'vitest';

// Mock apiFetch BEFORE importing the module under test so the guard binds the mock.
vi.mock('../apiFetch', () => ({ default: vi.fn() }));
import apiFetch from '../apiFetch';
import { fetchRankConfidence } from '../rankConfidence';

const CONF = { confidence_pct: 30, ranked_count: 1, total: 4, eligible: true };

// A fetch whose resolution we control, so two callers overlap while it is in flight.
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => apiFetch.mockReset());

describe('fetchRankConfidence — in-flight dedup guard (T4775)', () => {
  it('collapses concurrent calls for the same ratio to ONE network request', async () => {
    const d = deferred();
    apiFetch.mockReturnValue(d.promise); // stays pending until we resolve it

    // Two overlapping callers (mirrors StrictMode double-invoke firing the same
    // ratio twice concurrently).
    const p1 = fetchRankConfidence('9:16');
    const p2 = fetchRankConfidence('9:16');

    expect(apiFetch).toHaveBeenCalledTimes(1); // deduped while in flight

    d.resolve({ ok: true, status: 200, json: async () => CONF });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toEqual(CONF);
    expect(r2).toEqual(CONF); // both callers get the shared result
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT dedup across different ratios (both are legitimately needed)', async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => CONF });

    await Promise.all([fetchRankConfidence('9:16'), fetchRankConfidence('16:9')]);

    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch.mock.calls[0][0]).toContain('9%3A16');
    expect(apiFetch.mock.calls[1][0]).toContain('16%3A9');
  });

  it('is in-flight only: a later call after settle hits the network again', async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => CONF });

    await fetchRankConfidence('9:16'); // settles + clears the entry
    await fetchRankConfidence('9:16'); // deliberate refetch -> new request

    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('returns null on a non-ok response and clears the in-flight entry', async () => {
    apiFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    expect(await fetchRankConfidence('9:16')).toBeNull();

    // entry cleared -> the next call issues a fresh request
    apiFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => CONF });
    expect(await fetchRankConfidence('9:16')).toEqual(CONF);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('returns null when apiFetch throws (non-critical) and clears the entry', async () => {
    apiFetch.mockRejectedValueOnce(new Error('network'));
    expect(await fetchRankConfidence('9:16')).toBeNull();

    apiFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => CONF });
    expect(await fetchRankConfidence('9:16')).toEqual(CONF);
  });
});
