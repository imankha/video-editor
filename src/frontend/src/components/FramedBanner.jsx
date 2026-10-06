import React, { useState, useEffect } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { useGalleryStore } from '../stores/galleryStore';
import { FRAMED_BANNER } from '../config/displayNames';

/**
 * T11800: consume-once "{play} is framed" banner shown on Annotate after Focus's
 * "Done for now". Memory-only: it captures `galleryStore.justFramed` ONCE at mount
 * (lazy initializer) and clears the store marker in the same mount, so a reload, a
 * later remount or a StrictMode re-run never shows it again. It dismisses itself
 * when the user selects a different play, and unmounting (leaving Annotate) drops it.
 *
 * @param {object|null} selectedRegion  - the currently selected play region (or null)
 * @param {Function} onAddSpotlight     - (autoProjectId) open Spotlight for the framed clip
 * @param {Function} onViewInClips      - (autoProjectId) go to Clips with the tile ringed
 */
export function FramedBanner({ selectedRegion, onAddSpotlight, onViewInClips }) {
  const [framed] = useState(() => useGalleryStore.getState().justFramed);
  const [dismissed, setDismissed] = useState(false);
  const clearJustFramed = useGalleryStore((s) => s.clearJustFramed);

  // Memory-only UI marker (not persistence): spend it at mount so it is consume-once.
  useEffect(() => {
    clearJustFramed();
  }, [clearJustFramed]);

  const otherPlaySelected = !!framed && !!selectedRegion
    && selectedRegion.autoProjectId !== framed.projectId;
  useEffect(() => {
    if (otherPlaySelected) setDismissed(true);
  }, [otherPlaySelected]);

  if (!framed || dismissed) return null;

  const btn = 'h-11 sm:h-9 px-4 rounded-lg text-sm font-medium w-full sm:w-auto';
  return (
    <div
      data-testid="framed-banner"
      className="bg-gray-800 border border-cyan-500/40 rounded-lg p-3 mb-3 flex items-start gap-3"
    >
      <CheckCircle2 size={16} className="text-green-400 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white">{FRAMED_BANNER.title(framed.clipName)}</div>
        <div className="text-xs text-gray-400 mt-0.5">{FRAMED_BANNER.body}</div>
        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => onAddSpotlight(framed.projectId)}
            className={`${btn} bg-cyan-600 hover:bg-cyan-500 text-white`}
          >
            {FRAMED_BANNER.ADD_SPOTLIGHT_LABEL}
          </button>
          <button
            type="button"
            onClick={() => onViewInClips(framed.projectId)}
            className={`${btn} text-gray-200 hover:bg-gray-700`}
          >
            {FRAMED_BANNER.VIEW_IN_CLIPS_LABEL}
          </button>
        </div>
      </div>
      <button
        type="button"
        aria-label={FRAMED_BANNER.DISMISS_LABEL}
        onClick={() => setDismissed(true)}
        className="p-1 text-gray-500 hover:text-white flex-shrink-0"
      >
        <X size={16} />
      </button>
    </div>
  );
}
