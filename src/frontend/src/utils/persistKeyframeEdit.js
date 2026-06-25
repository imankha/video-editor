/**
 * persistKeyframeEdit - the single keyframe-edit persistence path (T3800).
 *
 * Crop and overlay both edit a keyframe by: resolving which keyframe the edit
 * targets (snap), optimistically updating local state, firing a surgical backend
 * action, and (crop) rolling back on failure. Duplicating that sequence let the
 * same snap-vs-raw bug appear in both: a persist path sent the RAW clicked
 * frame/time while the display layer snapped, so the backend appended a
 * near-duplicate (the overlapping-keyframe / lost-boundary bug).
 *
 * This helper makes that mistake unrepresentable: the backend key can ONLY come
 * from the caller's already-resolved identity (`resolution`). There is no
 * raw-key parameter and no second code path. Callers supply an `actions` adapter
 * (frame-keyed; the adapter translates to the backend's key type), so the helper
 * itself never knows whether the mode keys by frame or by time.
 *
 * Gesture-based persistence only (CLAUDE.md): this runs from gesture handlers.
 * It performs NO reactive writes and does NOT watch state.
 *
 * @param {Object}   params
 * @param {Object}   params.resolution           - Resolved identity, NOT a raw key.
 * @param {number}   params.resolution.targetKey - Frame the edit targets (post-snap).
 * @param {?number}  params.resolution.movedFromKey - Old frame if the snap MOVED a
 *                     keyframe (overlay); null when the edit updates in place (crop).
 * @param {Object}   params.data    - Keyframe payload merged into the add call.
 * @param {Object}   params.actions - { add(frameKey, data) => Promise, del(frameKey) => Promise }.
 * @param {?Object}  [params.optimistic] - Optional local optimistic write:
 *                     { apply(targetKey, data), rollback() }. (crop store write)
 * @param {?Function}[params.rollback]   - Optional extra revert run on awaited failure.
 * @param {boolean}  [params.awaited=false] - true: await add, check success, roll back on
 *                     failure (crop). false: fire-and-forget, log via onError (overlay).
 * @param {?Function}[params.onError]   - Failure handler (toast / log).
 * @returns {Promise<*>|undefined} The awaited result when `awaited`, else undefined.
 */
export async function persistKeyframeEdit({
  resolution,
  data,
  actions,
  optimistic = null,
  rollback = null,
  awaited = false,
  onError = null,
}) {
  const { targetKey, movedFromKey } = resolution;

  // Optimistic local write keyed by the SAME resolved identity sent to the backend.
  optimistic?.apply(targetKey, data);

  // Mirror a snap-move as delete(old) + add(new): the old keyframe must be removed
  // before the add, else it persists as an orphan near-duplicate.
  if (movedFromKey != null && movedFromKey !== targetKey) {
    const delP = actions.del(movedFromKey);
    if (!awaited) delP?.catch?.((err) => onError?.(err));
  }

  const addP = actions.add(targetKey, data);

  if (!awaited) {
    // Fire-and-forget (overlay): no rollback today; failures are logged.
    addP?.catch?.((err) => onError?.(err));
    return undefined;
  }

  // Awaited (crop): roll local state back on failure.
  const result = await addP;
  if (result && result.success === false) {
    optimistic?.rollback();
    rollback?.();
    onError?.(result.error);
  }
  return result;
}
