import { AlertTriangle } from 'lucide-react';

/**
 * NoSportTagWarning - amber prompt shown in the Add Clip UI when the current
 * profile's sport is "No Sport" (never chosen). Replaces the silently-empty
 * Tags section so the missing sport reads as "action recommended", not a bug.
 *
 * Shown ONLY for the no_sport sentinel — a custom/"Other" sport (a deliberate
 * choice with no tag registry) keeps today's silent behavior (T7850).
 *
 * Instructional-only (non-clickable): it names the header path to set a sport
 * rather than adding new navigation plumbing.
 */
export function NoSportTagWarning({ compact = false }) {
  if (compact) {
    return (
      <div className="flex items-center gap-1.5 text-amber-400 text-xs whitespace-nowrap">
        <AlertTriangle size={14} className="flex-shrink-0" />
        <span>Set your sport (top bar) for tags</span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 text-sm text-amber-400 bg-amber-900/20 border border-amber-700 rounded p-2">
      <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
      <div>
        <p className="font-medium">Set your sport to see sport-specific tags</p>
        <p className="text-amber-400/80 text-xs mt-0.5">
          Tap the sport icon in the top bar to pick your sport.
        </p>
      </div>
    </div>
  );
}

export default NoSportTagWarning;
