import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Download, Loader } from 'lucide-react';
import { useVideo } from './hooks/useVideo';
import useZoom from './hooks/useZoom';
import useTimelineZoom from './hooks/useTimelineZoom';
import { useClipManager } from './hooks/useClipManager';
import { useProjects } from './hooks/useProjects';
import { useProjectClips } from './hooks/useProjectClips';
import { VideoPlayer } from './components/VideoPlayer';
import { Controls } from './components/Controls';
import { FileUpload } from './components/FileUpload';
import { ClipSelectorSidebar } from './components/ClipSelectorSidebar';
import AspectRatioSelector from './components/AspectRatioSelector';
import ZoomControls from './components/ZoomControls';
import ExportButton from './components/ExportButton';
import CompareModelsButton from './components/CompareModelsButton';
import DebugInfo from './components/DebugInfo';
import { ModeSwitcher } from './components/shared/ModeSwitcher';
import { ProjectManager } from './components/ProjectManager';
import { ProjectHeader } from './components/ProjectHeader';
// Mode-specific imports
import { useCrop, useSegments, FramingMode, CropOverlay } from './modes/framing';
import { useHighlight, useHighlightRegions, OverlayMode, HighlightOverlay, usePlayerDetection, PlayerDetectionOverlay } from './modes/overlay';
import { AnnotateMode, useAnnotate, ClipsSidePanel, NotesOverlay, AnnotateControls, AnnotateFullscreenOverlay } from './modes/annotate';
import { findKeyframeIndexNearFrame, FRAME_TOLERANCE } from './utils/keyframeUtils';
import { extractVideoMetadata, extractVideoMetadataFromUrl } from './utils/videoMetadata';

// Feature flags for experimental features
// Set to true to enable model comparison UI (for A/B testing different AI models)
const ENABLE_MODEL_COMPARISON = false;

