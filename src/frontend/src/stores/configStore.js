import { create } from 'zustand';

/**
 * Config Store - server-provided runtime config the client mirrors (T10250).
 *
 * Hydrated once from /api/bootstrap (App.jsx setFromBootstrap). Today it holds
 * only the clip-upload caps so the "Add Video" flow can run a synchronous
 * pre-flight size check BEFORE hashing — a 500MB+ file is steered to Add Game
 * without a round trip. The backend stays authoritative (prepare-upload / the
 * clip-batch probe still enforce these caps); this store is a read-only mirror
 * so the single cap number lives on the server and NO `500` literal is hardcoded
 * client-side.
 *
 * `maxClipUploadBytes` is null until bootstrap resolves. Callers MUST treat null
 * as "cap unknown" and skip the optimistic gate (let the upload proceed and the
 * server refuse) rather than substituting a hardcoded fallback — a silent
 * fallback for internal config is exactly what the coding standards forbid.
 */
export const useConfigStore = create((set) => ({
  maxClipUploadBytes: null,
  maxClipDurationS: null,

  setFromBootstrap: (uploadLimits) => {
    if (!uploadLimits) return;
    set({
      maxClipUploadBytes: uploadLimits.max_clip_upload_bytes ?? null,
      maxClipDurationS: uploadLimits.max_clip_duration_s ?? null,
    });
  },
}));

export default useConfigStore;
