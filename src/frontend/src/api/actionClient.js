/**
 * Unified Action Client (T4330)
 *
 * ONE transport shared by framingActions.js and overlayActions.js. Owns three
 * concerns transparently so callers never see them:
 *   - per-entity FIFO serialization (same entity's actions hit the wire in
 *     emission order; different entities never block each other)
 *   - version threading (track the last echoed version per entity, send it
 *     as `expected_version` on the NEXT action for that entity)
 *   - 409 conflict routing (a stale `expected_version` -> the caller's
 *     `onConflict` hook, never an auto-merge/retry)
 *
 * Design doc: docs/plans/tasks/T4330-design.md section 2.3-2.5.
 *
 * `createActionClient(config)` returns `{ post(ids, action, target, data), seedVersion(ids, version) }`.
 *
 * Config:
 *   url(ids)         -> endpoint string for this entity
 *   entityKey(ids)    -> string key identifying the FIFO chain / version tracker
 *   tag               -> log prefix (preserves each wrapper's console.error tag)
 *   mapResult(raw, status, ok) -> caller-facing result shape (unchanged per wrapper)
 *   onConflict(ids, currentVersion) -> invoked on a 409, BEFORE mapResult runs
 *
 * `seedVersion` primes the tracker from the entity's initial data LOAD (its
 * GET response), not just from this client's own action echoes. Without it, a
 * freshly-opened tab's FIRST action always omits `expected_version` (nothing
 * echoed yet) and the backend's null-check skips the conflict check entirely --
 * so a tab whose view is already stale relative to the server, but has not yet
 * sent an action of its own, could never be caught. Call it once after the
 * screen's initial fetch, before any action for that entity can fire.
 */

import apiFetch from '../utils/apiFetch';

export function createActionClient({ url, entityKey, tag, mapResult, onConflict }) {
  // entityKey -> Promise (tail of that entity's FIFO chain).
  const chains = new Map();
  // entityKey -> last-echoed version (undefined until the first success).
  const versions = new Map();

  async function sendOne(ids, key, action, target, data) {
    const body = { action };
    if (target) body.target = target;
    if (data) body.data = data;
    const expected = versions.get(key);
    if (expected !== undefined) body.expected_version = expected;

    let response;
    try {
      response = await apiFetch(url(ids), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error(`[${tag}] Network error:`, err);
      throw err;
    }

    const raw = await response.json();

    if (response.status === 409) {
      // Tracker is now known-stale -- delete it so the NEXT action for this
      // entity omits expected_version and re-seeds from its own response.
      versions.delete(key);
      onConflict(ids, raw.current_version);
      return mapResult(raw, 409, false);
    }

    if (response.ok) {
      const v = raw.version ?? raw.new_version;
      if (v !== undefined) versions.set(key, v);
    } else {
      console.error(`[${tag}] Action failed:`, raw.error);
    }

    return mapResult(raw, response.status, response.ok);
  }

  function post(ids, action, target = null, data = null) {
    const key = entityKey(ids);
    const prev = chains.get(key) ?? Promise.resolve();

    // Link BEFORE awaiting so a synchronous A,B pair on the same key
    // serializes. A failed predecessor must not wedge the chain -- swallow
    // its rejection here so `.then` still runs for the next action.
    const task = prev.catch(() => {}).then(() => sendOne(ids, key, action, target, data));

    // The stored tail never rejects (deterministic: the NEXT action always
    // runs). The caller still gets the real `task` below, unswallowed, so a
    // rejection/`success:false` still propagates for T3800 rollback.
    chains.set(key, task.catch(() => {}));

    return task;
  }

  // Only fills in an UNSET tracker -- never overwrites a version already
  // established by this client's own echoed actions (always more current
  // than a load that may have raced an in-flight action), and correctly
  // re-seeds after a 409 clears the tracker (versions.delete in sendOne).
  function seedVersion(ids, version) {
    if (version === undefined || version === null) return;
    const key = entityKey(ids);
    if (!versions.has(key)) versions.set(key, version);
  }

  return { post, seedVersion };
}
