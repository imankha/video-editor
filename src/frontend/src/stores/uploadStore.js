import { create } from 'zustand';
import { uploadGame, UPLOAD_PHASE } from '../services/uploadManager';

/**
 * Upload Store - Manages game video uploads that persist across page navigation
 *
 * The upload runs at the app level, not tied to any specific component.
 * This allows users to navigate freely while uploads continue in background.
 */
export const useUploadStore = create((set, get) => ({
  // Active upload state
  activeUpload: null, // { id, file, fileName, fileSize, progress, phase, message, startedAt, blobUrl, gameName }

  // Callbacks to notify when upload completes
  onCompleteCallbacks: [],

  /**
   * Start uploading a game video
   * @param {File} file - Video file to upload
   * @param {Object} gameDetails - { opponentName, gameDate, gameType, tournamentName }
   * @param {Object} videoMetadata - { duration, width, height }
   * @param {Function} onComplete - Callback when upload completes: (result) => void
   * @param {Object} displayInfo - { blobUrl, gameName } - Info for resuming annotation view
   * @returns {string} - Upload ID
   */
  startUpload: (file, gameDetails = null, videoMetadata = null, onComplete = null, displayInfo = null) => {
    const state = get();

    // Don't start if already uploading
    if (state.activeUpload) {
      console.warn('[UploadStore] Upload already in progress, ignoring new upload request');
      return null;
    }

    const uploadId = `upload_${Date.now()}`;
    console.log('[UploadStore] Starting upload:', uploadId, file.name);

    // Set initial state
    set({
      activeUpload: {
        id: uploadId,
        file,
        fileName: file.name,
        fileSize: file.size,
        progress: 0,
        phase: UPLOAD_PHASE.HASHING,
        message: 'Computing file hash...',
        startedAt: new Date().toISOString(),
        gameDetails,
        videoMetadata,
        // Display info for resuming annotation view
        blobUrl: displayInfo?.blobUrl || null,
        gameName: displayInfo?.gameName || file.name,
      },
      onCompleteCallbacks: onComplete ? [onComplete] : [],
    });

    // Build upload options
    const options = {};
    if (gameDetails) {
      options.opponentName = gameDetails.opponentName;
      options.gameDate = gameDetails.gameDate;
      options.gameType = gameDetails.gameType;
      options.tournamentName = gameDetails.tournamentName;
    }
    if (videoMetadata) {
      options.videoDuration = videoMetadata.duration;
      options.videoWidth = videoMetadata.width;
      options.videoHeight = videoMetadata.height;
    }

    // Start the upload
    uploadGame(file, (progress) => {
      // Map phase progress to single continuous progress bar
      // Hashing: 0-15%, Preparing: 15%, Uploading: 15-98%, Finalizing: 98-100%
      let overallPercent = 0;
      if (progress.phase === UPLOAD_PHASE.HASHING) {
        overallPercent = Math.round(progress.percent * 0.15);
      } else if (progress.phase === UPLOAD_PHASE.PREPARING) {
        overallPercent = 15;
      } else if (progress.phase === UPLOAD_PHASE.UPLOADING) {
        overallPercent = 15 + Math.round(progress.percent * 0.83);
      } else if (progress.phase === UPLOAD_PHASE.FINALIZING) {
        overallPercent = 98;
      } else if (progress.phase === UPLOAD_PHASE.COMPLETE) {
        overallPercent = 100;
      }

      set((state) => ({
        activeUpload: state.activeUpload ? {
          ...state.activeUpload,
          progress: overallPercent,
          phase: progress.phase,
          message: progress.message,
        } : null,
      }));
    }, options)
      .then((result) => {
        console.log('[UploadStore] Upload complete:', result);

        // Get callbacks before clearing state
        const callbacks = get().onCompleteCallbacks;

        // Clear upload state
        set({ activeUpload: null, onCompleteCallbacks: [] });

        // Notify all callbacks
        callbacks.forEach(cb => {
          try {
            cb(result);
          } catch (e) {
            console.error('[UploadStore] Callback error:', e);
          }
        });
      })
      .catch((error) => {
        console.error('[UploadStore] Upload failed:', error);
        set((state) => ({
          activeUpload: state.activeUpload ? {
            ...state.activeUpload,
            phase: UPLOAD_PHASE.ERROR,
            message: error.message || 'Upload failed',
          } : null,
        }));
      });

    return uploadId;
  },

  /**
   * Add a completion callback (for components that mount after upload started)
   */
  addCompletionCallback: (callback) => {
    set((state) => ({
      onCompleteCallbacks: [...state.onCompleteCallbacks, callback],
    }));
  },

  /**
   * Clear a failed upload to allow retrying
   */
  clearFailedUpload: () => {
    const state = get();
    if (state.activeUpload?.phase === UPLOAD_PHASE.ERROR) {
      set({ activeUpload: null, onCompleteCallbacks: [] });
    }
  },

  /**
   * Get current upload progress (0-100)
   */
  getProgress: () => {
    return get().activeUpload?.progress || 0;
  },

  /**
   * Check if an upload is in progress
   */
  isUploading: () => {
    const upload = get().activeUpload;
    return upload !== null && upload.phase !== UPLOAD_PHASE.ERROR;
  },
}));

export default useUploadStore;
