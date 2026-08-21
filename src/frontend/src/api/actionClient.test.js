import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * T4330 -- Unified Action Client: Serialization + Versioning + 409 Conflicts.
 *
 * `createActionClient` is the new shared transport both framingActions and
 * overlayActions will route through (design doc docs/plans/tasks/T4330-design.md
 * section 2.3-2.5). It does not exist yet -- this file is written test-first
 * (Stage 3) and every test here is expected to FAIL until `api/actionClient.js`
 * is implemented.
 *
 * Covers (design doc section 7):
 *   - per-entity FIFO ordering (same key serializes; different keys don't block)
 *   - version threading (omit expected_version until first success; then thread it)
 *   - 409 handling (onConflict fired, tracker cleared, result mapped as success:false)
 *   - rollback determinism (a failed action doesn't wedge the chain; caller still
 *     sees the real result for T3800 rollback)
 */
vi.mock('../config', () => ({ API_BASE: 'http://test.local' }));

const apiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...args) => apiFetch(...args) }));

const bodyOf = (call) => JSON.parse(call[1].body);

/** A promise the test can resolve/reject on its own schedule, to prove ordering. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function makeClient(overrides = {}) {
  const { createActionClient } = await import('./actionClient');
  return createActionClient({
    url: (ids) => `http://test.local/api/entities/${ids.key}/actions`,
    entityKey: (ids) => ids.key,
    tag: 'testActions',
    mapResult: (raw, status, ok) => ({ ...raw, status, ok }),
    onConflict: vi.fn(),
    ...overrides,
  });
}

describe('actionClient', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('module exists and exports createActionClient', async () => {
    // Guard test: if this fails, every other test below will also fail on the
    // same "Cannot find module './actionClient'" error -- this one names the
    // reason explicitly so it's not confused with a logic failure.
    const mod = await import('./actionClient');
    expect(typeof mod.createActionClient).toBe('function');
  });

  it('FIFO: same entity key serializes -- B does not POST until A resolves', async () => {
    const client = await makeClient();
    const a = deferred();
    const bCall = deferred();

    apiFetch.mockImplementationOnce(() => a.promise);

    const pA = client.post({ key: 'clip1' }, 'add', null, { n: 1 });
    const pB = client
      .post({ key: 'clip1' }, 'add', null, { n: 2 })
      .then((r) => {
        bCall.resolve();
        return r;
      });

    // Give microtasks a chance to run; B's fetch must NOT have started yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(apiFetch).toHaveBeenCalledTimes(1);

    apiFetch.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, version: 2 }) }),
    );
    a.resolve({ ok: true, status: 200, json: async () => ({ success: true, version: 1 }) });

    await pA;
    await pB;

    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('cross-entity independence: key2 completes without waiting on key1', async () => {
    const client = await makeClient();
    const held = deferred();

    apiFetch.mockImplementationOnce(() => held.promise); // key1's fetch never resolves during this test
    apiFetch.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, version: 1 }) }),
    );

    const p1 = client.post({ key: 'clip1' }, 'add', null, {});
    const p2 = client.post({ key: 'clip2' }, 'add', null, {});

    const result2 = await p2;
    expect(result2.success).toBe(true);

    // key1 is still pending -- resolve it now just to clean up the test.
    held.resolve({ ok: true, status: 200, json: async () => ({ success: true, version: 1 }) });
    await p1;
  });

  it('version threading: omits expected_version first, then threads the echoed version', async () => {
    const client = await makeClient();

    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, version: 5 }),
    });
    await client.post({ key: 'clip1' }, 'add', null, { n: 1 });
    expect(bodyOf(apiFetch.mock.calls[0])).not.toHaveProperty('expected_version');

    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, version: 6 }),
    });
    await client.post({ key: 'clip1' }, 'add', null, { n: 2 });
    expect(bodyOf(apiFetch.mock.calls[1]).expected_version).toBe(5);

    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, version: 7 }),
    });
    await client.post({ key: 'clip1' }, 'add', null, { n: 3 });
    expect(bodyOf(apiFetch.mock.calls[2]).expected_version).toBe(6);
  });

  it('version threading supports the framing shape (new_version instead of version)', async () => {
    const client = await makeClient();

    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, new_version: 3 }),
    });
    await client.post({ key: 'clipA' }, 'add_crop_keyframe', null, {});

    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, new_version: 4 }),
    });
    await client.post({ key: 'clipA' }, 'add_crop_keyframe', null, {});

    expect(bodyOf(apiFetch.mock.calls[1]).expected_version).toBe(3);
  });

  it('409: fires onConflict, clears the version tracker, and resolves success:false (not a rejection)', async () => {
    const onConflict = vi.fn();
    const client = await makeClient({ onConflict });

    // Seed a version so we can prove the tracker gets cleared.
    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, version: 5 }),
    });
    await client.post({ key: 'clip1' }, 'add', null, {});

    apiFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        success: false,
        error: 'version_conflict',
        current_version: 9,
        message: 'This project was edited elsewhere. Refresh to see the latest.',
      }),
    });

    const result = await client.post({ key: 'clip1' }, 'add', null, {});

    expect(onConflict).toHaveBeenCalledWith({ key: 'clip1' }, 9);
    expect(result.success).toBe(false);
    expect(result.error).toBe('version_conflict');

    // Tracker was cleared: the NEXT action must omit expected_version again.
    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, version: 10 }),
    });
    await client.post({ key: 'clip1' }, 'add', null, {});
    expect(bodyOf(apiFetch.mock.calls[2])).not.toHaveProperty('expected_version');
  });

  it('rollback determinism: a rejected fetch propagates to the caller but does not wedge the chain', async () => {
    const client = await makeClient();

    apiFetch.mockRejectedValueOnce(new Error('Failed to fetch'));

    await expect(client.post({ key: 'clip1' }, 'add', null, {})).rejects.toThrow(); // OR resolves success:false -- see next assertion style below if implementation swallows network errors into a result object instead of throwing.

    // Whether the client throws or resolves success:false for a network error,
    // the SAME entity's next action must still fire its POST (chain not wedged).
    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, version: 1 }),
    });
    const result2 = await client.post({ key: 'clip1' }, 'add', null, {});
    expect(result2.success).toBe(true);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('rollback determinism: a success:false result propagates to the caller and the chain continues', async () => {
    const client = await makeClient();

    apiFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ success: false, error: 'Keyframe not found' }),
    });
    const result1 = await client.post({ key: 'clip1' }, 'delete', null, {});
    expect(result1.success).toBe(false);

    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, version: 1 }),
    });
    const result2 = await client.post({ key: 'clip1' }, 'add', null, {});
    expect(result2.success).toBe(true);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('T4330 fix: seedVersion primes the tracker so the FIRST action for a freshly-loaded entity is conflict-checked too', async () => {
    // Regression: without seeding, a tab's first-ever action always omitted
    // expected_version (nothing echoed yet), so a stale tab's first edit could
    // never trigger a 409 -- exactly the "two-tab" scenario this client exists
    // to protect. seedVersion primes the tracker from the entity's initial GET.
    const client = await makeClient();
    client.seedVersion({ key: 'clip1' }, 5);

    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, version: 6 }),
    });
    await client.post({ key: 'clip1' }, 'add', null, {});
    expect(bodyOf(apiFetch.mock.calls[0]).expected_version).toBe(5);
  });

  it('seedVersion never overwrites a version already established by this client\'s own echoed action', async () => {
    const client = await makeClient();

    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, version: 5 }),
    });
    await client.post({ key: 'clip1' }, 'add', null, {});

    // A late/racing seed call (e.g. a slow initial GET resolving after the
    // user's first action already landed) must NOT regress the tracker.
    client.seedVersion({ key: 'clip1' }, 1);

    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, version: 6 }),
    });
    await client.post({ key: 'clip1' }, 'add', null, {});
    expect(bodyOf(apiFetch.mock.calls[1]).expected_version).toBe(5);
  });

  it('seedVersion is a no-op for undefined/null (e.g. a legacy row with no counter yet)', async () => {
    const client = await makeClient();
    client.seedVersion({ key: 'clip1' }, undefined);
    client.seedVersion({ key: 'clip1' }, null);

    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, version: 1 }),
    });
    await client.post({ key: 'clip1' }, 'add', null, {});
    expect(bodyOf(apiFetch.mock.calls[0])).not.toHaveProperty('expected_version');
  });

  it('seedVersion re-primes the tracker after a 409 clears it', async () => {
    const client = await makeClient();

    apiFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ success: false, error: 'version_conflict', current_version: 9 }),
    });
    await client.post({ key: 'clip1' }, 'add', null, {});

    // A refresh (re-fetch of the entity) re-seeds from the server's authoritative version.
    client.seedVersion({ key: 'clip1' }, 9);

    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, version: 10 }),
    });
    await client.post({ key: 'clip1' }, 'add', null, {});
    expect(bodyOf(apiFetch.mock.calls[1]).expected_version).toBe(9);
  });

  it('mapResult lets each client preserve its own return shape', async () => {
    const mapResult = vi.fn((raw, status, ok) => ({ success: ok, raw, status }));
    const client = await makeClient({ mapResult });

    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, version: 1, region_id: 'r1' }),
    });
    const result = await client.post({ key: 'clip1' }, 'create_region', null, {});

    expect(mapResult).toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      raw: { success: true, version: 1, region_id: 'r1' },
      status: 200,
    });
  });
});
