import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { uploadGame, uploadMultiVideoGame, UPLOAD_PHASE } from '../services/uploadManager';
import { captureVideoFrame } from '../utils/captureVideoFrame';
import { toast } from '../components/shared';
import { useQuestStore } from './questStore';
import { useCreditStore } from './creditStore';
import { GameCreateStatus } from '../constants/gameConstants';

/**
 * Upload Store — manages game video uploads that persist across page navigation.
 *
 * T7360: holds a QUEUE of uploads (was a singular `activeUpload`). The queue is
 * SERIAL — exactly one entry is ever `uploading`; the rest wait as `queued` and
 * auto-advance on completion/failure/cancel. A failed entry stays in the list with
 * its own retry and never blocks the entries behind it. Each entry is
 * self-contained (its own completion callbacks, retry context, and created game id),
 * so N uploads coexist without global cross-talk.
 *
 * The upload runs at the app level, not tied to any component, so users can navigate
 * freely while uploads continue in the background. Uploads are transient client state
 * — never persisted (no DB/R2/localStorage write). Each mutation traces to a named
 * gesture (file drop, per-card cancel/retry/dismiss).
 *
 * `uploadManager` (uploadGame/uploadMultiVideoGame/UPLOAD_PHASE) is reused unchanged.
 */

// Per-entry lifecycle status. String-literal union near use (greppable, no registry).
export const UPLOAD_STATUS = {
  UPLOADING: 'uploading', // the ONE active upload
  QUEUED: 'queued',       // waiting behind the active upload
  ERROR: 'error',         // failed; retained with its own Retry, does not block the queue
  DONE: 'done',           // transient value used only during retirement
};

// T7360: monotonic, collision-free ids. `upload_${Date.now()}` collided for two
// drops in the same millisecond once multiple uploads could coexist. Arrival order
// is tracked by array position; this counter is purely identity.
let _uploadSeq = 0;

// Duplicate-detection identity: cheap, synchronous name+size (the same identity the
// server pending-upload filter uses). NOT a hash — hashing is async and happens later
// inside uploadManager; we need a gesture-time check.
function computeFileKey(fileOrFiles) {
  const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
  return files.map(f => `${f.name}:${f.size}`).sort().join('|');
}

// Map the manager's phase machine to a single continuous 0-100 bar.
// Hashing 0-15%, Preparing 15%, Uploading 15-98%, Finalizing 98%, Complete 100%.
function progressToPercent(progress) {
  if (progress.phase === UPLOAD_PHASE.HASHING) return Math.round(progress.percent * 0.15);
  if (progress.phase === UPLOAD_PHASE.PREPARING) return 15;
  if (progress.phase === UPLOAD_PHASE.UPLOADING) return 15 + Math.round(progress.percent * 0.83);
  if (progress.phase === UPLOAD_PHASE.FINALIZING) return 98;
  if (progress.phase === UPLOAD_PHASE.COMPLETE) return 100;
  return 0;
}

// Shared selector so hooks and imperative reads agree on "the active upload".
export const selectActiveUpload = (state) =>
  state.uploads.find(u => u.status === UPLOAD_STATUS.UPLOADING) || null;

