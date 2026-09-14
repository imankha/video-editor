import { Tag } from 'lucide-react';
import { InlineSportSelect } from './InlineSportSelect';
import { NO_SPORT } from '../../modes/annotate/constants/tagRegistry';

/**
 * NoSportTagWarning - the Add Clip Tags prompt shown when the current profile's
 * sport is "No Sport" (never chosen). Replaces the silently-empty Tags section
 * so the missing sport reads as an optional next step, not a bug.
 *
 * Shown ONLY for the no_sport sentinel — a custom/"Other" sport (a deliberate
 * choice with no tag registry) keeps today's silent behavior (T7850).
 *
 * T9830: sport is now an OPTIONAL detail (rating no longer gates clip creation,
 * and a clip can be created with no sport/tags at all), so the amber
 * warning styling is GONE — this is a neutral gray prompt, not an
 * "action recommended" alert. De-ambered once here; all 4 call sites
 * (AnnotateFullscreenOverlay formBody/strip/landscape + ClipDetailsEditor)
 * inherit the neutral look.
 *
 * T7922 (portrait/full variant): actionable. Instead of naming an off-screen
 * top-bar control (which is not even mounted on the annotate surface), the full
 * variant renders an inline sport picker so a first-time mobile user can set
 * their sport and get tags WITHOUT leaving the Add Clip form. Picking a sport
 * calls `onChange(sport)`; the form re-renders in place (no remount) and the
 * TagSelector swaps in, so the in-progress clip survives.
 *
 * The compact (landscape scrub-bar) variant is DEFERRED to a fast-follow and
 * stays the non-interactive instructional prose for now (founder scope).
 */
export function NoSportTagWarning({ compact = false, onChange }) {
  if (compact) {
    return (
      <div className="flex items-center gap-1.5 text-gray-400 text-xs whitespace-nowrap">
        <Tag size={14} className="flex-shrink-0" />
        <span>Set your sport (top bar) for tags</span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 text-sm text-gray-300 bg-gray-800 border border-gray-700 rounded p-2">
      <Tag size={16} className="flex-shrink-0 mt-0.5 text-gray-400" />
      <div className="min-w-0">
        <p className="font-medium">Pick your sport to tag this clip</p>
        <p className="text-gray-400 text-xs mt-0.5 mb-2">
          Choose your sport to unlock its tags — you can keep editing this clip.
        </p>
        <InlineSportSelect sport={NO_SPORT} onChange={onChange} />
      </div>
    </div>
  );
}

export default NoSportTagWarning;
