// T10610: per-region FIFO write queue for the play editor's autosave writes.
//
// Modelled on api/actionClient.js's FIFO chain (post()/chains) WITHOUT version
// threading, expected_version, or 409 handling -- raw_clips has no version
// counter and is not getting one (EPIC non-goal). See T10600-design.md § C.1.
//
// Failure tracking is PER PAYLOAD KEY, not per region: a failed trim write
// followed by a successful rating write on the SAME region must not clear the
// trim's failure, or `settle()` would tell Frame the region is clean while the
// trim never reached the server (v2 finding 3 / D4).
export function createRegionWriteQueue() {
  const chains = new Map(); // regionId -> Promise (tail)
  const failedKeys = new Map(); // regionId -> Set<fieldKey> whose LAST attempt did not land

  function record(regionId, keys, ok) {
    const set = failedKeys.get(regionId) ?? new Set();
    for (const k of keys) (ok ? set.delete(k) : set.add(k));
    if (set.size) {
      failedKeys.set(regionId, set);
    } else {
      failedKeys.delete(regionId);
    }
  }

  // `keys` = the payload's field names for this write (['startTime','endTime'],
  // ['rating'], ['__create'], ['__delete']).
  function enqueue(regionId, keys, fn) {
    const prev = chains.get(regionId) ?? Promise.resolve();
    // Link BEFORE awaiting so a synchronous pair of writes on one region
    // serializes (actionClient.js's post()). The stored tail is .catch()'d so
    // a failure can never wedge later writes; the REAL result (including a
    // rejection) still propagates to this call's own caller via `task`.
    const task = prev.catch(() => {}).then(async () => {
      const result = await fn();
      record(regionId, keys, !(result && result.saveOk === false));
      return result;
    });
    chains.set(
      regionId,
      task.catch(() => {
        record(regionId, keys, false);
      })
    );
    return task;
  }

  // Resolves after the region's tail settles. `true` = every field's LAST
  // attempt landed (no keys currently marked failed for this region).
  async function settle(regionId) {
    await (chains.get(regionId) ?? Promise.resolve());
    return !failedKeys.has(regionId);
  }

  function forget(regionId) {
    chains.delete(regionId);
    failedKeys.delete(regionId);
  }

  // T11400: does this region currently have a FAILED last attempt for any of
  // `keys`? The caller's clean-check short-circuits a write when local state
  // already matches the payload — but a failed key's local state ALSO already
  // matches (the local update is applied before the write is attempted), so
  // without this, re-picking the same value that just failed would be judged
  // clean and no retry would be sent. A failed key must always re-send.
  function hasFailedKey(regionId, keys) {
    const set = failedKeys.get(regionId);
    if (!set) return false;
    return keys.some((k) => set.has(k));
  }

  return { enqueue, settle, forget, hasFailedKey };
}
