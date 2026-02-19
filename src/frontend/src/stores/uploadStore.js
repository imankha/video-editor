import { create } from 'zustand';
import { uploadGame, uploadMultiVideoGame, UPLOAD_PHASE } from '../services/uploadManager';

/**
 * Upload Store - Manages game video uploads that persist across page navigation
 *
 * The upload runs at the app level, not tied to any specific component.
 * This allows users to navigate freely while uploads continue in background.
 *
 * Supports both single-video and multi-video (e.g., halves) uploads.
 */
export const useUploadStore = create((set, get) => ({
  // Active upload state
  activeUpload: null, // { id, file/files, fileName, fileSize, progress, phase, message, startedAt, blobUrl, gameName, isMultiVideo }

  // Callbacks to notify when upload completes
  onCompleteCallbacks: [],

  /**
   * Start uploading a game video (single or multi-video)
   * @param {File|File[]} fileOrFiles - Single video file or array of files (halves)
   * @param {Object} gameDetails - { opponentName, gameDate, gameType, tournamentName }
   * @param {Object|Object[]} videoMetadata - Single metadata or array for multi-video
   * @param {Function} onComplete - Callback when upload completes: (result) => void
   * @param {Object} displayInfo - { blobUrl, gameName } - Info for resuming annotation view
   * @returns {string} - Upload ID
   */
  startUpload: (fileOrFiles, gameDetails = null, videoMetadata = null, onComplete = null, displayInfo = null) => {
    const state = get();

    // Don't start if already uploading
    if (state.activeUpload) {
      console.warn('[UploadStore] Upload already in progress, ignoring new upload request');
      return null;
    }

    const isMultiVideo = Array.isArray(fileOrFiles);
    const files = isMultiVideo ? fileOrFiles : [fileOrFiles];
    const primaryFile = files[0];

    const uploadId = `upload_${Date.now()}`;
    console.log('[UploadStore] Starting upload:', uploadId, isMultiVideo ? `${files.length} files` : primaryFile.name);

    // Set initial state
    set({
      activeUpload: {
        id: uploadId,
        file: isMultiVideo ? null : primaryFile,
        files: isMultiVideo ? files : null,
        fileName: isMultiVideo ? `${files[0].name} + ${files[1].name}` : primaryFile.name,
        fileSize: files.reduce((sum, f) => sum + f.size, 0),
        progress: 0,
        phase: UPLOAD_PHASE.HASHING,
        message: isMultiVideo ? 'Hashing first half...' : 'Computing file hash...',
        startedAt: new Date().toISOString(),
        gameDetails,
        videoMetadata,
        isMultiVideo,
        // Display info for resuming annotation view
        blobUrl: displayInfo?.blobUrl || null,
        gameName: displayInfo?.gameName || primaryFile.name,
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

    // Map progress to single continuous progress bar
    // Hashing: 0-15%, Preparing: 15%, Uploading: 15-98%, Finalizing: 98-100%
    const progressHandler = (progress) => {
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
    };

    // Completion handler (shared for single and multi)
    // IMPORTANT: Fire callbacks BEFORE clearing activeUpload so that
    // setAnnotateGameId() runs before isUploading() returns false.
    // Otherwise there's a race where the UI shows upload complete but
    // annotateGameId is still null, causing TSV imports to skip saving clips.
    const onUploadComplete = (result) => {
      console.log('[UploadStore] Upload complete:', result);
      const callbacks = get().onCompleteCallbacks;
      callbacks.forEach(cb => {
        try {
          cb(result);
        } catch (e) {
          console.error('[UploadStore] Callback error:', e);
        }
      });
      set({ activeUpload: null, onCompleteCallbacks: [] });
    };

    const onUploadError = (error) => {
      console.error('[UploadStore] Upload failed:', error);
      set((state) => ({
        activeUpload: state.activeUpload ? {
          ...state.activeUpload,
          phase: UPLOAD_PHASE.ERROR,
          message: error.message || 'Upload failed',
        } : null,
      }));
    };

    if (isMultiVideo) {
      // Multi-video upload
      const metadataList = Array.isArray(videoMetadata) ? videoMetadata : [];
      uploadMultiVideoGame(files, progressHandler, {
        ...options,
        videoMetadataList: metadataList,
      })
        .then(onUploadComplete)
        .catch(onUploadError);
    } else {
      // Single-video upload
      if (videoMetadata && !Array.isArray(videoMetadata)) {
        options.videoDuration = videoMetadata.duration;
        options.videoWidth = videoMetadata.width;
        options.videoHeight = videoMetadata.height;
      }
      uploadGame(primaryFile, progressHandler, options)
        .then(onUploadComplete)
        .catch(onUploadError);
    }

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
