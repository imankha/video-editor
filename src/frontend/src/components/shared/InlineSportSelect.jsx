import { ChevronDown } from 'lucide-react';
import {
  SUPPORTED_SPORTS,
  sportDisplayName,
  sportEmoji,
  NO_SPORT,
  NO_SPORT_LABEL,
} from '../../modes/annotate/constants/tagRegistry';

// Sentinel value: picking it opens the full Edit form for a custom ("Other") sport.
export const INLINE_SPORT_OTHER = '__other__';

// Native-popup legibility (T8710): the invisible <select> uses the OS-native option
// list, which by default paints a light popup. In the app's dark theme that left the
// light option text on a near-white background (unreadable). Two reinforcing fixes:
//  - `[color-scheme:dark]` on the <select> tells the browser to render its native
//    control chrome (incl. the option popup) with a dark theme — the reliable,
//    standards-based cross-browser lever (Chrome/Edge/Firefox all honor it), and the
//    one that does NOT depend on browsers respecting author colors on <option>.
//  - explicit dark bg + light text on each <option> as belt-and-suspenders for any
//    ancestor that forces a light color-scheme.
// gray-800 background / gray-50 text -> ~14:1 contrast, well past WCAG AA (4.5:1).
export const SPORT_OPTION_STYLE = { backgroundColor: '#1f2937', color: '#f9fafb' };

/**
 * InlineSportSelect - a big, tappable sport pill backed by a native <select>,
 * so we get the OS-native picker on mobile (and full a11y) while styling freely.
 *
 * Extracted from ManageProfilesModal (T7922) so the same affordance can also be
 * the actionable no_sport Tag prompt in the Add Clip form.
 *
 * The "Other..." (free-text custom sport) option renders ONLY when `onPickOther`
 * is provided — the profile-management row wires it to the Edit form, while the
 * Add Clip tag picker omits it (a custom sport yields no tags, and its Edit
 * modal cannot render over the z-[100] fullscreen annotate overlay).
 */
export function InlineSportSelect({ sport, onChange, onPickOther }) {
  const isNoSport = sport === NO_SPORT;
  // "No Sport" renders as a first-class option below, so treat it as known for
  // display (no raw "no_sport" label, no duplicate custom option).
  const isKnown = !sport || isNoSport || SUPPORTED_SPORTS.some(s => s.id === sport);
  const label = isNoSport ? NO_SPORT_LABEL : (isKnown ? (sportDisplayName(sport) || 'Soccer') : sport);

  return (
    // A big, tappable pill. The native <select> sits invisibly on top so we get
    // the OS-native picker on mobile (and full a11y) while styling freely below.
    <div className="relative flex-shrink-0 group">
      <div className="flex items-center gap-2 bg-gray-700 group-hover:bg-gray-600 border border-gray-600 group-focus-within:border-purple-500 rounded-xl pl-2.5 pr-2 py-2 transition-colors">
        <span className="text-2xl leading-none" aria-hidden>{sportEmoji(sport)}</span>
        {/* Emoji alone carries the meaning on narrow screens; show the name when there's room */}
        <span className="hidden sm:inline text-sm font-semibold text-white max-w-[6.5rem] truncate">{label}</span>
        <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />
      </div>
      <select
        value={isKnown ? (sport || '') : sport}
        onChange={(e) => {
          const next = e.target.value;
          if (next === INLINE_SPORT_OTHER) onPickOther?.();
          else onChange(next);
        }}
        onClick={(e) => e.stopPropagation()}
        aria-label="Change sport"
        title="Change sport"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer [color-scheme:dark]"
      >
        {/* Custom sport (not in the supported list) stays selectable */}
        {!isKnown && <option value={sport} style={SPORT_OPTION_STYLE}>{`${sportEmoji(sport)} ${sport}`}</option>}
        <option value={NO_SPORT} style={SPORT_OPTION_STYLE}>{`${sportEmoji(NO_SPORT)} ${NO_SPORT_LABEL}`}</option>
        {SUPPORTED_SPORTS.map(s => (
          <option key={s.id} value={s.id} style={SPORT_OPTION_STYLE}>{`${sportEmoji(s.id)} ${s.name}`}</option>
        ))}
        {onPickOther && <option value={INLINE_SPORT_OTHER} style={SPORT_OPTION_STYLE}>Other...</option>}
      </select>
    </div>
  );
}

export default InlineSportSelect;