export const useUploadStore = create((set, get) => {
  // ---- internal helpers (single source of truth for array mutation) ----
  const patchEntry = (id, fields) => set((state) => ({
    uploads: state.uploads.map(u => (u.id === id ? { ...u, ...fields } : u)),
  }));

  const retireEntry = (id) => set((state) => ({
    uploads: state.uploads.filter(u => u.id !== id),
  }));

  // Promote the next queued upload once nothing is active. One-at-a-time invariant.
  const advanceQueue = () => {
    const state = get();
    if (state.uploads.some(u => u.status === UPLOAD_STATUS.UPLOADING)) return;
    const next = state.uploads.find(u => u.status === UPLOAD_STATUS.QUEUED);
    if (next) runEntry(next);
  };

  const onEntryComplete = (id, result) => {
    // A cancelled entry was retired; its late-resolving promise must be ignored.
    const entry = get().uploads.find(u => u.id === id);
    if (!entry) return;
    console.log('[UploadStore] Upload complete:', result);
    // T1540 race: fire callbacks BEFORE retiring so setAnnotateGameId() runs while
    // isUploading() is still true (TSV clip imports depend on the game id existing).
    entry.onComplete.forEach(cb => {
      try {
        cb(result);
      } catch (e) {
        console.error('[UploadStore] Callback error:', e);
      }
    });
    const gameName = entry.gameName;
    retireEntry(id);
    if (result?.status === GameCreateStatus.ALREADY_OWNED) {
      // T8340: the file's content matched a game already in the library, so the
      // backend deduped and returned the EXISTING game — Annotate opened THAT game,
      // not a fresh upload. A "Game ready! ... uploaded successfully" toast here lied
      // about what happened (announced a new game while the old one opened). Say so
      // honestly instead, so the toast matches the game the user is now looking at.
      toast.info('Already in your library', {
        message: `${gameName || 'This video'} is already in your account — opened your existing game.`,
      });
    } else {
      toast.success('Game ready!', {
        message: `${gameName || 'Video'} uploaded successfully`,
      });
    }
    // T540: refresh quest progress after upload. T1580: refresh credits (deducted at activation).
    useQuestStore.getState().fetchProgress({ force: true });
    useCreditStore.getState().fetchCredits();
    advanceQueue();
  };

  const onEntryError = (id, error) => {
    const entry = get().uploads.find(u => u.id === id);
    if (!entry) return; // cancelled
    console.error('[UploadStore] Upload failed:', error);
    if (error.insufficientCredits) {
      // The insufficient-credits modal is the failure surface; retire the entry (no
      // retry — the user must buy credits) and let the queue advance.
      retireEntry(id);
      set({ insufficientCredits: { required: error.uploadCost, balance: error.balance } });
      advanceQueue();
      return;
    }
    // A real failure must be IMPOSSIBLE to mistake for success: prominent toast, and
    // the entry STAYS in the list (status:error) with its retry context intact.
    patchEntry(id, {
      status: UPLOAD_STATUS.ERROR,
      phase: UPLOAD_PHASE.ERROR,
      message: error.message || 'Upload failed',
    });
    toast.error('Upload failed', {
      message: `${entry.gameName || 'Your video'} didn't upload. Please tap Retry to try again.`,
    });
    // Failure isolation: the next queued upload promotes immediately.
    advanceQueue();
  };

  // The single engine every start funnels through (fresh start, queue promotion, retry).
  const runEntry = (entry) => {
    patchEntry(entry.id, {
      status: UPLOAD_STATUS.UPLOADING,
      phase: UPLOAD_PHASE.HASHING,
      progress: 0,
      message: entry.isMultiVideo ? 'Hashing video 1...' : 'Computing file hash...',
      // T7820 review: re-stamp at RUN start (not enqueue) so the tile's ETA
      // extrapolation isn't poisoned by queue wait or a retry gap — a queued
      // upload promoted after 20 min would otherwise show hours of ETA.
      startedAt: new Date().toISOString(),
    });

    const progressHandler = (progress) => {
      patchEntry(entry.id, {
        progress: progressToPercent(progress),
        phase: progress.phase,
        // Surface the manager's honest message (e.g. dedup's "Already uploaded -
        // finishing up") instead of a blanket "Uploading...".
        message: progress.message || 'Uploading...',
      });
    };

    // Build upload options from the entry's game details.
    const options = {};
    const gameDetails = entry.gameDetails;
    if (gameDetails) {
      options.opponentName = gameDetails.opponentName;
      options.gameDate = gameDetails.gameDate;
      options.gameType = gameDetails.gameType;
      options.tournamentName = gameDetails.tournamentName;
    }
    // Thread onGameCreated so clip saves work DURING upload, and record the created
    // game id ON THIS ENTRY (was a top-level global). AnnotateContainer reads the
    // ACTIVE entry's gameId to restore annotate-during-upload (T1540).
    options.onGameCreated = ({ game_id, name }) => {
      patchEntry(entry.id, { gameId: game_id, createdGameName: name });
      if (entry.onGameCreated) entry.onGameCreated({ game_id, name });
    };

    let promise;
    if (entry.isMultiVideo) {
      const metadataList = Array.isArray(entry.videoMetadata) ? entry.videoMetadata : [];
      promise = uploadMultiVideoGame(entry.files, progressHandler, {
        ...options,
        videoMetadataList: metadataList,
      });
    } else {
      if (entry.videoMetadata && !Array.isArray(entry.videoMetadata)) {
        options.videoDuration = entry.videoMetadata.duration;
        options.videoWidth = entry.videoMetadata.width;
        options.videoHeight = entry.videoMetadata.height;
        // T8870: embedded recording time -> recorded_at on the create payload.
        options.videoRecordedAt = entry.videoMetadata.recorded_at || null;
      }
      promise = uploadGame(entry.file, progressHandler, options);
    }
    promise.then(r => onEntryComplete(entry.id, r)).catch(e => onEntryError(entry.id, e));
  };

  return {
    // Ordered by arrival. Exactly one entry is ever `uploading`.
    uploads: [],

    // T1580: insufficient-credits info (shown when an upload is blocked). App-level
    // modal concern — stays top-level, not per-entry (the user must buy credits, not
    // retry a specific entry).
    insufficientCredits: null,

    /**
     * Start (or queue) a game video upload — single or multi-video (halves).
     * Accepted even while another upload runs (queued behind it). Duplicate drops of
     * the same file are rejected VISIBLY (toast) and return the existing entry's id.
     * @returns {string|null} the upload id (never null for "busy"; null only if no file)
     */
    startUpload: (fileOrFiles, gameDetails = null, videoMetadata = null, onComplete = null, displayInfo = null, onGameCreated = null) => {
      if (!fileOrFiles) return null;

      const fileKey = computeFileKey(fileOrFiles);
      const existing = get().uploads.find(u => u.fileKey === fileKey);
      if (existing) {
        // Was a silent console.warn; now a visible message. Returns the existing id so
        // a caller that navigates on the id still lands on the right upload.
        toast.info('Already queued', {
          message: `${existing.fileName} is already uploading or in the queue.`,
        });
        return existing.id;
      }

      // T8810: route on file COUNT, not a per-half mode. A 1-element array is a
      // single-video upload; only 2+ files take the multi-video path.
      const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
      const isMultiVideo = files.length > 1;
      const primaryFile = files[0];
      const id = `upl_${++_uploadSeq}`;
      const anyActive = get().uploads.some(u => u.status === UPLOAD_STATUS.UPLOADING);

      console.log('[UploadStore] Starting upload:', id, isMultiVideo ? `${files.length} files` : primaryFile.name, anyActive ? '(queued)' : '(active)');

      const entry = {
        id,
        status: anyActive ? UPLOAD_STATUS.QUEUED : UPLOAD_STATUS.UPLOADING,
        file: isMultiVideo ? null : primaryFile,
        files: isMultiVideo ? files : null,
        fileName: isMultiVideo ? `${files[0].name} + ${files.length - 1} more` : primaryFile.name,
        fileKey,
        fileSize: files.reduce((sum, f) => sum + f.size, 0),
        progress: 0,
        phase: UPLOAD_PHASE.HASHING,
        message: anyActive ? 'Queued' : (isMultiVideo ? 'Hashing video 1...' : 'Computing file hash...'),
        startedAt: new Date().toISOString(),
        gameDetails,
        videoMetadata,
        isMultiVideo,
        // Display info for resuming the annotation view.
        blobUrl: displayInfo?.blobUrl || null,
        gameName: displayInfo?.gameName || primaryFile.name,
        // T7820: local thumbnail for the uploading game tile, captured below
        // fire-and-forget. MEMORY-ONLY — never persisted, gone on reload (upload
        // state itself already is). null -> the tile shows the branded fallback.
        previewFrame: null,
        // Per-entry state that used to be top-level globals:
        gameId: null,           // was uploadGameId — set at onGameCreated
        createdGameName: null,  // was uploadGameName
        onComplete: onComplete ? [onComplete] : [], // was onCompleteCallbacks
        onGameCreated,
        // Retained so a failed upload can be retried in one click. Memory-only (holds
        // the File handle) — never persisted.
        retryContext: { fileOrFiles, gameDetails, videoMetadata, onComplete, displayInfo, onGameCreated },
      };

      set((state) => ({ uploads: [...state.uploads, entry] }));
      // T7820: capture a preview frame from the local file, fire-and-forget (the
      // upload never waits on it; a retired entry is a silent no-op in the setter).
      // Queued entries get their frame at enqueue too, so they render dimmed
      // thumbnails while waiting. captureVideoFrame resolves null on any failure.
      captureVideoFrame(primaryFile).then((frame) => {
        if (frame) get().setPreviewFrame(id, frame);
      }).catch(() => { /* cosmetic-only chain; silent by design */ });
      if (!anyActive) runEntry(entry);
      return id;
    },

    /**
     * T7820: attach the locally-captured thumbnail to one entry. Runtime-only
     * cosmetic state — no persistence path exists for it by design.
     */
    setPreviewFrame: (id, previewFrame) => patchEntry(id, { previewFrame }),

    /**
     * Attach a completion callback to the CURRENTLY-active upload (for components that
     * mount after the upload started).
     */
    addCompletionCallback: (callback) => {
      set((state) => ({
        uploads: state.uploads.map(u =>
          u.status === UPLOAD_STATUS.UPLOADING
            ? { ...u, onComplete: [...u.onComplete, callback] }
            : u,
        ),
      }));
    },

    /**
     * Dismiss a failed upload (removes its errored entry).
     */
    clearFailedUpload: (id) => {
      const entry = get().uploads.find(u => u.id === id);
      if (entry?.status === UPLOAD_STATUS.ERROR) retireEntry(id);
    },

    /**
     * Retry one errored upload via the SAME queue engine (no separate start path).
     * Runs immediately if nothing else is active, otherwise re-queues behind it.
     */
    retryUpload: (id) => {
      const entry = get().uploads.find(u => u.id === id);
      if (!entry) return null;
      const anyOtherActive = get().uploads.some(
        u => u.id !== id && u.status === UPLOAD_STATUS.UPLOADING,
      );
      if (anyOtherActive) {
        patchEntry(id, { status: UPLOAD_STATUS.QUEUED, phase: UPLOAD_PHASE.HASHING, progress: 0, message: 'Queued' });
      } else {
        runEntry(entry);
      }
      return id;
    },

    clearInsufficientCredits: () => set({ insufficientCredits: null }),

    /**
     * Progress (0-100) of the active upload.
     */
    getProgress: () => selectActiveUpload(get())?.progress || 0,

    /**
     * True while any upload is running or waiting to run (errored/none excluded).
     */
    isUploading: () => get().uploads.some(
      u => u.status === UPLOAD_STATUS.UPLOADING || u.status === UPLOAD_STATUS.QUEUED,
    ),

    /**
     * Cancel one upload. A queued entry is simply removed (no server session exists
     * yet). Cancelling the active entry advances the queue; its in-flight XHR
     * continues (aborting multipart R2 uploads is complex) but its callback is
     * discarded via the retired-entry guard in onEntryComplete.
     */
    cancelUpload: (id) => {
      const entry = get().uploads.find(u => u.id === id);
      if (!entry) return;
      const wasActive = entry.status === UPLOAD_STATUS.UPLOADING;
      retireEntry(id);
      toast.info('Upload cancelled');
      if (wasActive) advanceQueue();
    },

    /**
     * Reset on profile switch — clears the whole queue. In-flight XHRs continue but
     * their callbacks are discarded (retired-entry guard), so they can't touch the
     * new profile.
     */
    reset: () => set({ uploads: [], insufficientCredits: null }),
  };
});