function App() {
  const [videoFile, setVideoFile] = useState(null);
  // Temporary state for live drag/resize preview (null when not dragging)
  const [dragCrop, setDragCrop] = useState(null);
  const [dragHighlight, setDragHighlight] = useState(null);

  // Selected highlight keyframe time (when playhead is near a keyframe)
  const [selectedHighlightKeyframeTime, setSelectedHighlightKeyframeTime] = useState(null);

  // Editor mode state ('framing' | 'overlay' | 'annotate')
  const [editorMode, setEditorMode] = useState('framing');

  // Overlay mode video state (SEPARATE from framing video)
  // This is either: 1) Rendered output from Framing, or 2) Fresh upload for Overlay
  const [overlayVideoFile, setOverlayVideoFile] = useState(null);
  const [overlayVideoUrl, setOverlayVideoUrl] = useState(null);
  const [overlayVideoMetadata, setOverlayVideoMetadata] = useState(null);

  // Clip metadata for auto-generating highlight regions (from Framing export)
  const [overlayClipMetadata, setOverlayClipMetadata] = useState(null);

  // Annotate mode video state (for extracting clips from full game footage)
  const [annotateVideoFile, setAnnotateVideoFile] = useState(null);
  const [annotateVideoUrl, setAnnotateVideoUrl] = useState(null);
  const [annotateVideoMetadata, setAnnotateVideoMetadata] = useState(null);
  const [isAnnotateExporting, setIsAnnotateExporting] = useState(false);

  // Annotate mode playback state
  const [annotatePlaybackSpeed, setAnnotatePlaybackSpeed] = useState(1);
  const [annotateFullscreen, setAnnotateFullscreen] = useState(false);
  const [showAnnotateOverlay, setShowAnnotateOverlay] = useState(false);

  // Ref for fullscreen container
  const annotateContainerRef = useRef(null);

  // Ref to track previous isPlaying state for detecting pause transitions
  const wasPlayingRef = useRef(false);

  // Ref for annotate mode file input (to trigger file picker directly from ProjectManager)
  const annotateFileInputRef = useRef(null);

  // Layer selection state for arrow key navigation
  const [selectedLayer, setSelectedLayer] = useState('playhead'); // 'playhead' | 'crop' | 'highlight'

  // Audio state - synced between export settings and playback (Framing mode only)
  const [includeAudio, setIncludeAudio] = useState(true);

  // Highlight effect type - controls both client-side preview and export
  // 'brightness_boost' | 'original' | 'dark_overlay'
  const [highlightEffectType, setHighlightEffectType] = useState('original');

  // NOTE: selectedCropKeyframeIndex and selectedHighlightKeyframeIndex are now derived via useMemo
  // (defined after hooks that provide keyframes and currentTime)

  // Multi-clip management hook
  const {
    clips,
    selectedClipId,
    selectedClip,
    hasClips,
    globalAspectRatio,
    globalTransition,
    addClip,
    addClipFromProject,
    loadProjectClips,
    clearClips,
    deleteClip,
    selectClip,
    reorderClips,
    updateClipData,
    setGlobalAspectRatio,
    setGlobalTransition,
    getExportData: getClipExportData,
  } = useClipManager();

  // Project management hooks
  const {
    projects,
    selectedProject,
    selectedProjectId,
    loading: projectsLoading,
    hasProjects,
    fetchProjects,
    selectProject,
    createProject,
    deleteProject,
    clearSelection,
    refreshSelectedProject
  } = useProjects();

  // Project clips (only active when project selected)
  const {
    clips: projectClips,
    fetchClips: fetchProjectClips,
    uploadClip,
    addClipFromLibrary,
    removeClip: removeProjectClip,
    reorderClips: reorderProjectClips,
    saveFramingEdits,
    getClipFileUrl
  } = useProjectClips(selectedProjectId);

  // Computed: is overlay available for this project?
  const isOverlayAvailable = selectedProject?.working_video_id != null;

  // Segments hook (defined early so we can pass getSegmentAtTime and clampToVisibleRange to useVideo)
  const {
    boundaries: segmentBoundaries,
    segments,
    sourceDuration,
    visualDuration,
    trimmedDuration,
    segmentVisualLayout,
    framerate: segmentFramerate,
    trimRange,  // NEW: Watch for trim range changes
    trimHistory,  // NEW: Trim history for de-trim buttons
    segmentSpeeds,  // Speed settings by segment index
    initializeWithDuration: initializeSegments,
    reset: resetSegments,
    restoreState: restoreSegmentState,
    addBoundary: addSegmentBoundary,
    removeBoundary: removeSegmentBoundary,
    setSegmentSpeed,
    toggleTrimSegment,
    getSegmentAtTime,
    getExportData: getSegmentExportData,
    isTimeVisible,
    clampToVisibleRange,  // NEW: Single source of truth for valid playback positions
    sourceTimeToVisualTime,
    visualTimeToSourceTime,
    createFrameRangeKey,
    isSegmentTrimmed,
    detrimStart,  // NEW: De-trim from start
    detrimEnd,  // NEW: De-trim from end
  } = useSegments();

  const {
    videoRef,
    videoUrl,
    metadata,
    isPlaying,
    currentTime,
    duration,
    error,
    isLoading,
    loadVideo,
    loadVideoFromUrl,
    togglePlay,
    seek,
    stepForward,
    stepBackward,
    restart,
    handlers,
  // NOTE: Only pass segment functions in Framing mode. In Overlay mode, the rendered
  // video doesn't have segments/trimming, so we pass null to avoid incorrect playback behavior.
  } = useVideo(
    editorMode === 'framing' ? getSegmentAtTime : null,
    editorMode === 'framing' ? clampToVisibleRange : null
  );

  // Crop hook - always active when video loaded
  const {
    aspectRatio,
    keyframes,
    isEndKeyframeExplicit,
    copiedCrop,
    framerate,
    updateAspectRatio,
    addOrUpdateKeyframe,
    removeKeyframe,
    deleteKeyframesInRange,
    cleanupTrimKeyframes,  // NEW: Clean up trim-related keyframes
    copyCropKeyframe,
    pasteCropKeyframe,
    interpolateCrop,
    hasKeyframeAt,
    getCropDataAtTime,
    getKeyframesForExport,
    reset: resetCrop,
    restoreState: restoreCropState,
  } = useCrop(metadata, trimRange);

  // Highlight hook - for highlighting specific players
  // IMPORTANT: Once overlay video exists (rendered or pass-through), ALWAYS use its metadata for highlight
  // This prevents highlight keyframes from being reset when switching modes
  // The highlight is designed for the overlay video, so its metadata should be stable
  // Note: effectiveOverlayMetadata is computed later, so we use a simpler fallback here
  const effectiveHighlightMetadata = overlayVideoMetadata || metadata;
  // No trimRange for highlight - overlay video is already trimmed
  const effectiveHighlightTrimRange = null;

  const {
    keyframes: highlightKeyframes,
    isEndKeyframeExplicit: isHighlightEndKeyframeExplicit,
    copiedHighlight,
    framerate: highlightFramerate,
    isEnabled: isHighlightEnabled,
    highlightDuration,
    toggleEnabled: toggleHighlightEnabled,
    updateHighlightDuration,
    addOrUpdateKeyframe: addOrUpdateHighlightKeyframe,
    removeKeyframe: removeHighlightKeyframe,
    deleteKeyframesInRange: deleteHighlightKeyframesInRange,
    cleanupTrimKeyframes: cleanupHighlightTrimKeyframes,
    copyHighlightKeyframe,
    pasteHighlightKeyframe,
    interpolateHighlight,
    hasKeyframeAt: hasHighlightKeyframeAt,
    getHighlightDataAtTime,
    getKeyframesForExport: getHighlightKeyframesForExport,
    reset: resetHighlight,
  } = useHighlight(effectiveHighlightMetadata, effectiveHighlightTrimRange);

  // Highlight regions hook - boundary-based system (like segments)
  const {
    boundaries: highlightBoundaries,
    regions: highlightRegions,
    keyframes: highlightRegionKeyframes,
    framerate: highlightRegionsFramerate,
    initializeWithDuration: initializeHighlightRegions,
    initializeFromClipMetadata: initializeHighlightRegionsFromClips,
    addRegion: addHighlightRegion,
    deleteRegionByIndex: deleteHighlightRegion,
    moveRegionStart: moveHighlightRegionStart,
    moveRegionEnd: moveHighlightRegionEnd,
    toggleRegionEnabled: toggleHighlightRegion,
    addOrUpdateKeyframe: addHighlightRegionKeyframe,
    removeKeyframe: removeHighlightRegionKeyframe,
    isTimeInEnabledRegion,
    getRegionAtTime,
    getHighlightAtTime: getRegionHighlightAtTime,
    getRegionsForExport,
    reset: resetHighlightRegions,
  } = useHighlightRegions(effectiveHighlightMetadata);

  // Zoom hook
  const {
    zoom,
    panOffset,
    isZoomed,
    MIN_ZOOM,
    MAX_ZOOM,
    zoomIn,
    zoomOut,
    resetZoom,
    zoomByWheel,
    updatePan,
  } = useZoom();

  // Timeline zoom hook
  const {
    timelineZoom,
    scrollPosition: timelineScrollPosition,
    zoomByWheel: timelineZoomByWheel,
    updateScrollPosition: updateTimelineScrollPosition,
    getTimelineScale,
  } = useTimelineZoom();

  // Annotate mode state management (lifted to App level for sidebar/MVC pattern)
  const {
    clipRegions,
    regionsWithLayout: annotateRegionsWithLayout,
    selectedRegionId: annotateSelectedRegionId,
    selectedRegion: annotateSelectedRegion,
    hasClips: hasAnnotateClips,
    clipCount: annotateClipCount,
    initialize: initializeAnnotate,
    reset: resetAnnotate,
    addClipRegion,
    updateClipRegion,
    deleteClipRegion,
    selectRegion: selectAnnotateRegion,
    moveRegionStart: moveAnnotateRegionStart,
    moveRegionEnd: moveAnnotateRegionEnd,
    getRegionAtTime: getAnnotateRegionAtTime,
    getExportData: getAnnotateExportData,
    importAnnotations,
    MAX_NOTES_LENGTH: ANNOTATE_MAX_NOTES_LENGTH,
  } = useAnnotate(annotateVideoMetadata);

  // Frame tolerance for selection - approximately 5 pixels on each side
  // Derived selection state - computed from playhead position and keyframes
  // This eliminates race conditions between auto-selection and manual selection
  const selectedCropKeyframeIndex = useMemo(() => {
    if (!videoUrl) return null;
    const currentFrame = Math.round(currentTime * framerate);
    const index = findKeyframeIndexNearFrame(keyframes, currentFrame, FRAME_TOLERANCE);
    return index !== -1 ? index : null;
  }, [videoUrl, currentTime, framerate, keyframes]);

  const selectedHighlightKeyframeIndex = useMemo(() => {
    if (!videoUrl || !isHighlightEnabled) return null;
    const currentFrame = Math.round(currentTime * highlightFramerate);
    const index = findKeyframeIndexNearFrame(highlightKeyframes, currentFrame, FRAME_TOLERANCE);
    return index !== -1 ? index : null;
  }, [videoUrl, currentTime, highlightFramerate, highlightKeyframes, isHighlightEnabled]);

  /**
   * Clips with current clip's live state merged.
   * Since clip state (keyframes, segments) is managed in useCrop/useSegments hooks,
   * we need to merge the current clip's live state before export.
   */
  const clipsWithCurrentState = useMemo(() => {
    if (!hasClips || !clips || !selectedClipId) return clips;

    // Helper to convert frame-based keyframes to time-based for export
    const convertKeyframesToTime = (keyframes, clipFramerate) => {
      if (!keyframes || !Array.isArray(keyframes)) return [];
      return keyframes.map(kf => {
        // If already has 'time', it's already converted
        if (kf.time !== undefined) return kf;
        // Convert frame to time
        const time = kf.frame / clipFramerate;
        const { frame, ...rest } = kf;
        return { time, ...rest };
      });
    };

    // Helper to calculate default crop for a given aspect ratio
    const calculateDefaultCrop = (sourceWidth, sourceHeight, targetAspectRatio) => {
      if (!sourceWidth || !sourceHeight) {
        return { x: 0, y: 0, width: 0, height: 0 };
      }
      const [ratioW, ratioH] = targetAspectRatio.split(':').map(Number);
      const targetRatio = ratioW / ratioH;
      const videoRatio = sourceWidth / sourceHeight;

      let cropWidth, cropHeight;
      if (videoRatio > targetRatio) {
        cropHeight = sourceHeight;
        cropWidth = cropHeight * targetRatio;
      } else {
        cropWidth = sourceWidth;
        cropHeight = cropWidth / targetRatio;
      }

      const x = (sourceWidth - cropWidth) / 2;
      const y = (sourceHeight - cropHeight) / 2;

      return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(cropWidth),
        height: Math.round(cropHeight)
      };
    };

    // Use getKeyframesForExport() for current clip (proper conversion)
    const currentClipExportKeyframes = getKeyframesForExport();

    // Debug logging
    console.log('[clipsWithCurrentState] Building export state:');
    console.log('  - selectedClipId:', selectedClipId);
    console.log('  - currentClipExportKeyframes:', currentClipExportKeyframes?.length, currentClipExportKeyframes);
    console.log('  - segmentSpeeds:', segmentSpeeds);

    return clips.map(clip => {
      if (clip.id === selectedClipId) {
        // Current clip: use live state from hooks
        const result = {
          ...clip,
          cropKeyframes: currentClipExportKeyframes,
          segments: {
            boundaries: segmentBoundaries,
            segmentSpeeds: segmentSpeeds,
            trimRange: trimRange
          },
          trimRange: trimRange
        };
        console.log(`  - Clip ${clip.id} (CURRENT):`, result.cropKeyframes?.length, 'keyframes, speeds:', result.segments.segmentSpeeds);
        return result;
      }
      // Other clips: convert saved keyframes from frame to time
      let convertedKeyframes = convertKeyframesToTime(clip.cropKeyframes, clip.framerate || 30);

      // FIX: If no keyframes were saved (race condition on fast clip add),
      // generate default keyframes based on clip dimensions and global aspect ratio
      if (convertedKeyframes.length === 0 && clip.sourceWidth && clip.sourceHeight && clip.duration) {
        const defaultCrop = calculateDefaultCrop(clip.sourceWidth, clip.sourceHeight, globalAspectRatio);
        convertedKeyframes = [
          { time: 0, ...defaultCrop },
          { time: clip.duration, ...defaultCrop }
        ];
        console.log(`  - Clip ${clip.id} (saved): EMPTY keyframes - generated defaults:`, convertedKeyframes);
      } else {
        console.log(`  - Clip ${clip.id} (saved): raw=${clip.cropKeyframes?.length}, converted=${convertedKeyframes?.length} keyframes, segments:`, clip.segments);
      }

      return {
        ...clip,
        cropKeyframes: convertedKeyframes
      };
    });
  }, [clips, selectedClipId, getKeyframesForExport, segmentBoundaries, segmentSpeeds, trimRange, hasClips, globalAspectRatio]);

  /**
   * Save current clip's state before switching
   */
  const saveCurrentClipState = useCallback(async () => {
    if (!selectedClipId) {
      console.log('[App] saveCurrentClipState: No selectedClipId, skipping');
      return;
    }

    // Save current segment state including speeds
    const segmentState = {
      boundaries: segmentBoundaries,
      segmentSpeeds: segmentSpeeds,
      trimRange: trimRange,
    };

    console.log('[App] saveCurrentClipState for clip:', selectedClipId);
    console.log('  - keyframes to save:', keyframes?.length, keyframes);
    console.log('  - segmentState:', segmentState);

    // Save to local clip manager state
    updateClipData(selectedClipId, {
      segments: segmentState,
      cropKeyframes: keyframes,
      trimRange: trimRange
    });

    // If this is a project clip, also save to backend
    const currentClip = clips.find(c => c.id === selectedClipId);
    if (currentClip?.workingClipId && selectedProjectId) {
      console.log('[App] Saving framing edits to backend for working clip:', currentClip.workingClipId);
      await saveFramingEdits(currentClip.workingClipId, {
        cropKeyframes: keyframes,
        segments: segmentState,
        trimRange: trimRange
      });
    }

    console.log('[App] Saved state for clip:', selectedClipId);
  }, [selectedClipId, segmentBoundaries, segmentSpeeds, trimRange, keyframes, updateClipData, clips, selectedProjectId, saveFramingEdits]);

  /**
   * Handle file selection - adds clip to clip manager
   */
  const handleFileSelect = async (file) => {
    try {
      // Extract metadata first
      const videoMetadata = await extractVideoMetadata(file);

      // Add clip to the clip manager
      const newClipId = addClip(file, videoMetadata);

      console.log('[App] handleFileSelect: hasClips=', hasClips, 'clips.length=', clips.length, 'selectedClipId=', selectedClipId);

      // If this is the first clip, load it immediately
      if (!hasClips || clips.length === 0) {
        console.log('[App] First clip - loading immediately');
        // Reset all state for fresh start
        resetSegments();
        resetCrop();
        resetHighlight();
        resetHighlightRegions();
        setSelectedLayer('playhead');
        setVideoFile(file);
        await loadVideo(file);
      } else {
        // Additional clips - just add to the list, don't switch to it
        // User stays on the currently selected clip
        console.log('[App] Additional clip added (staying on current clip):', selectedClipId);
      }

      console.log('[App] Added clip:', newClipId, file.name);
    } catch (err) {
      console.error('[App] Failed to add clip:', err);
    }
  };

  /**
   * Handle pre-framed video selection for Overlay mode (skip Framing)
   * Extracts chapter metadata from the video and goes directly to Overlay mode
   */
  const handleFramedVideoSelect = async (file) => {
    if (!file) return;

    try {
      console.log('[App] handleFramedVideoSelect: Processing', file.name);

      // Extract chapters from the video using backend
      const formData = new FormData();
      formData.append('video', file);

      const chaptersResponse = await fetch('http://localhost:8000/api/export/chapters', {
        method: 'POST',
        body: formData,
      });

      let clipMetadata = null;
      if (chaptersResponse.ok) {
        const chaptersData = await chaptersResponse.json();
        const chapters = chaptersData.chapters || [];

        if (chapters.length > 0) {
          // Convert chapters to source_clips format
          clipMetadata = {
            source_clips: chapters.map((chapter, index) => ({
              index,
              name: chapter.title,
              fileName: chapter.title,
              start_time: chapter.start_time,
              end_time: chapter.end_time,
              duration: chapter.end_time - chapter.start_time
            }))
          };
          console.log('[App] Extracted chapter metadata:', clipMetadata);
        } else {
          console.log('[App] No chapters found in video, will create single region');
        }
      } else {
        console.warn('[App] Failed to extract chapters, will create single region');
      }

      // Transition to overlay mode with the video file
      await handleProceedToOverlay(file, clipMetadata);

      console.log('[App] Successfully transitioned to Overlay mode with framed video');
    } catch (err) {
      console.error('[App] Failed to process framed video:', err);
      throw err; // Re-throw so FileUpload can handle the error
    }
  };

  /**
   * Handle game video selection for Annotate mode
   * Transitions to annotate mode where user can extract clips from full game footage
   */
  const handleGameVideoSelect = async (file) => {
    if (!file) return;

    try {
      console.log('[App] handleGameVideoSelect: Processing', file.name);

      // Extract video metadata
      const videoMetadata = await extractVideoMetadata(file);
      console.log('[App] Extracted game video metadata:', videoMetadata);

      // Create object URL for the video
      const videoUrl = URL.createObjectURL(file);

      // Clean up any existing annotate video URL
      if (annotateVideoUrl) {
        URL.revokeObjectURL(annotateVideoUrl);
      }

      // Set annotate state
      setAnnotateVideoFile(file);
      setAnnotateVideoUrl(videoUrl);
      setAnnotateVideoMetadata(videoMetadata);

      // Transition to annotate mode
      setEditorMode('annotate');

      console.log('[App] Successfully transitioned to Annotate mode');
    } catch (err) {
      console.error('[App] Failed to process game video:', err);
      throw err; // Re-throw so FileUpload can handle the error
    }
  };

  /**
   * Handle exiting Annotate mode
   * Clears annotate state and returns to no-video state
   */
  const handleExitAnnotateMode = useCallback(() => {
    console.log('[App] Exiting Annotate mode');

    // Clean up annotate video URL
    if (annotateVideoUrl) {
      URL.revokeObjectURL(annotateVideoUrl);
    }

    // Clear annotate state
    setAnnotateVideoFile(null);
    setAnnotateVideoUrl(null);
    setAnnotateVideoMetadata(null);

    // Return to framing mode (no video loaded state)
    setEditorMode('framing');
  }, [annotateVideoUrl]);

  /**
   * Handle exporting clips from Annotate mode
   * 1. Send clips to backend
   * 2. Backend saves good/brilliant clips and creates projects
   * 3. Trigger downloads via URL endpoints
   * 4. Return to Project Manager
   */
  const handleAnnotateExport = useCallback(async (clipData) => {
    console.log('[App] Annotate export requested with clips:', clipData);

    if (!annotateVideoFile || !clipData || clipData.length === 0) {
      console.error('[App] Cannot export: no video or clips');
      return;
    }

    setIsAnnotateExporting(true);
    try {
      console.log('[App] Starting annotate export...');

      // Prepare form data
      const formData = new FormData();
      formData.append('video', annotateVideoFile);

      // Format clips for API (remove position field if present)
      const clipsForApi = clipData.map(clip => ({
        start_time: clip.start_time,
        end_time: clip.end_time,
        name: clip.name,
        notes: clip.notes || '',
        rating: clip.rating || 3,
        tags: clip.tags || []
      }));

      formData.append('clips_json', JSON.stringify(clipsForApi));

      // Call backend export endpoint
      console.log('[App] Sending export request...');
      const response = await fetch('http://localhost:8000/api/annotate/export', {
        method: 'POST',
        body: formData,
      });

      console.log('[App] Export response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Export failed: ${response.status}`);
      }

      // Parse response (now lightweight - just URLs, no base64)
      const result = await response.json();

      console.log('[App] Annotate export response:', {
        success: result.success,
        rawClipsCount: result.created?.raw_clips?.length,
        projectsCount: result.created?.projects?.length,
        downloads: Object.keys(result.downloads || {})
      });

      // Trigger downloads via URL endpoints
      if (result.downloads) {
        // 1. Download annotations.tsv
        if (result.downloads.annotations?.url) {
          console.log('[App] Downloading annotations TSV...');
          const a = document.createElement('a');
          a.href = `http://localhost:8000${result.downloads.annotations.url}`;
          a.download = result.downloads.annotations.filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          console.log('[App] Downloaded:', result.downloads.annotations.filename);
        }

        // 2. Download clips compilation video
        if (result.downloads.clips_compilation?.url) {
          console.log('[App] Downloading clips compilation...');
          // Small delay to avoid browser blocking multiple downloads
          await new Promise(resolve => setTimeout(resolve, 500));
          const a = document.createElement('a');
          a.href = `http://localhost:8000${result.downloads.clips_compilation.url}`;
          a.download = result.downloads.clips_compilation.filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          console.log('[App] Downloaded:', result.downloads.clips_compilation.filename);
        }
      }

      // Clean up annotate state
      if (annotateVideoUrl) {
        URL.revokeObjectURL(annotateVideoUrl);
      }
      setAnnotateVideoFile(null);
      setAnnotateVideoUrl(null);
      setAnnotateVideoMetadata(null);
      resetAnnotate();

      // Refresh projects list
      await fetchProjects();

      // Show success message with what was created
      const projectsCreated = result.created?.projects?.length || 0;
      const clipsCreated = result.created?.raw_clips?.length || 0;
      const serverMessage = result.message || `Created ${clipsCreated} clips and ${projectsCreated} projects`;

      console.log(`[App] ${serverMessage}`);

      // Show user-friendly success message
      alert(`Export complete!\n\n${serverMessage}`);

      // Return to Project Manager
      setEditorMode('project-manager');

      console.log('[App] Annotate export complete');

    } catch (err) {
      console.error('[App] Annotate export failed:', err);
      alert(`Export failed: ${err.message}\n\nNote: If clips were being saved, they may still be on the server.`);
    } finally {
      setIsAnnotateExporting(false);
    }
  }, [annotateVideoFile, annotateVideoUrl, resetAnnotate, fetchProjects]);

  /**
   * Handle fullscreen toggle for Annotate mode
   */
  const handleAnnotateToggleFullscreen = useCallback(() => {
    if (!annotateContainerRef.current) return;

    if (!annotateFullscreen) {
      // Enter fullscreen
      if (annotateContainerRef.current.requestFullscreen) {
        annotateContainerRef.current.requestFullscreen();
      }
    } else {
      // Exit fullscreen
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }, [annotateFullscreen]);

  /**
   * Handle Add Clip button click (non-fullscreen mode)
   * Pauses video and shows the clip creation overlay
   */
  const handleAddClipFromButton = useCallback(() => {
    // Pause the video
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
    // Show the overlay
    setShowAnnotateOverlay(true);
  }, []);

  /**
   * Handle creating a clip from fullscreen overlay
   */
  const handleAnnotateFullscreenCreateClip = useCallback((clipData) => {
    // clipData: { startTime, duration, rating, notes, tags, name }
    const newRegion = addClipRegion(
      clipData.startTime,
      clipData.duration,
      clipData.notes,
      clipData.rating,
      '', // position (not used - tags can be from any position)
      clipData.tags,
      clipData.name
    );
    if (newRegion) {
      seek(newRegion.startTime);
    }
    setShowAnnotateOverlay(false);
  }, [addClipRegion, seek]);

  /**
   * Handle updating an existing clip from fullscreen overlay
   */
  const handleAnnotateFullscreenUpdateClip = useCallback((regionId, updates) => {
    // updates: { duration, rating, notes, tags, name }
    updateClipRegion(regionId, updates);
    setShowAnnotateOverlay(false);
  }, [updateClipRegion]);

  /**
   * Handle closing the fullscreen overlay without creating a clip
   */
  const handleAnnotateOverlayClose = useCallback(() => {
    setShowAnnotateOverlay(false);
  }, []);

  /**
   * Handle resuming playback from fullscreen overlay
   */
  const handleAnnotateOverlayResume = useCallback(() => {
    setShowAnnotateOverlay(false);
    togglePlay();
  }, [togglePlay]);

  /**
   * Handle annotate region selection - selects the region AND seeks to its start
   */
  const handleSelectAnnotateRegion = useCallback((regionId) => {
    const region = clipRegions.find(r => r.id === regionId);
    if (region) {
      selectAnnotateRegion(regionId);
      seek(region.startTime);
    }
  }, [clipRegions, selectAnnotateRegion, seek]);

  /**
   * Handle clip selection from sidebar
   */
  const handleSelectClip = useCallback(async (clipId) => {
    if (clipId === selectedClipId) return;

    // Save current clip's state
    saveCurrentClipState();

    // Find the clip to load
    const clip = clips.find(c => c.id === clipId);
    if (!clip) {
      console.error('[App] Clip not found:', clipId);
      return;
    }

    // Select the new clip
    selectClip(clipId);

    // Reset hooks first
    resetSegments();
    resetCrop();
    resetHighlight();
    resetHighlightRegions();
    setSelectedLayer('playhead');

    // Load the video - project clips use fileUrl, local clips use file
    if (clip.file) {
      setVideoFile(clip.file);
      await loadVideo(clip.file);
    } else if (clip.fileUrl) {
      console.log('[App] Loading clip from URL:', clip.fileUrl);
      await loadVideoFromUrl(clip.fileUrl, clip.fileName);
    } else {
      console.error('[App] Clip has no file or fileUrl:', clipId);
      return;
    }

    // Restore saved state for this clip (if any)
    const hasSavedSegments = clip.segments && (
      (clip.segments.boundaries && clip.segments.boundaries.length > 2) ||
      (clip.segments.segmentSpeeds && Object.keys(clip.segments.segmentSpeeds).length > 0) ||
      clip.segments.trimRange
    );
    const hasSavedCrop = clip.cropKeyframes && clip.cropKeyframes.length > 0;

    if (hasSavedSegments) {
      console.log('[App] Restoring segment state for clip:', clipId, clip.segments);
      restoreSegmentState(clip.segments, clip.duration);
    }

    if (hasSavedCrop) {
      const endFrame = Math.round(clip.duration * (clip.framerate || 30));
      console.log('[App] Restoring crop keyframes for clip:', clipId, 'endFrame:', endFrame, clip.cropKeyframes);
      restoreCropState(clip.cropKeyframes, endFrame);
    }

    console.log('[App] Switched to clip:', clipId, clip.fileName);
  }, [selectedClipId, saveCurrentClipState, clips, selectClip, resetSegments, resetCrop, resetHighlight, resetHighlightRegions, loadVideo, loadVideoFromUrl, restoreSegmentState, restoreCropState]);

  /**
   * Handle clip deletion from sidebar
   */
  const handleDeleteClip = useCallback((clipId) => {
    const clipToDelete = clips.find(c => c.id === clipId);
    if (!clipToDelete) return;

    // If deleting the currently selected clip, need to handle differently
    if (clipId === selectedClipId) {
      // Find another clip to select
      const remainingClips = clips.filter(c => c.id !== clipId);

      if (remainingClips.length > 0) {
        // Select the first remaining clip
        handleSelectClip(remainingClips[0].id);
      } else {
        // No more clips - reset everything
        resetSegments();
        resetCrop();
        resetHighlight();
        resetHighlightRegions();
        setVideoFile(null);
        // Clear video - loadVideo with null will handle cleanup
      }
    }

    // Delete the clip
    deleteClip(clipId);

    console.log('[App] Deleted clip:', clipId, clipToDelete.fileName);
  }, [clips, selectedClipId, handleSelectClip, deleteClip, resetSegments, resetCrop, resetHighlight, resetHighlightRegions]);

  /**
   * Handle adding a new clip from sidebar
   */
  const handleAddClipFromSidebar = useCallback((file) => {
    handleFileSelect(file);
  }, []);

  // Initialize segments when video duration is available
  useEffect(() => {
    if (duration && duration > 0) {
      initializeSegments(duration);
    }
  }, [duration, initializeSegments]);

  // Initialize highlight regions when overlay video duration is available
  useEffect(() => {
    const highlightDuration = overlayVideoMetadata?.duration || duration;
    if (highlightDuration && highlightDuration > 0) {
      initializeHighlightRegions(highlightDuration);
    }
  }, [overlayVideoMetadata?.duration, duration, initializeHighlightRegions]);

  // Auto-create highlight regions from clip metadata when transitioning from Framing
  // This creates a 5-second region at the start of each clip for easy highlighting
  useEffect(() => {
    if (overlayClipMetadata && overlayVideoMetadata && highlightRegions.length === 0) {
      const count = initializeHighlightRegionsFromClips(
        overlayClipMetadata,
        overlayVideoMetadata.width,
        overlayVideoMetadata.height
      );

      if (count > 0) {
        console.log(`[App] Auto-created ${count} highlight regions from clip metadata`);
      }

      // Clear clip metadata after processing to prevent re-triggering
      setOverlayClipMetadata(null);
    }
  }, [overlayClipMetadata, overlayVideoMetadata, highlightRegions.length, initializeHighlightRegionsFromClips]);

  // Sync video mute state with export audio setting
  // When user turns off audio in export settings, also mute playback preview
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = !includeAudio;
    }
  }, [includeAudio, videoRef]);

  // Annotate mode: sync playback speed with video element
  useEffect(() => {
    if (editorMode === 'annotate' && videoRef.current) {
      videoRef.current.playbackRate = annotatePlaybackSpeed;
    }
  }, [annotatePlaybackSpeed, editorMode, videoRef]);

  // Annotate mode: detect fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = !!document.fullscreenElement;
      setAnnotateFullscreen(isFullscreen);
      // Close overlay when exiting fullscreen
      if (!isFullscreen) {
        setShowAnnotateOverlay(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Annotate mode: show overlay when TRANSITIONING from playing to paused while in fullscreen
  // (not when entering fullscreen while already paused)
  useEffect(() => {
    // Detect pause transition: was playing, now paused
    const justPaused = wasPlayingRef.current && !isPlaying;

    // Update ref for next render
    wasPlayingRef.current = isPlaying;

    // Only show overlay when pause transition happens while in fullscreen
    if (editorMode === 'annotate' && annotateFullscreen && justPaused) {
      setShowAnnotateOverlay(true);
    }
  }, [editorMode, annotateFullscreen, isPlaying]);

  // DERIVED STATE: Single source of truth
  // - If dragging: show live preview (dragCrop)
  // - Otherwise: interpolate from keyframes
  // IMPORTANT: Extract only spatial properties (x, y, width, height) - no time!
  const currentCropState = useMemo(() => {
    let crop;
    if (dragCrop) {
      crop = dragCrop;
    } else if (keyframes.length === 0) {
      return null;
    } else {
      crop = interpolateCrop(currentTime);
    }

    // Strip time property - CropOverlay should only know about spatial coords
    if (!crop) return null;
    return {
      x: crop.x,
      y: crop.y,
      width: crop.width,
      height: crop.height
    };
  }, [dragCrop, keyframes, currentTime, interpolateCrop]);

  // DERIVED STATE: Current highlight state
  // Shows highlight when playhead is in an enabled region
  const currentHighlightState = useMemo(() => {
    // If dragging, show the drag highlight
    if (dragHighlight) {
      return {
        x: dragHighlight.x,
        y: dragHighlight.y,
        radiusX: dragHighlight.radiusX,
        radiusY: dragHighlight.radiusY,
        opacity: dragHighlight.opacity,
        color: dragHighlight.color
      };
    }

    // Check if we're in an enabled region
    if (!isTimeInEnabledRegion(currentTime)) {
      return null;
    }

    // Get interpolated/exact highlight from the region at current time
    const highlight = getRegionHighlightAtTime(currentTime);
    if (!highlight) return null;

    return {
      x: highlight.x,
      y: highlight.y,
      radiusX: highlight.radiusX,
      radiusY: highlight.radiusY,
      opacity: highlight.opacity,
      color: highlight.color
    };
  }, [dragHighlight, currentTime, isTimeInEnabledRegion, getRegionHighlightAtTime]);

  // DERIVED STATE: Check if any framing edits have been made
  // Used to determine if video needs to be exported before overlay mode
  const hasFramingEdits = useMemo(() => {
    // Check for crop edits: more than 2 keyframes means user added intermediate keyframes
    // or if start/end keyframes differ (user moved the crop)
    const hasCropEdits = keyframes.length > 2 || (
      keyframes.length === 2 &&
      (keyframes[0].x !== keyframes[1].x ||
       keyframes[0].y !== keyframes[1].y ||
       keyframes[0].width !== keyframes[1].width ||
       keyframes[0].height !== keyframes[1].height)
    );

    // Check for trim edits
    const hasTrimEdits = trimRange !== null;

    // Check for speed edits
    const hasSpeedEdits = Object.values(segmentSpeeds).some(speed => speed !== 1);

    // Check for segment splits (more than default boundaries)
    const hasSegmentSplits = segmentBoundaries.length > 2;

    return hasCropEdits || hasTrimEdits || hasSpeedEdits || hasSegmentSplits;
  }, [keyframes, trimRange, segmentSpeeds, segmentBoundaries]);

  // Check if we have multiple clips (requires export before overlay)
  const hasMultipleClips = clips.length > 1;

  // DERIVED STATE: Effective overlay video (pass-through or rendered)
  // Pass-through only allowed when: single clip AND no framing edits
  const effectiveOverlayVideoUrl = useMemo(() => {
    // If we have a rendered overlay video, always use it
    if (overlayVideoUrl) return overlayVideoUrl;
    // Pass-through only for single clip with no edits
    if (!hasMultipleClips && !hasFramingEdits && videoUrl) return videoUrl;
    // Otherwise, no overlay video available (must export first)
    return null;
  }, [overlayVideoUrl, hasMultipleClips, hasFramingEdits, videoUrl]);

  const effectiveOverlayMetadata = useMemo(() => {
    // If we have rendered overlay metadata, use it
    if (overlayVideoMetadata) return overlayVideoMetadata;
    // Pass-through only for single clip with no edits
    if (!hasMultipleClips && !hasFramingEdits && metadata) return metadata;
    // Otherwise, no metadata
    return null;
  }, [overlayVideoMetadata, hasMultipleClips, hasFramingEdits, metadata]);

  const effectiveOverlayFile = useMemo(() => {
    // If we have a rendered overlay file, use it
    if (overlayVideoFile) return overlayVideoFile;
    // Pass-through only for single clip with no edits
    if (!hasMultipleClips && !hasFramingEdits && videoFile) return videoFile;
    // Otherwise, no file
    return null;
  }, [overlayVideoFile, hasMultipleClips, hasFramingEdits, videoFile]);

  // Player detection for click-to-track feature
  // Only enabled when in overlay mode AND playhead is in a highlight region
  const playerDetectionEnabled = editorMode === 'overlay' && isTimeInEnabledRegion(currentTime);

  const {
    detections: playerDetections,
    isLoading: isDetectionLoading,
    isUploading: isDetectionUploading,
    error: detectionError
  } = usePlayerDetection({
    videoFile: effectiveOverlayFile,
    currentTime,
    framerate: highlightRegionsFramerate || 30,
    enabled: playerDetectionEnabled,
    confidenceThreshold: 0.5
  });

  // Handle player selection from detection overlay
  // When user clicks on a detected player box, create a keyframe at that position
  // The highlight region has permanent start/end keyframes; user clicks add intermediate keyframes
  const handlePlayerSelect = useCallback((playerData) => {
    // playerData contains: { x, y, radiusX, radiusY, confidence }

    // Get the current highlight region
    const region = getRegionAtTime(currentTime);
    if (!region) {
      console.warn('[App] No highlight region at current time');
      return;
    }

    // Use default highlight appearance
    const defaultOpacity = currentHighlightState?.opacity ?? 0.3;
    const defaultColor = currentHighlightState?.color ?? '#FFFF00';

    // Create keyframe at clicked position
    const highlight = {
      x: playerData.x,
      y: playerData.y,
      radiusX: playerData.radiusX,
      radiusY: playerData.radiusY,
      opacity: defaultOpacity,
      color: defaultColor
    };

    console.log('[App] Player selected, adding keyframe:', {
      time: currentTime,
      position: { x: playerData.x, y: playerData.y },
      region: { start: region.startTime, end: region.endTime }
    });

    addHighlightRegionKeyframe(currentTime, highlight, duration);
  }, [
    currentTime, duration, currentHighlightState, addHighlightRegionKeyframe, getRegionAtTime
  ]);

  // Debug: Log keyframes changes (disabled - too frequent, use React DevTools instead)

  // Debug: Log currentCropState changes (disabled - too spammy)
  // useEffect(() => {
  //   console.log('[App] Current crop state:', currentCropState);
  // }, [currentCropState]);

  // BUG FIX: Auto-cleanup trim keyframes when trimRange is cleared
  // Use ref to track previous value to avoid cleanup on initial mount
  const prevTrimRangeRef = useRef(undefined);
  useEffect(() => {
    // Only cleanup if transitioning from non-null to null (not on initial mount)
    if (prevTrimRangeRef.current !== undefined && prevTrimRangeRef.current !== null && trimRange === null) {
      cleanupTrimKeyframes();
      cleanupHighlightTrimKeyframes();
    }
    prevTrimRangeRef.current = trimRange;
  }, [trimRange, cleanupTrimKeyframes, cleanupHighlightTrimKeyframes]);

  // BUG FIX: Auto-reposition playhead when it becomes invalid after trim operation
  // This ensures the playhead is always within the visible (non-trimmed) range
  const lastSeekTimeRef = useRef(null);
  useEffect(() => {
    if (!trimRange || !videoUrl) return;

    // Check if current playhead position is outside the valid trim range
    const isPlayheadInvalid = currentTime < trimRange.start || currentTime > trimRange.end;

    if (isPlayheadInvalid) {
      // Clamp to the nearest valid position
      const validTime = clampToVisibleRange(currentTime);

      // Only seek if the difference is significant (avoid floating point precision loops)
      const threshold = 0.001; // 1ms threshold
      const needsSeek = lastSeekTimeRef.current === null ||
                        Math.abs(validTime - lastSeekTimeRef.current) > threshold;

      if (needsSeek) {
        lastSeekTimeRef.current = validTime;
        seek(validTime);
      }
    }
  }, [trimRange, currentTime, videoUrl, clampToVisibleRange, seek]);

  // Auto-update selected layer based on which keyframes are at current position
  // Selection state (selectedCropKeyframeIndex, selectedHighlightKeyframeIndex) is now
  // derived via useMemo, eliminating race conditions between auto and manual selection
  useEffect(() => {
    if (!videoUrl) return;

    const hasCropKeyframe = selectedCropKeyframeIndex !== null;
    const hasHighlightKeyframe = selectedHighlightKeyframeIndex !== null;

    // Update selected layer based on what's available
    // Only change layer if current layer has no keyframe but another does
    if (hasCropKeyframe && hasHighlightKeyframe) {
      // Both have keyframes - keep current layer selection, but ensure it's a keyframe layer
      if (selectedLayer === 'playhead') {
        setSelectedLayer('crop'); // Default to crop when coming from playhead
      }
    } else if (hasCropKeyframe && !hasHighlightKeyframe) {
      // Only crop has keyframe
      if (selectedLayer !== 'crop') {
        setSelectedLayer('crop');
      }
    } else if (!hasCropKeyframe && hasHighlightKeyframe) {
      // Only highlight has keyframe
      if (selectedLayer !== 'highlight') {
        setSelectedLayer('highlight');
      }
    }
    // If neither has keyframe, don't change selectedLayer
  }, [selectedCropKeyframeIndex, selectedHighlightKeyframeIndex, videoUrl, selectedLayer]);

  // Handler functions for copy/paste (defined BEFORE useEffect to avoid initialization errors)
  const handleCopyCrop = (time = currentTime) => {
    if (videoUrl) {
      copyCropKeyframe(time);
    }
  };

  const handlePasteCrop = (time = currentTime) => {
    if (videoUrl && copiedCrop) {
      pasteCropKeyframe(time, duration);
      // Note: Don't move playhead - paste happens at current playhead position
    }
  };

  // Handler functions for highlight copy/paste
  const handleCopyHighlight = (time = currentTime) => {
    if (videoUrl && isHighlightEnabled) {
      copyHighlightKeyframe(time);
    }
  };

  const handlePasteHighlight = (time = currentTime) => {
    if (videoUrl && copiedHighlight && isHighlightEnabled) {
      pasteHighlightKeyframe(time, duration);
      // Note: Don't move playhead - paste happens at current playhead position
    }
  };

  /**
   * Coordinated segment trim handler
   * This function ensures keyframes are properly managed when trimming segments:
   * 1. Deletes all crop and highlight keyframes in the trimmed region
   * 2. Updates the boundary crop and highlight keyframes with data from the furthest keyframes in the trimmed region
   * 3. Toggles the segment trim state
   *
   * Both crop and highlight keyframes use identical trim logic for consistency.
   */
  const handleTrimSegment = (segmentIndex) => {
    if (!duration || segmentIndex < 0 || segmentIndex >= segments.length) return;

    const segment = segments[segmentIndex];
    const isCurrentlyTrimmed = segment.isTrimmed;

    console.log(`[App] Trim segment ${segmentIndex}: ${segment.start.toFixed(2)}s-${segment.end.toFixed(2)}s, isTrimmed=${isCurrentlyTrimmed}, cropKFs=${keyframes.length}, highlightKFs=${highlightKeyframes.length}`);

    // INVARIANT: Can only trim edge segments
    if (process.env.NODE_ENV === 'development') {
      if (!isCurrentlyTrimmed && !segment.isFirst && !segment.isLast) {
        console.error('⚠️ INVARIANT VIOLATION: Attempting to trim non-edge segment:', segmentIndex);
        return;
      }
    }

    if (!isCurrentlyTrimmed) {
      // We're about to trim this segment

      // ========== CROP KEYFRAMES ==========
      // Step 1: Find the furthest crop keyframe in the trimmed region to preserve its data
      let boundaryTime;
      let furthestCropKeyframeInTrimmedRegion = null;

      if (segment.isLast) {
        // Trimming from the end
        boundaryTime = segment.start;

        // Find the furthest keyframe before or at the segment end
        for (let i = keyframes.length - 1; i >= 0; i--) {
          const kfTime = keyframes[i].frame / framerate;
          if (kfTime >= segment.start && kfTime <= segment.end) {
            furthestCropKeyframeInTrimmedRegion = keyframes[i];
            break;
          }
        }
      } else if (segment.isFirst) {
        // Trimming from the start
        boundaryTime = segment.end;

        // Find the furthest keyframe after or at the segment start
        for (let i = 0; i < keyframes.length; i++) {
          const kfTime = keyframes[i].frame / framerate;
          if (kfTime >= segment.start && kfTime <= segment.end) {
            furthestCropKeyframeInTrimmedRegion = keyframes[i];
          }
        }
      }

      // Step 2: If we found a crop keyframe in the trimmed region, get its data
      // Otherwise, interpolate at the furthest point in the trimmed region
      let cropDataToPreserve = null;
      if (furthestCropKeyframeInTrimmedRegion) {
        const kfTime = furthestCropKeyframeInTrimmedRegion.frame / framerate;
        cropDataToPreserve = getCropDataAtTime(kfTime);
      } else {
        // No keyframe in trimmed region, interpolate at the far edge
        const edgeTime = segment.isLast ? segment.end : segment.start;
        cropDataToPreserve = getCropDataAtTime(edgeTime);
      }

      // Step 3: Delete crop keyframes in the trimmed range
      deleteKeyframesInRange(segment.start, segment.end, duration);

      // Step 4: Reconstitute the permanent keyframe at the boundary
      // The permanent keyframe (frame 0 or end) was deleted in the trimmed range,
      // so we reconstitute it at the new boundary with origin='permanent'
      if (cropDataToPreserve && boundaryTime !== undefined) {
        addOrUpdateKeyframe(boundaryTime, cropDataToPreserve, duration, 'permanent');
      }

      // ========== HIGHLIGHT KEYFRAMES ==========
      // Step 1: Find the furthest highlight keyframe in the trimmed region to preserve its data
      let furthestHighlightKeyframeInTrimmedRegion = null;

      if (segment.isLast) {
        // Trimming from the end
        // Find the furthest keyframe before or at the segment end
        for (let i = highlightKeyframes.length - 1; i >= 0; i--) {
          const kfTime = highlightKeyframes[i].frame / framerate;
          if (kfTime >= segment.start && kfTime <= segment.end) {
            furthestHighlightKeyframeInTrimmedRegion = highlightKeyframes[i];
            break;
          }
        }
      } else if (segment.isFirst) {
        // Trimming from the start
        // Find the furthest keyframe after or at the segment start
        for (let i = 0; i < highlightKeyframes.length; i++) {
          const kfTime = highlightKeyframes[i].frame / framerate;
          if (kfTime >= segment.start && kfTime <= segment.end) {
            furthestHighlightKeyframeInTrimmedRegion = highlightKeyframes[i];
          }
        }
      }

      // Step 2: If we found a highlight keyframe in the trimmed region, get its data
      // Otherwise, interpolate at the furthest point in the trimmed region
      let highlightDataToPreserve = null;
      if (furthestHighlightKeyframeInTrimmedRegion) {
        const kfTime = furthestHighlightKeyframeInTrimmedRegion.frame / framerate;
        highlightDataToPreserve = getHighlightDataAtTime(kfTime);
      } else {
        // No keyframe in trimmed region, interpolate at the far edge
        const edgeTime = segment.isLast ? segment.end : segment.start;
        highlightDataToPreserve = getHighlightDataAtTime(edgeTime);
      }

      // Step 3: Delete highlight keyframes in the trimmed range
      deleteHighlightKeyframesInRange(segment.start, segment.end, duration);

      // Step 4: Reconstitute the permanent highlight keyframe at the boundary
      // The permanent keyframe was deleted in the trimmed range,
      // so we reconstitute it at the new boundary with origin='permanent'
      if (highlightDataToPreserve && boundaryTime !== undefined) {
        addOrUpdateHighlightKeyframe(boundaryTime, highlightDataToPreserve, duration, 'permanent');
      }
    }
    // Note: Cleanup of trim keyframes is now automatic via useEffect watching trimRange

    // Step 5: Toggle the trim state (this works for both trimming and restoring)

    // NOTE: Keyframe state updates happen asynchronously via React's batching.
    // Check the "[App] Keyframes changed" log to see the actual updated state.
    // setTimeout closures capture stale variables and show incorrect state.

    toggleTrimSegment(segmentIndex);
  };

  /**
   * Coordinated de-trim handler for start
   * This function ensures keyframes are properly reconstituted when un-trimming from start:
   * 1. Gets the keyframe data at the current trim boundary
   * 2. Deletes the keyframe at the trim boundary
   * 3. Reconstitutes the keyframe at frame 0
   * 4. Calls the original detrimStart function
   */
  const handleDetrimStart = () => {
    if (!trimRange || !duration) return;

    console.log(`[App] Detrim start: boundary=${trimRange.start.toFixed(2)}s, cropKFs=${keyframes.length}, highlightKFs=${highlightKeyframes.length}`);

    // The current trim boundary is trimRange.start
    const boundaryTime = trimRange.start;
    const boundaryFrame = Math.round(boundaryTime * framerate);

    // ========== CROP KEYFRAMES ==========
    // Get data from keyframe at the trim boundary
    const cropDataAtBoundary = getCropDataAtTime(boundaryTime);

    // Delete the keyframe at the trim boundary (if it exists and is not frame 0)
    if (boundaryFrame > 0) {
      const cropKfAtBoundary = keyframes.find(kf => kf.frame === boundaryFrame);
      if (cropKfAtBoundary && cropKfAtBoundary.origin === 'permanent') {
        // We need to delete this keyframe - use a small range around it
        deleteKeyframesInRange(boundaryTime - 0.001, boundaryTime + 0.001, duration);
      }
    }

    // Reconstitute the keyframe at frame 0
    if (cropDataAtBoundary) {
      addOrUpdateKeyframe(0, cropDataAtBoundary, duration, 'permanent');
    }

    // ========== HIGHLIGHT KEYFRAMES ==========
    // Get data from keyframe at the trim boundary
    const highlightDataAtBoundary = getHighlightDataAtTime(boundaryTime);

    // Delete the keyframe at the trim boundary (if it exists and is not frame 0)
    if (boundaryFrame > 0) {
      const highlightKfAtBoundary = highlightKeyframes.find(kf => kf.frame === boundaryFrame);
      if (highlightKfAtBoundary && highlightKfAtBoundary.origin === 'permanent') {
        deleteHighlightKeyframesInRange(boundaryTime - 0.001, boundaryTime + 0.001, duration);
      }
    }

    // Reconstitute the keyframe at frame 0
    if (highlightDataAtBoundary) {
      addOrUpdateHighlightKeyframe(0, highlightDataAtBoundary, duration, 'permanent');
    }

    // Call the original detrimStart function to update trimRange
    detrimStart();
  };

  /**
   * Coordinated de-trim handler for end
   * This function ensures keyframes are properly reconstituted when un-trimming from end:
   * 1. Gets the keyframe data at the current trim boundary
   * 2. Deletes the keyframe at the trim boundary
   * 3. Reconstitutes the keyframe at the original end position
   * 4. Calls the original detrimEnd function
   */
  const handleDetrimEnd = () => {
    if (!trimRange || !duration) return;

    console.log(`[App] Detrim end: boundary=${trimRange.end.toFixed(2)}s, cropKFs=${keyframes.length}, highlightKFs=${highlightKeyframes.length}`);

    // The current trim boundary is trimRange.end
    const boundaryTime = trimRange.end;
    const boundaryFrame = Math.round(boundaryTime * framerate);
    const endFrame = Math.round(duration * framerate);

    // ========== CROP KEYFRAMES ==========
    // Get data from keyframe at the trim boundary
    const cropDataAtBoundary = getCropDataAtTime(boundaryTime);

    // Delete the keyframe at the trim boundary (if it exists and is not the end frame)
    if (boundaryFrame < endFrame) {
      const cropKfAtBoundary = keyframes.find(kf => kf.frame === boundaryFrame);
      if (cropKfAtBoundary && cropKfAtBoundary.origin === 'permanent') {
        deleteKeyframesInRange(boundaryTime - 0.001, boundaryTime + 0.001, duration);
      }
    }

    // Reconstitute the keyframe at the original end
    if (cropDataAtBoundary) {
      addOrUpdateKeyframe(duration, cropDataAtBoundary, duration, 'permanent');
    }

    // ========== HIGHLIGHT KEYFRAMES ==========
    // Get data from keyframe at the trim boundary
    const highlightDataAtBoundary = getHighlightDataAtTime(boundaryTime);
    const highlightEndFrame = Math.round(highlightDuration * highlightFramerate);

    // Delete the keyframe at the trim boundary (if it exists and is not the highlight end frame)
    if (boundaryFrame < highlightEndFrame) {
      const highlightKfAtBoundary = highlightKeyframes.find(kf => kf.frame === boundaryFrame);
      if (highlightKfAtBoundary && highlightKfAtBoundary.origin === 'permanent') {
        deleteHighlightKeyframesInRange(boundaryTime - 0.001, boundaryTime + 0.001, duration);
      }
    }

    // Reconstitute the keyframe at the highlight end
    if (highlightDataAtBoundary && boundaryTime < highlightDuration) {
      addOrUpdateHighlightKeyframe(highlightDuration, highlightDataAtBoundary, duration, 'permanent');
    }

    // Call the original detrimEnd function to update trimRange
    detrimEnd();
  };

  // Keyboard handler: Space bar toggles play/pause
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Don't handle if typing in an input or textarea
      const tagName = event.target.tagName.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea') {
        return;
      }

      // Only handle spacebar if any video is loaded (framing, overlay, or annotate mode)
      const hasVideo = videoUrl || effectiveOverlayVideoUrl || annotateVideoUrl;
      if (event.code === 'Space' && hasVideo) {
        // Prevent default spacebar behavior (page scroll)
        event.preventDefault();
        togglePlay();
      }
    };

    // Add event listener
    document.addEventListener('keydown', handleKeyDown);

    // Cleanup on unmount
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [videoUrl, effectiveOverlayVideoUrl, annotateVideoUrl, togglePlay]);

  // Keyboard handler: Ctrl-C/Cmd-C copies crop, Ctrl-V/Cmd-V pastes crop
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Only handle if any video is loaded (framing or overlay mode)
      const hasVideo = videoUrl || effectiveOverlayVideoUrl;
      if (!hasVideo) return;

      // Check for Ctrl-C or Cmd-C (Mac)
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyC') {
        // Only prevent default if no text is selected (to allow normal browser copy)
        if (window.getSelection().toString().length === 0) {
          event.preventDefault();
          handleCopyCrop();
        }
      }

      // Check for Ctrl-V or Cmd-V (Mac)
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyV') {
        // Only prevent default if we have crop data to paste
        if (copiedCrop) {
          event.preventDefault();
          handlePasteCrop();
        }
      }
    };

    // Add event listener
    document.addEventListener('keydown', handleKeyDown);

    // Cleanup on unmount
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [videoUrl, effectiveOverlayVideoUrl, currentTime, duration, copiedCrop, copyCropKeyframe, pasteCropKeyframe]);

  // Keyboard handler: Arrow keys for layer-specific navigation
  useEffect(() => {
    const handleArrowKeys = (event) => {
      // Only handle if any video is loaded (framing or overlay mode) and arrow keys pressed
      const hasVideo = videoUrl || effectiveOverlayVideoUrl;
      if (!hasVideo) return;
      if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return;

      // Don't handle if modifier keys are pressed (let other shortcuts work)
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      event.preventDefault();

      const isLeft = event.code === 'ArrowLeft';
      const direction = isLeft ? -1 : 1;

      switch (selectedLayer) {
        case 'playhead': {
          // Move playhead one frame in the direction
          if (isLeft) {
            stepBackward();
          } else {
            stepForward();
          }
          break;
        }

        case 'crop': {
          // Navigate to next/previous crop keyframe
          // Selection is derived from playhead position, so just seek to keyframe time
          if (keyframes.length === 0) break;

          let targetIndex;
          if (selectedCropKeyframeIndex === null) {
            // No keyframe selected, select based on direction
            targetIndex = isLeft ? keyframes.length - 1 : 0;
          } else {
            // Move to next/previous keyframe
            targetIndex = selectedCropKeyframeIndex + direction;
            // Clamp to valid range
            targetIndex = Math.max(0, Math.min(targetIndex, keyframes.length - 1));
          }

          if (targetIndex !== selectedCropKeyframeIndex) {
            const keyframe = keyframes[targetIndex];
            const keyframeTime = keyframe.frame / framerate;
            seek(keyframeTime); // Selection updates automatically via useMemo
          }
          break;
        }

        case 'highlight': {
          // Navigate to next/previous highlight keyframe
          // Selection is derived from playhead position, so just seek to keyframe time
          if (highlightKeyframes.length === 0 || !isHighlightEnabled) break;

          let targetIndex;
          if (selectedHighlightKeyframeIndex === null) {
            // No keyframe selected, select based on direction
            targetIndex = isLeft ? highlightKeyframes.length - 1 : 0;
          } else {
            // Move to next/previous keyframe
            targetIndex = selectedHighlightKeyframeIndex + direction;
            // Clamp to valid range
            targetIndex = Math.max(0, Math.min(targetIndex, highlightKeyframes.length - 1));
          }

          if (targetIndex !== selectedHighlightKeyframeIndex) {
            const keyframe = highlightKeyframes[targetIndex];
            const keyframeTime = keyframe.frame / highlightFramerate;
            seek(keyframeTime); // Selection updates automatically via useMemo
          }
          break;
        }
      }
    };

    document.addEventListener('keydown', handleArrowKeys);
    return () => document.removeEventListener('keydown', handleArrowKeys);
  }, [videoUrl, effectiveOverlayVideoUrl, selectedLayer, selectedCropKeyframeIndex, selectedHighlightKeyframeIndex, keyframes, highlightKeyframes, framerate, highlightFramerate, isHighlightEnabled, stepForward, stepBackward, seek]);

  // Handle crop changes during drag/resize (live preview)
  const handleCropChange = (newCrop) => {
    setDragCrop(newCrop);
  };

  // Handle crop complete (create keyframe and clear drag state)
  const handleCropComplete = (cropData) => {
    const frame = Math.round(currentTime * framerate);
    const isUpdate = keyframes.some(kf => kf.frame === frame);
    console.log(`[App] Crop ${isUpdate ? 'update' : 'add'} at ${currentTime.toFixed(2)}s (frame ${frame}): x=${cropData.x}, y=${cropData.y}, ${cropData.width}x${cropData.height}`);

    addOrUpdateKeyframe(currentTime, cropData, duration);
    setDragCrop(null); // Clear drag preview
  };

  // Handle highlight changes during drag/resize
  const handleHighlightChange = (newHighlight) => {
    setDragHighlight(newHighlight);
  };

  // Handle highlight complete (create/update keyframe in enabled region)
  const handleHighlightComplete = (highlightData) => {
    // Always use currentTime - the keyframe will be created/moved to the exact frame
    // the user is viewing, ensuring no mismatch between display and data
    if (!isTimeInEnabledRegion(currentTime)) {
      console.warn('[App] Cannot add highlight keyframe - not in enabled region');
      setDragHighlight(null);
      return;
    }

    const frame = Math.round(currentTime * highlightRegionsFramerate);
    console.log(`[App] Highlight keyframe at ${currentTime.toFixed(2)}s (frame ${frame}): pos=(${highlightData.x},${highlightData.y}), r=${highlightData.radiusX}x${highlightData.radiusY}`);

    addHighlightRegionKeyframe(currentTime, highlightData);
    setDragHighlight(null);
  };

  // Handle keyframe click (seek to keyframe time - selection is derived automatically)
  const handleKeyframeClick = (time, index) => {
    seek(time);
    setSelectedLayer('crop');
  };

  // Handle keyframe delete (pass duration to removeKeyframe)
  // Selection automatically becomes null when keyframe no longer exists (derived state)
  const handleKeyframeDelete = (time) => {
    removeKeyframe(time, duration);
  };

  // Handle highlight keyframe click (seek - selection is derived automatically)
  const handleHighlightKeyframeClick = (time, index) => {
    seek(time);
    setSelectedLayer('highlight');
  };

  // Handle highlight keyframe delete
  // Selection automatically becomes null when keyframe no longer exists (derived state)
  const handleHighlightKeyframeDelete = (time) => {
    removeHighlightKeyframe(time, duration);
  };

  // Handle highlight duration change
  const handleHighlightDurationChange = (newDuration) => {
    updateHighlightDuration(newDuration, duration);
    // Sync playhead to the new duration position
    seek(newDuration);
  };

  /**
   * Handle transition from Framing to Overlay mode
   * Called when user exports from Framing mode
   * @param {Blob} renderedVideoBlob - The rendered video from framing export
   * @param {Object|null} clipMetadata - Optional clip metadata for auto-generating highlight regions
   */
  const handleProceedToOverlay = async (renderedVideoBlob, clipMetadata = null) => {
    try {
      // Create URL for the rendered video
      const url = URL.createObjectURL(renderedVideoBlob);

      // Extract metadata from the rendered video
      const meta = await extractVideoMetadata(renderedVideoBlob);

      // Clean up old overlay video URL if exists
      if (overlayVideoUrl) {
        URL.revokeObjectURL(overlayVideoUrl);
      }

      // Set overlay video state
      setOverlayVideoFile(renderedVideoBlob);
      setOverlayVideoUrl(url);
      setOverlayVideoMetadata(meta);

      // Store clip metadata for auto-generating highlight regions
      setOverlayClipMetadata(clipMetadata);

      // Reset highlight state for fresh start in overlay mode
      resetHighlight();
      resetHighlightRegions();

      // Switch to overlay mode
      setEditorMode('overlay');

      // Wait for video element to load the new source, then seek to beginning
      // Use a small delay to allow React to update and video to start loading
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.currentTime = 0;
          // Also pause to ensure it's ready to play from the start
          videoRef.current.pause();
        }
      }, 100);

      console.log('[App] Transitioned to Overlay mode with rendered video:', {
        width: meta.width,
        height: meta.height,
        duration: meta.duration,
        aspectRatio: meta.aspectRatio,
        hasClipMetadata: !!clipMetadata,
        clipCount: clipMetadata?.source_clips?.length || 0,
      });
    } catch (err) {
      console.error('[App] Failed to transition to Overlay mode:', err);
      throw err; // Re-throw so ExportButton can show error
    }
  };

  /**
   * Handle mode change between Framing and Overlay
   *
   * IMPORTANT: Do NOT reload videos when switching modes!
   * - Framing video (videoUrl) persists even when viewing overlay
   * - Overlay video (effectiveOverlayVideoUrl) persists even when viewing framing
   * - Reloading would reset all crop/segment/highlight state
   *
   * The VideoPlayer automatically switches between videos based on mode:
   *   videoUrl={editorMode === 'overlay' && effectiveOverlayVideoUrl ? effectiveOverlayVideoUrl : videoUrl}
   *
   * Pass-through behavior: If no framing edits were made AND only a single clip,
   * the original video is used directly in overlay mode (via effectiveOverlayVideoUrl).
   * Multiple clips always require export to combine them first.
   */
  const handleModeChange = useCallback((newMode) => {
    if (newMode === editorMode) return;

    console.log(`[App] Switching from ${editorMode} to ${newMode} mode`);

    // Simply switch the mode - video state is preserved
    setEditorMode(newMode);
  }, [editorMode]);

  // Prepare crop context value
  const cropContextValue = useMemo(() => ({
    keyframes,
    isEndKeyframeExplicit,
    aspectRatio,
    copiedCrop,
    updateAspectRatio,
    addOrUpdateKeyframe,
    removeKeyframe,
    copyCropKeyframe,
    pasteCropKeyframe,
    interpolateCrop,
    hasKeyframeAt,
  }), [keyframes, isEndKeyframeExplicit, aspectRatio, copiedCrop, updateAspectRatio, addOrUpdateKeyframe, removeKeyframe, copyCropKeyframe, pasteCropKeyframe, interpolateCrop, hasKeyframeAt]);

  // Prepare highlight context value
  const highlightContextValue = useMemo(() => ({
    keyframes: highlightKeyframes,
    isEndKeyframeExplicit: isHighlightEndKeyframeExplicit,
    copiedHighlight,
    isEnabled: isHighlightEnabled,
    highlightDuration,
    toggleEnabled: toggleHighlightEnabled,
    updateHighlightDuration,
    addOrUpdateKeyframe: addOrUpdateHighlightKeyframe,
    removeKeyframe: removeHighlightKeyframe,
    copyHighlightKeyframe,
    pasteHighlightKeyframe,
    interpolateHighlight,
    hasKeyframeAt: hasHighlightKeyframeAt,
  }), [highlightKeyframes, isHighlightEndKeyframeExplicit, copiedHighlight, isHighlightEnabled, highlightDuration, toggleHighlightEnabled, updateHighlightDuration, addOrUpdateHighlightKeyframe, removeHighlightKeyframe, copyHighlightKeyframe, pasteHighlightKeyframe, interpolateHighlight, hasHighlightKeyframeAt]);

  /**
   * Get filtered keyframes for export
   * Includes keyframes within trim range PLUS surrounding keyframes for proper interpolation
   */
  const getFilteredKeyframesForExport = useMemo(() => {
    const allKeyframes = getKeyframesForExport();
    const segmentData = getSegmentExportData();

    // If no trimming, return all keyframes
    if (!segmentData || (!segmentData.trim_start && !segmentData.trim_end)) {
      return allKeyframes;
    }

    const trimStart = segmentData.trim_start || 0;
    const trimEnd = segmentData.trim_end || duration || Infinity;

    // Find keyframes needed for proper interpolation:
    // 1. All keyframes within trim range
    // 2. Last keyframe BEFORE trim start (for interpolation at trim start)
    // 3. First keyframe AFTER trim end (for interpolation at trim end)
    let lastBeforeTrimStart = null;
    let firstAfterTrimEnd = null;
    const keyframesInRange = [];

    allKeyframes.forEach(kf => {
      if (kf.time >= trimStart && kf.time <= trimEnd) {
        // Keyframe is within trim range
        keyframesInRange.push(kf);
      } else if (kf.time < trimStart) {
        // Track last keyframe before trim start
        if (!lastBeforeTrimStart || kf.time > lastBeforeTrimStart.time) {
          lastBeforeTrimStart = kf;
        }
      } else if (kf.time > trimEnd) {
        // Track first keyframe after trim end
        if (!firstAfterTrimEnd || kf.time < firstAfterTrimEnd.time) {
          firstAfterTrimEnd = kf;
        }
      }
    });

    // Combine all needed keyframes
    const filtered = [
      ...(lastBeforeTrimStart ? [lastBeforeTrimStart] : []),
      ...keyframesInRange,
      ...(firstAfterTrimEnd ? [firstAfterTrimEnd] : [])
    ];

    // Debug log (disabled - too spammy)
    // console.log('[App] Filtered keyframes for export:', {
    //   original: allKeyframes.length,
    //   filtered: filtered.length,
    //   trimStart,
    //   trimEnd,
    //   includedBefore: !!lastBeforeTrimStart,
    //   includedAfter: !!firstAfterTrimEnd
    // });

    return filtered;
  }, [getKeyframesForExport, getSegmentExportData, duration]);

  /**
   * Get filtered highlight keyframes for export
   *
   * In FRAMING mode: Filters keyframes based on trim range (includes surrounding keyframes for interpolation)
   * In OVERLAY mode: Returns ALL keyframes (overlay video is already trimmed, so no filtering needed)
   */
  const getFilteredHighlightKeyframesForExport = useMemo(() => {
    if (!isHighlightEnabled) {
      return []; // Don't export if highlight layer is disabled
    }

    const allKeyframes = getHighlightKeyframesForExport();

    // In overlay mode, return all keyframes - the video is already trimmed,
    // and highlight keyframes are on the new video's timeline
    if (editorMode === 'overlay') {
      return allKeyframes;
    }

    // Framing mode: Apply trim filtering
    const segmentData = getSegmentExportData();

    // If no trimming, return all keyframes
    if (!segmentData || (!segmentData.trim_start && !segmentData.trim_end)) {
      return allKeyframes;
    }

    const trimStart = segmentData.trim_start || 0;
    const trimEnd = segmentData.trim_end || duration || Infinity;

    // Find keyframes needed for proper interpolation:
    // 1. All keyframes within trim range
    // 2. Last keyframe BEFORE trim start (for interpolation at trim start)
    // 3. First keyframe AFTER trim end (for interpolation at trim end)
    let lastBeforeTrimStart = null;
    let firstAfterTrimEnd = null;
    const keyframesInRange = [];

    allKeyframes.forEach(kf => {
      if (kf.time >= trimStart && kf.time <= trimEnd) {
        // Keyframe is within trim range
        keyframesInRange.push(kf);
      } else if (kf.time < trimStart) {
        // Track last keyframe before trim start
        if (!lastBeforeTrimStart || kf.time > lastBeforeTrimStart.time) {
          lastBeforeTrimStart = kf;
        }
      } else if (kf.time > trimEnd) {
        // Track first keyframe after trim end
        if (!firstAfterTrimEnd || kf.time < firstAfterTrimEnd.time) {
          firstAfterTrimEnd = kf;
        }
      }
    });

    // Combine all needed keyframes
    const filtered = [
      ...(lastBeforeTrimStart ? [lastBeforeTrimStart] : []),
      ...keyframesInRange,
      ...(firstAfterTrimEnd ? [firstAfterTrimEnd] : [])
    ];

    return filtered;
  }, [isHighlightEnabled, getHighlightKeyframesForExport, getSegmentExportData, duration, editorMode]);

  // If no project selected and not in annotate mode, show ProjectManager
  if (!selectedProject && editorMode !== 'annotate') {
    return (
      <div className="min-h-screen bg-gray-900">
        {/* Hidden file input for Annotate Game - triggers file picker directly */}
        <input
          ref={annotateFileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              clearSelection();
              handleGameVideoSelect(file);
            }
            // Reset input so same file can be selected again
            e.target.value = '';
          }}
        />
        <ProjectManager
          projects={projects}
          loading={projectsLoading}
          onSelectProject={async (id) => {
            console.log('[App] Selecting project:', id);
            const project = await selectProject(id);
            setEditorMode('framing');

            // Clear existing clips before loading new ones
            clearClips();

            // Fetch clips for the project - pass project ID explicitly since React state may not have updated yet
            const projectClipsData = await fetchProjectClips(id);
            console.log('[App] Fetched project clips:', projectClipsData);

            if (projectClipsData && projectClipsData.length > 0) {
              // Helper to get video metadata from URL
              const getMetadataFromUrl = async (url) => {
                return await extractVideoMetadataFromUrl(url);
              };

              // Helper to get clip URL with explicit project ID
              const getClipUrl = (clipId) => getClipFileUrl(clipId, id);

              // Load all clips into the clip manager
              console.log('[App] Loading clips into clip manager...');
              await loadProjectClips(
                projectClipsData,
                getClipUrl,
                getMetadataFromUrl,
                project?.aspect_ratio || '9:16'
              );

              // Load the first clip for video playback
              const firstClip = projectClipsData[0];
              const clipUrl = getClipFileUrl(firstClip.id, id);
              console.log('[App] Loading first clip for playback:', firstClip.id, clipUrl);
              await loadVideoFromUrl(clipUrl, firstClip.filename || 'clip.mp4');
            }
          }}
          onCreateProject={createProject}
          onDeleteProject={deleteProject}
          onAnnotate={() => {
            // Directly open file picker instead of showing empty annotate mode
            annotateFileInputRef.current?.click();
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex">
      {/* Sidebar - Framing mode (when clips exist) */}
      {hasClips && clips.length > 0 && editorMode === 'framing' && (
        <ClipSelectorSidebar
          clips={clips}
          selectedClipId={selectedClipId}
          onSelectClip={handleSelectClip}
          onAddClip={handleAddClipFromSidebar}
          onDeleteClip={handleDeleteClip}
          onReorderClips={reorderClips}
          globalTransition={globalTransition}
          onTransitionChange={setGlobalTransition}
        />
      )}

      {/* Sidebar - Annotate mode */}
      {editorMode === 'annotate' && annotateVideoUrl && (
        <ClipsSidePanel
          clipRegions={clipRegions}
          selectedRegionId={annotateSelectedRegionId}
          onSelectRegion={handleSelectAnnotateRegion}
          onUpdateRegion={updateClipRegion}
          onDeleteRegion={deleteClipRegion}
          onImportAnnotations={importAnnotations}
          maxNotesLength={ANNOTATE_MAX_NOTES_LENGTH}
          clipCount={annotateClipCount}
          videoDuration={annotateVideoMetadata?.duration}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              {/* Back to Projects button - show in all editor modes */}
              {(editorMode === 'annotate' || editorMode === 'framing' || editorMode === 'overlay') && (
                <button
                  onClick={() => {
                    // Clear project selection
                    clearSelection();
                    // Clear annotate state if in annotate mode
                    if (editorMode === 'annotate') {
                      setAnnotateVideoFile(null);
                      setAnnotateVideoUrl(null);
                      setAnnotateVideoMetadata(null);
                    }
                    // Return to project manager
                    setEditorMode('project-manager');
                  }}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                >
                  ← Projects
                </button>
              )}
              <div>
                <h1 className="text-4xl font-bold text-white mb-2">
                  {editorMode === 'annotate' ? 'Annotate Game' : 'Player Showcase'}
                </h1>
                <p className="text-gray-400">
                  {editorMode === 'annotate'
                    ? 'Mark clips to extract from your game footage'
                    : 'Showcase your player\'s brilliance'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* AspectRatioSelector - only in Framing mode when video is loaded */}
              {editorMode === 'framing' && videoUrl && (
                <AspectRatioSelector
                  aspectRatio={hasClips ? globalAspectRatio : aspectRatio}
                  onAspectRatioChange={hasClips ? (newRatio) => {
                    setGlobalAspectRatio(newRatio);
                    updateAspectRatio(newRatio);
                  } : updateAspectRatio}
                />
              )}
              {/* Mode toggle - project-aware visibility */}
              <ModeSwitcher
                mode={editorMode}
                onModeChange={handleModeChange}
                disabled={isLoading}
                hasProject={!!selectedProject}
                hasWorkingVideo={selectedProject?.working_video_id != null}
                hasAnnotateVideo={!!annotateVideoUrl}
              />
              {/* Annotate mode - show file upload when no game video loaded */}
              {editorMode === 'annotate' && !annotateVideoUrl && (
                <FileUpload
                  onGameVideoSelect={handleGameVideoSelect}
                  isLoading={isLoading}
                />
              )}
            </div>
          </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-500/20 border border-red-500 rounded-lg p-4">
            <p className="text-red-200 font-semibold mb-1">❌ Error</p>
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Video Metadata - Framing/Overlay modes */}
        {metadata && editorMode !== 'annotate' && (
          <div className="mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-4 border border-white/20">
            <div className="flex items-center justify-between text-sm text-gray-300">
              <span className="font-semibold text-white">{metadata.fileName}</span>
              <div className="flex space-x-6">
                <span>
                  <span className="text-gray-400">Resolution:</span>{' '}
                  {metadata.width}x{metadata.height}
                </span>
                {metadata.framerate && (
                  <span>
                    <span className="text-gray-400">Framerate:</span>{' '}
                    {metadata.framerate} fps
                  </span>
                )}
                <span>
                  <span className="text-gray-400">Format:</span>{' '}
                  {metadata.format.toUpperCase()}
                </span>
                <span>
                  <span className="text-gray-400">Size:</span>{' '}
                  {(metadata.size / (1024 * 1024)).toFixed(2)} MB
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Video Metadata - Annotate mode */}
        {editorMode === 'annotate' && annotateVideoMetadata && !annotateFullscreen && (
          <div className="mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-4 border border-white/20">
            <div className="flex items-center justify-between text-sm text-gray-300">
              <span className="font-semibold text-white truncate max-w-md" title={annotateVideoMetadata.fileName}>
                {annotateVideoMetadata.fileName}
              </span>
              <div className="flex space-x-6">
                <span>
                  <span className="text-gray-400">Resolution:</span>{' '}
                  {annotateVideoMetadata.resolution}
                </span>
                <span>
                  <span className="text-gray-400">Format:</span>{' '}
                  {annotateVideoMetadata.format?.toUpperCase() || 'MP4'}
                </span>
                <span>
                  <span className="text-gray-400">Size:</span>{' '}
                  {annotateVideoMetadata.sizeFormatted || `${(annotateVideoMetadata.size / (1024 * 1024)).toFixed(2)} MB`}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Main Editor Area */}
        <div className="bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
          {/* Controls Bar */}
          {videoUrl && (
            <div className="mb-6 flex gap-4 items-center">
              <div className="ml-auto">
                <ZoomControls
                  zoom={zoom}
                  onZoomIn={zoomIn}
                  onZoomOut={zoomOut}
                  onResetZoom={resetZoom}
                  minZoom={MIN_ZOOM}
                  maxZoom={MAX_ZOOM}
                />
              </div>
            </div>
          )}

          {/* Video Player with mode-specific overlays */}
          {/* Use appropriate video URL based on mode: annotate -> overlay -> framing */}
          {/* Wrap in ref container for annotate fullscreen */}
          <div
            ref={annotateContainerRef}
            className="relative bg-gray-900 rounded-lg"
          >
          <VideoPlayer
            videoRef={videoRef}
            videoUrl={
              editorMode === 'annotate' && annotateVideoUrl ? annotateVideoUrl :
              editorMode === 'overlay' && effectiveOverlayVideoUrl ? effectiveOverlayVideoUrl :
              videoUrl
            }
            handlers={handlers}
            onFileSelect={handleFileSelect}
            overlays={[
              // Framing mode overlay (CropOverlay)
              editorMode === 'framing' && videoUrl && currentCropState && metadata && (
                <CropOverlay
                  key="crop"
                  videoRef={videoRef}
                  videoMetadata={metadata}
                  currentCrop={currentCropState}
                  aspectRatio={aspectRatio}
                  onCropChange={handleCropChange}
                  onCropComplete={handleCropComplete}
                  zoom={zoom}
                  panOffset={panOffset}
                  selectedKeyframeIndex={selectedCropKeyframeIndex}
                />
              ),
              // Annotate mode overlay (NotesOverlay) - shows name and notes for region at playhead
              editorMode === 'annotate' && annotateVideoUrl && (() => {
                const regionAtPlayhead = getAnnotateRegionAtTime(currentTime);
                return (regionAtPlayhead?.name || regionAtPlayhead?.notes) ? (
                  <NotesOverlay
                    key="annotate-notes"
                    name={regionAtPlayhead.name}
                    notes={regionAtPlayhead.notes}
                    isVisible={true}
                    isFullscreen={annotateFullscreen}
                  />
                ) : null;
              })(),
              // Annotate mode fullscreen overlay - appears when paused in fullscreen
              // If playhead is inside an existing clip, edit that clip; otherwise create new
              editorMode === 'annotate' && annotateVideoUrl && showAnnotateOverlay && (() => {
                const existingClip = getAnnotateRegionAtTime(currentTime);
                return (
                  <AnnotateFullscreenOverlay
                    key="annotate-fullscreen"
                    isVisible={showAnnotateOverlay}
                    currentTime={currentTime}
                    videoDuration={annotateVideoMetadata?.duration || 0}
                    existingClip={existingClip}
                    onCreateClip={handleAnnotateFullscreenCreateClip}
                    onUpdateClip={handleAnnotateFullscreenUpdateClip}
                    onResume={handleAnnotateOverlayResume}
                    onClose={handleAnnotateOverlayClose}
                  />
                );
              })(),
              // Overlay mode overlay (HighlightOverlay) - uses overlay video metadata
              // Only render when we have a currentHighlightState (playhead is in a region)
              editorMode === 'overlay' && effectiveOverlayVideoUrl && currentHighlightState && effectiveOverlayMetadata && (
                <HighlightOverlay
                  key="highlight"
                  videoRef={videoRef}
                  videoMetadata={effectiveOverlayMetadata}
                  currentHighlight={currentHighlightState}
                  onHighlightChange={handleHighlightChange}
                  onHighlightComplete={handleHighlightComplete}
                  isEnabled={isTimeInEnabledRegion(currentTime)}
                  effectType={highlightEffectType}
                  zoom={zoom}
                  panOffset={panOffset}
                />
              ),
              // Player detection overlay - shows clickable boxes around detected players
              // Only render when in overlay mode and playhead is in a highlight region
              editorMode === 'overlay' && effectiveOverlayVideoUrl && effectiveOverlayMetadata && playerDetectionEnabled && (
                <PlayerDetectionOverlay
                  key="player-detection"
                  videoRef={videoRef}
                  videoMetadata={effectiveOverlayMetadata}
                  detections={playerDetections}
                  isLoading={isDetectionLoading || isDetectionUploading}
                  onPlayerSelect={handlePlayerSelect}
                  zoom={zoom}
                  panOffset={panOffset}
                />
              ),
            ].filter(Boolean)}
            zoom={zoom}
            panOffset={panOffset}
            onZoomChange={zoomByWheel}
            onPanChange={updatePan}
            isFullscreen={editorMode === 'annotate' && annotateFullscreen}
            clipRating={editorMode === 'annotate' ? getAnnotateRegionAtTime(currentTime)?.rating ?? null : null}
          />
          {/* Controls - inside video container to match video width */}
          {/* Annotate mode uses AnnotateControls with speed and fullscreen */}
          {editorMode === 'annotate' && annotateVideoUrl && (
            <AnnotateControls
              isPlaying={isPlaying}
              currentTime={currentTime}
              duration={annotateVideoMetadata?.duration || duration}
              onTogglePlay={togglePlay}
              onStepForward={stepForward}
              onStepBackward={stepBackward}
              onRestart={restart}
              playbackSpeed={annotatePlaybackSpeed}
              onSpeedChange={setAnnotatePlaybackSpeed}
              isFullscreen={annotateFullscreen}
              onToggleFullscreen={handleAnnotateToggleFullscreen}
              onAddClip={handleAddClipFromButton}
            />
          )}
          {/* Framing and Overlay modes use regular Controls */}
          {((editorMode === 'framing' && videoUrl) || (editorMode === 'overlay' && effectiveOverlayVideoUrl)) && (
            <Controls
              isPlaying={isPlaying}
              currentTime={currentTime}
              duration={
                editorMode === 'overlay' ? (effectiveOverlayMetadata?.duration || duration) :
                duration
              }
              onTogglePlay={togglePlay}
              onStepForward={stepForward}
              onStepBackward={stepBackward}
              onRestart={restart}
            />
          )}
          </div>

          {/* Mode-specific content (overlays + timelines) */}
          {videoUrl && editorMode === 'framing' && (
            <FramingMode
              videoRef={videoRef}
              videoUrl={videoUrl}
              metadata={metadata}
              currentTime={currentTime}
              duration={duration}
              cropContextValue={cropContextValue}
              currentCropState={currentCropState}
              aspectRatio={aspectRatio}
              cropKeyframes={keyframes}
              framerate={framerate}
              selectedCropKeyframeIndex={selectedCropKeyframeIndex}
              copiedCrop={copiedCrop}
              onCropChange={handleCropChange}
              onCropComplete={handleCropComplete}
              onCropKeyframeClick={handleKeyframeClick}
              onCropKeyframeDelete={handleKeyframeDelete}
              onCropKeyframeCopy={handleCopyCrop}
              onCropKeyframePaste={handlePasteCrop}
              zoom={zoom}
              panOffset={panOffset}
              segments={segments}
              segmentBoundaries={segmentBoundaries}
              segmentVisualLayout={segmentVisualLayout}
              visualDuration={visualDuration || duration}
              trimRange={trimRange}
              trimHistory={trimHistory}
              onAddSegmentBoundary={addSegmentBoundary}
              onRemoveSegmentBoundary={removeSegmentBoundary}
              onSegmentSpeedChange={setSegmentSpeed}
              onSegmentTrim={handleTrimSegment}
              onDetrimStart={handleDetrimStart}
              onDetrimEnd={handleDetrimEnd}
              sourceTimeToVisualTime={sourceTimeToVisualTime}
              visualTimeToSourceTime={visualTimeToSourceTime}
              selectedLayer={selectedLayer}
              onLayerSelect={setSelectedLayer}
              onSeek={seek}
              timelineZoom={timelineZoom}
              onTimelineZoomByWheel={timelineZoomByWheel}
              timelineScale={getTimelineScale()}
              timelineScrollPosition={timelineScrollPosition}
              onTimelineScrollPositionChange={updateTimelineScrollPosition}
              isPlaying={isPlaying}
            />
          )}

          {/* Overlay mode - uses rendered video or pass-through if no framing edits */}
          {effectiveOverlayVideoUrl && editorMode === 'overlay' && (
            <OverlayMode
              videoRef={videoRef}
              videoUrl={effectiveOverlayVideoUrl}
              metadata={effectiveOverlayMetadata}
              currentTime={currentTime}
              duration={effectiveOverlayMetadata?.duration || duration}
              // Highlight regions (self-contained regions with keyframes)
              highlightRegions={highlightRegions}
              highlightBoundaries={highlightBoundaries}
              highlightKeyframes={highlightRegionKeyframes}
              highlightFramerate={highlightRegionsFramerate}
              onAddHighlightRegion={addHighlightRegion}
              onDeleteHighlightRegion={deleteHighlightRegion}
              onMoveHighlightRegionStart={moveHighlightRegionStart}
              onMoveHighlightRegionEnd={moveHighlightRegionEnd}
              onRemoveHighlightKeyframe={removeHighlightRegionKeyframe}
              onToggleHighlightRegion={toggleHighlightRegion}
              onSelectedKeyframeChange={setSelectedHighlightKeyframeTime}
              // Highlight interaction
              onHighlightChange={handleHighlightChange}
              onHighlightComplete={handleHighlightComplete}
              // Zoom
              zoom={zoom}
              panOffset={panOffset}
              visualDuration={effectiveOverlayMetadata?.duration || duration}
              selectedLayer={selectedLayer}
              onLayerSelect={setSelectedLayer}
              onSeek={seek}
              // NOTE: Overlay mode uses identity functions - no segment transformations
              // The overlay video is a fresh render without speed/trim segments
              sourceTimeToVisualTime={(t) => t}
              visualTimeToSourceTime={(t) => t}
              timelineZoom={timelineZoom}
              onTimelineZoomByWheel={timelineZoomByWheel}
              timelineScale={getTimelineScale()}
              timelineScrollPosition={timelineScrollPosition}
              onTimelineScrollPositionChange={updateTimelineScrollPosition}
              trimRange={null}  // No trimming in overlay mode
              isPlaying={isPlaying}
            />
          )}

          {/* Annotate mode - timeline for extracting clips */}
          {annotateVideoUrl && editorMode === 'annotate' && (
            <AnnotateMode
              currentTime={currentTime}
              duration={annotateVideoMetadata?.duration || 0}
              isPlaying={isPlaying}
              onSeek={seek}
              regions={annotateRegionsWithLayout}
              selectedRegionId={annotateSelectedRegionId}
              onSelectRegion={handleSelectAnnotateRegion}
              onDeleteRegion={deleteClipRegion}
            />
          )}

          {/* Annotate mode - Export Button */}
          {annotateVideoUrl && editorMode === 'annotate' && (
            <div className="mt-6">
              <div className="space-y-3">
                {/* Export Settings */}
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 space-y-4">
                  <div className="text-sm font-medium text-gray-300 mb-3">
                    Annotate Settings
                  </div>
                  <div className="text-xs text-gray-500 border-t border-gray-700 pt-3">
                    Extracts marked clips and loads them into Framing mode
                  </div>
                </div>

                {/* Export button */}
                <button
                  onClick={() => handleAnnotateExport(getAnnotateExportData())}
                  disabled={!hasAnnotateClips || isAnnotateExporting}
                  className={`w-full px-6 py-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                    !hasAnnotateClips || isAnnotateExporting
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {isAnnotateExporting ? (
                    <>
                      <Loader className="animate-spin" size={20} />
                      <span>Exporting...</span>
                    </>
                  ) : (
                    <>
                      <Download size={20} />
                      <span>Export Video</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Message when in Overlay mode but export is required */}
          {editorMode === 'overlay' && !effectiveOverlayVideoUrl && videoUrl && (hasFramingEdits || hasMultipleClips) && (
            <div className="mt-6 bg-purple-900/30 border border-purple-500/50 rounded-lg p-6 text-center">
              <p className="text-purple-200 font-medium mb-2">
                Export required for overlay mode
              </p>
              <p className="text-purple-300/70 text-sm mb-4">
                {hasMultipleClips
                  ? 'You have multiple clips loaded. Export first to combine them into a single video before adding overlays.'
                  : 'You have made edits in Framing mode. Export first to apply them before adding overlays.'}
              </p>
              <button
                onClick={() => handleModeChange('framing')}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Switch to Framing Mode
              </button>
            </div>
          )}

          {/* Export Button - show for current mode's video */}
          {((editorMode === 'framing' && videoUrl) || (editorMode === 'overlay' && effectiveOverlayVideoUrl)) && (
            <div className="mt-6">
              <ExportButton
                videoFile={editorMode === 'overlay' ? effectiveOverlayFile : videoFile}
                cropKeyframes={editorMode === 'framing' ? getFilteredKeyframesForExport : []}
                highlightRegions={editorMode === 'overlay' ? getRegionsForExport() : []}
                isHighlightEnabled={editorMode === 'overlay' && highlightRegions.length > 0}
                segmentData={editorMode === 'framing' ? getSegmentExportData() : null}
                disabled={editorMode === 'framing' ? !videoFile : !effectiveOverlayFile}
                includeAudio={includeAudio}
                onIncludeAudioChange={setIncludeAudio}
                highlightEffectType={highlightEffectType}
                onHighlightEffectTypeChange={setHighlightEffectType}
                editorMode={editorMode}
                onProceedToOverlay={handleProceedToOverlay}
                // Multi-clip props (use clipsWithCurrentState to include current clip's live keyframes)
                clips={editorMode === 'framing' && hasClips ? clipsWithCurrentState : null}
                globalAspectRatio={globalAspectRatio}
                globalTransition={globalTransition}
              />
            </div>
          )}

          {/* Model Comparison Button (for testing different AI models) */}
          {ENABLE_MODEL_COMPARISON && videoUrl && (
            <div className="mt-6">
              <CompareModelsButton
                videoFile={videoFile}
                cropKeyframes={getFilteredKeyframesForExport}
                highlightKeyframes={getFilteredHighlightKeyframesForExport}
                segmentData={getSegmentExportData()}
                disabled={!videoFile}
              />
            </div>
          )}
        </div>

        {/* Instructions */}
        {!videoUrl && !isLoading && !error && (
          <div className="mt-8 text-center text-gray-400">
            <div className="max-w-2xl mx-auto space-y-4">
              <h2 className="text-xl font-semibold text-white mb-4">
                Getting Started
              </h2>
              <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-4 text-sm">
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-2xl mb-2">📤</div>
                  <h3 className="font-semibold text-white mb-1">1. Upload</h3>
                  <p>Upload your game footage to get started</p>
                </div>
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-2xl mb-2">✂️</div>
                  <h3 className="font-semibold text-white mb-1">2. Trim</h3>
                  <p>Cut out the boring parts and keep only the action</p>
                </div>
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-2xl mb-2">🎯</div>
                  <h3 className="font-semibold text-white mb-1">3. Zoom</h3>
                  <p>Follow your player with dynamic crop keyframes</p>
                </div>
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-2xl mb-2">🐌</div>
                  <h3 className="font-semibold text-white mb-1">4. Slow-Mo</h3>
                  <p>Create slow motion segments for key moments</p>
                </div>
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-2xl mb-2">🚀</div>
                  <h3 className="font-semibold text-white mb-1">5. Export</h3>
                  <p>Play the video to make sure it's perfect and hit export to leverage AI Upscale</p>
                </div>
              </div>
              <div className="mt-6 text-xs text-gray-500">
                <p>Supported formats: MP4, MOV, WebM</p>
                <p>Maximum file size: 4GB</p>
              </div>
            </div>
          </div>
        )}

        </div>
      </div>

      {/* Debug Info - Shows current branch and commit */}
      <DebugInfo />
    </div>
  );
}

export default App;
