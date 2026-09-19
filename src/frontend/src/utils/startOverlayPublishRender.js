import axios from 'axios';
import exportWebSocketManager from '../services/ExportWebSocketManager';
import { useExportStore } from '../stores';
import { API_BASE } from '../config';
import { HighlightEffect } from '../constants/highlightEffects';

/**
 * startOverlayPublishRender (T10660) — fires Focus's "Publish without spotlight"
 * overlay render HEADLESSLY, so the one-tap publisher never leaves the Focus
 * completion preview.
 *
 * Replaces `scheduleExportWhenReady.js` (deleted). That module existed only
 * because the render had to be fired through a MOUNTED overlay export button, so
 * `handlePublish` force-switched editorMode to 'overlay' and polled until
 * Overlay's button mounted (T9740's per-mode-ref fix fought that wrong premise).
 * The premise is wrong: `POST /api/export/render-overlay` is fully
 * backend-authoritative — its whole body is { project_id, export_id, effect_type }
 * and the endpoint reads highlights/text/effect settings from `working_videos`
 * itself. No Overlay screen need be mounted, or even exist.
 *
 * DUPLICATION IS DELIBERATE. This is the SECOND copy of the overlay-render start
 * sequence; `ExportButtonContainer`'s overlay branch (containers/
 * ExportButtonContainer.jsx ~L733-773) is the first. Extracting the start path
 * out of that 1000-line component (health check, credits, error UI, reconnect,
 * blob paths) is a separate refactor and explicitly OUT OF SCOPE here (task
 * file: "abstract on the 3rd duplication" exception). Keep this module small; do
 * NOT try to unify it with ExportButtonContainer in this task.
 *
 * DUAL-TRANSPORT COMPLETION: a no-keyframes overlay render (exactly this path —
 * Focus has no highlight keyframes) takes the backend's synchronous-200 path AND
 * sends a WS `status:"complete"` frame, so completion arrives TWICE. The local
 * one-shot (`settled`) fires `onComplete` exactly once. This is the FIRST of two
 * required guards; the second is `handleOverlayExportCompletion`'s synchronous
 * publish-intent stake claim (the T9740 fix) — do not remove either.
 *
 * ERRORS: a POST rejection, a 409 `export_in_flight`, or a WS error fires
 * `onError` once (the caller clears the publish-intent stake, toasts, and leaves
 * the user on Focus with the preview open). The 5-minute PUBLISH_INTENT_TIMEOUT_MS
 * safety net stays a backstop only, no longer the primary error path.
 *
 * All collaborators are injectable via `deps` for unit testing without a real WS
 * or backend.
 *
 * @param {Object}   params
 * @param {number}   params.projectId
 * @param {string=}  params.effectType   defaults to HighlightEffect.DARK_OVERLAY
 *   (the same default ExportButtonContainer uses; with no enabled highlight
 *   keyframes the effect is a no-op, and working_videos.effect_type is what the
 *   renderer actually reads).
 * @param {(data:any)=>void=}                 params.onComplete  fired ONCE on completion.
 * @param {(error:string, meta?:Object)=>void=} params.onError   fired ONCE on failure.
 * @param {(progress:number, message:string)=>void=} params.onProgress
 * @param {Object=}  params.deps  injectable seams (tests).
 * @returns {Promise<{exportId:string, error?:boolean}>}
 */
export async function startOverlayPublishRender({
  projectId,
  effectType = HighlightEffect.DARK_OVERLAY,
  onComplete,
  onError,
  onProgress,
  deps = {},
}) {
  const {
    startExport = (id, pid) => useExportStore.getState().startExport(id, pid, 'overlay'),
    completeExport = (id) => useExportStore.getState().completeExport(id),
    failExport = (id, err) => useExportStore.getState().failExport(id, err),
    connect = (id, cbs) => exportWebSocketManager.connect(id, cbs),
    disconnect = (id) => exportWebSocketManager.disconnect(id),
    post = (body) => axios.post(`${API_BASE}/api/export/render-overlay`, body),
    generateId = generateExportId,
  } = deps;

  const exportId = generateId();

  // One-shot settle: whichever terminal signal (sync-200, WS complete frame, or
  // an error) arrives FIRST wins; every later one is a no-op. Completion and
  // failure share the flag so a complete-then-error (or the reverse) can never
  // double-fire the caller.
  let settled = false;
  const settleComplete = (data) => {
    if (settled) return;
    settled = true;
    onComplete?.(data);
  };
  const settleError = (error, meta) => {
    if (settled) return;
    settled = true;
    onError?.(error, meta);
  };

  // Register the job so GlobalExportIndicator renders progress from exportStore
  // without the Overlay screen being mounted.
  startExport(exportId, projectId);

  // Connect BEFORE the POST so the WS is listening when the (possibly immediate)
  // complete frame arrives. The WS manager updates the store on progress/
  // complete/error internally; these callbacks are the app-facing signal.
  await connect(exportId, {
    onProgress: (progress, message) => onProgress?.(progress, message),
    onComplete: (data) => settleComplete(data),
    onError: (serverError, meta = {}) => settleError(serverError || 'Overlay render failed', meta),
  });

  try {
    const response = await post({
      project_id: projectId,
      export_id: exportId,
      effect_type: effectType,
    });

    // 202 = background processing; completion arrives via the WS onComplete above.
    if (response?.status === 202) {
      return { exportId };
    }

    // 200 = synchronous path. The WS complete frame also arrives (dual transport),
    // so mark the store complete and settle ONCE — settleComplete guards the
    // duplicate regardless of which transport lands first.
    completeExport(exportId);
    settleComplete(response?.data);
    return { exportId };
  } catch (err) {
    // Any POST rejection is a terminal failure for this dispatch, INCLUDING a
    // 409 export_in_flight (task decision: clear the stake + toast rather than
    // silently drop, unlike ExportButtonContainer's in-screen retry affordance).
    const code = err?.response?.data?.detail?.code;
    const message = err?.message || 'Overlay render failed';
    failExport(exportId, message);
    disconnect(exportId);
    settleError(message, { code, status: err?.response?.status });
    return { exportId, error: true };
  }
}

/**
 * Local export-id generator. A third copy of the same one-liner in
 * ExportButtonContainer / useExportManager; kept local to avoid importing a
 * 1000-line container into a util (greppability beats a shared indirection for a
 * one-liner). Not the "abstract on the 3rd duplication" trigger — that rule is
 * about code PATHS, not a trivial id string.
 */
export function generateExportId() {
  return 'export_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}