// ---- Narrowed selectors (the T7280 landmine is the reason these are explicit) ----
// A selector over the whole `uploads` array (or a whole mutable entry) re-renders its
// subscriber on EVERY progress tick, because progressHandler produces a new array/entry
// each tick. Effect-heavy screens (AnnotateScreen/AnnotateContainer) must subscribe to
// PRIMITIVES so a background tick can't re-run their redirect/restore effects.

// The one active entry (or null). Re-renders on each tick of the active entry — used
// only where live progress must show (indicator, ProjectManager card).
export const useActiveUpload = () => useUploadStore(selectActiveUpload);

// Boolean: any upload running or queued. Only flips on status transitions.
export const useIsUploading = () => useUploadStore(
  state => state.uploads.some(
    u => u.status === UPLOAD_STATUS.UPLOADING || u.status === UPLOAD_STATUS.QUEUED,
  ),
);

// Primitive count — only changes on add/retire.
export const useUploadCount = () => useUploadStore(state => state.uploads.length);

// Active entry's created game id (primitive; set once at onGameCreated). AnnotateContainer
// reads this to restore annotate-during-upload (T1540).
export const useActiveUploadGameId = () => useUploadStore(
  state => selectActiveUpload(state)?.gameId ?? null,
);

// Active entry's blob url (primitive). AnnotateScreen/Container gate blob restore on it
// without subscribing to the whole entry (so a progress tick can't re-run the effect).
export const useActiveUploadBlobUrl = () => useUploadStore(
  state => selectActiveUpload(state)?.blobUrl ?? null,
);

// Filtered lists — new array refs each call, so wrap in useShallow to avoid the React 18
// useSyncExternalStore infinite-loop on unstable snapshots.
export const useQueuedUploads = () => useUploadStore(
  useShallow(state => state.uploads.filter(u => u.status === UPLOAD_STATUS.QUEUED)),
);

export const useFailedUploads = () => useUploadStore(
  useShallow(state => state.uploads.filter(u => u.status === UPLOAD_STATUS.ERROR)),
);

export default useUploadStore;
