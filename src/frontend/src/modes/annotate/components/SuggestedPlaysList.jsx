import { useCallback, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '../../../components/shared/Button';
import { getPositions, getTagSet, NO_SPORT } from '../constants/tagRegistry';
import { useCurrentProfile, useProfileStore } from '../../../stores';
import { RATING_ADJECTIVES, displayRating } from '../../../components/shared/clipConstants';
import { VEO_SUGGESTIONS as T } from '../../../config/displayNames';
import { formatStamp, clipMetaForMoment } from '../../../utils/veoHighlights/clipImport';
import { rank } from '../../../utils/veoHighlights/merge';
import { onTextFieldKeyDown } from '../textFieldCommit';
import { PlayRatingRow } from './PlayRatingRow';
import { DetailsFields } from './DetailsFields';

const STATE_FILTERS = [
  { value: 'open', label: T.STATE_OPEN },
  { value: 'accepted', label: T.STATE_KEPT },
  { value: 'dismissed', label: T.STATE_DISMISSED },
];

const isTextTarget = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

function initialDraft(s, stamp) {
  return clipMetaForMoment({ labels: s.labels, stamp_s: stamp });
}

/**
 * T13220: Veo suggestions as a rate-to-keep list. A tapped row expands IN PLACE into the
 * play form (PlayRatingRow + name + DetailsFields). Before keeping, name/tags/notes are an
 * in-memory draft; the first rating tap is the ONE gesture that creates the play
 * (`onKeep(suggestion, {rating, name, tags, notes})`). After keeping the row stays expanded and
 * each edit is its own surgical `onEditKept(suggestion, {field})`. Moving on is the parent's
 * choice (Next / tapping another row / Down), never automatic.
 *
 * T13245: a row's stamp is on the GAME axis: `videoOffsets[video_sequence]` (the video's
 * offset_seconds; video 1 of a normal game is 0) plus the suggestion's start within that video.
 *
 * `keptDetails[id]` is the kept play's stored {rating,name,tags,notes} (owned by the parent,
 * which holds the region state); the list never persists anything itself.
 */
export function SuggestedPlaysList({
  suggestions,
  keptDetails = {},
  videoOffsets = {},
  activeId = null,
  onSelect,
  onKeep,
  onDismiss,
  onReopen,
  onEditKept,
  onEditPlay,
  reduceMotion = false,
}) {
  const [stateFilter, setStateFilter] = useState('open');
  const [labelFilter, setLabelFilter] = useState(() => new Set());
  const [expandedId, setExpandedId] = useState(null);
  const [drafts, setDrafts] = useState({});

  const currentProfile = useCurrentProfile();
  const updateProfile = useProfileStore((state) => state.updateProfile);
  const sport = currentProfile?.sport || NO_SPORT;
  const tagSet = getTagSet(sport);
  const handleSetSport = useCallback((next) => {
    if (!currentProfile?.id) return;
    updateProfile(currentProfile.id, { sport: next }).catch(() => {});
  }, [updateProfile, currentProfile?.id]);

  const chips = useMemo(() => {
    const counts = new Map();
    for (const s of suggestions) for (const l of s.labels) counts.set(l, (counts.get(l) || 0) + 1);
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => rank(a.label) - rank(b.label));
  }, [suggestions]);

  const visible = useMemo(
    // The expanded row stays listed even after its state leaves the filter (a kept row
    // stays open for edits until the parent moves on).
    () => suggestions.filter((s) => s.id === expandedId || (s.state === stateFilter
      && (labelFilter.size === 0 || s.labels.some((l) => labelFilter.has(l))))),
    [suggestions, stateFilter, labelFilter, expandedId],
  );

  // A video whose offset is not known yet (local folder upload still creating) stamps from 0.
  const stampOf = (s) => (videoOffsets[s.video_sequence] ?? 0) + s.start_time;
  const stored = (s) => (s.state === 'accepted' ? keptDetails[s.id] : null);
  const draftFor = (s) => drafts[s.id] ?? stored(s) ?? initialDraft(s, stampOf(s));
  const patchDraft = (s, patch) => setDrafts((d) => ({ ...d, [s.id]: { ...draftFor(s), ...patch } }));

  const expand = useCallback((s) => {
    setExpandedId(s.id);
    onSelect?.(s, { autoplay: !reduceMotion });
  }, [onSelect, reduceMotion]);

  const nextOpenAfter = (s, dir = 1) => {
    const list = visible;
    const idx = list.findIndex((x) => x.id === s.id);
    const ordered = dir > 0 ? list.slice(idx + 1) : list.slice(0, Math.max(idx, 0)).reverse();
    return ordered.find((x) => x.state === 'open') ?? null;
  };
  const goNext = (s, dir = 1) => {
    const next = nextOpenAfter(s, dir);
    if (next) expand(next);
  };

  const rate = (s, value) => {
    if (s.state === 'accepted') {
      onEditKept?.(s, { rating: value });
      return;
    }
    const d = draftFor(s);
    onKeep?.(s, { rating: value, name: d.name, tags: d.tags, notes: d.notes });
  };

  const toggleTag = (s, tag) => {
    const d = draftFor(s);
    const tags = d.tags.includes(tag) ? d.tags.filter((t) => t !== tag) : [...d.tags, tag];
    if (s.state === 'accepted') onEditKept?.(s, { tags });
    else patchDraft(s, { tags });
  };

  const commitName = (s, value) => {
    if (s.state !== 'accepted') return;
    if (value === (stored(s)?.name ?? '')) return;
    onEditKept?.(s, { name: value });
  };
  const commitNotes = (s, value) => {
    if (s.state !== 'accepted') return;
    if (value === (stored(s)?.notes ?? '')) return;
    onEditKept?.(s, { notes: value });
  };

  const handleKeyDown = (e) => {
    if (isTextTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const current = suggestions.find((s) => s.id === expandedId);
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'ArrowDown' || e.key === 'n') {
      handled();
      if (current) goNext(current); else if (visible[0]) expand(visible[0]);
    } else if (e.key === 'ArrowUp') {
      handled();
      if (current) goNext(current, -1);
    } else if (current && /^[1-5]$/.test(e.key)) {
      handled();
      rate(current, Number(e.key));
    } else if (current && (e.key === 'x' || e.key === 'X') && current.state === 'open') {
      handled();
      onDismiss?.(current);
    }
  };

  const toggleLabel = (label) => {
    const next = new Set(labelFilter);
    if (next.has(label)) next.delete(label); else next.add(label);
    setLabelFilter(next);
  };

  const counts = useMemo(() => {
    const c = { open: 0, accepted: 0, dismissed: 0 };
    for (const s of suggestions) c[s.state] = (c[s.state] || 0) + 1;
    return c;
  }, [suggestions]);

  const renderForm = (s) => {
    const d = draftFor(s);
    const kept = s.state === 'accepted';
    return (
      <div className="px-3 pb-3 space-y-3" data-testid={`suggestion-form-${s.id}`}>
        {kept && (
          <div className="text-sm font-semibold text-amber-300">
            {T.keptHeader(RATING_ADJECTIVES[displayRating(stored(s)?.rating)])}
          </div>
        )}
        <PlayRatingRow
          rating={kept ? stored(s)?.rating : null}
          onRatingChange={(v) => rate(s, v)}
        />
        <div className="flex items-center gap-2">
          <label htmlFor={`suggestion-name-${s.id}`} className="text-gray-400 text-xs w-16 shrink-0">{T.NAME_LABEL}</label>
          <input
            id={`suggestion-name-${s.id}`}
            data-testid={`suggestion-name-${s.id}`}
            type="text"
            value={d.name}
            onChange={(e) => patchDraft(s, { name: e.target.value })}
            onBlur={(e) => commitName(s, e.target.value)}
            onKeyDown={(e) => onTextFieldKeyDown(e, {
              draftSetter: (value) => patchDraft(s, { name: value }),
              storedValue: kept ? stored(s)?.name : initialDraft(s, stampOf(s)).name,
              allowEnterCommit: true,
            })}
            className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
        <DetailsFields
          tagSet={tagSet}
          sport={sport}
          positions={getPositions(sport)}
          selectedTags={d.tags}
          onTagToggle={(tag) => toggleTag(s, tag)}
          onSetSport={handleSetSport}
          notes={d.notes}
          onNotesChange={(e) => patchDraft(s, { notes: e.target.value })}
          onNotesCommit={(e) => commitNotes(s, e.target.value)}
          storedNotes={kept ? stored(s)?.notes : initialDraft(s, stampOf(s)).notes}
          notesId={`suggestion-notes-${s.id}`}
        />
        <div className="flex flex-wrap gap-2">
          {!kept && (
            <Button variant="secondary" size="md" onClick={() => onDismiss?.(s)}>{T.NOT_MY_PLAYER}</Button>
          )}
          {kept && onEditPlay && (
            <Button variant="secondary" size="md" onClick={() => onEditPlay(s)}>{T.EDIT_PLAY}</Button>
          )}
          <Button
            variant="secondary"
            size="md"
            data-testid={`suggestion-next-${s.id}`}
            onClick={() => goNext(s)}
            disabled={!nextOpenAfter(s)}
          >
            {T.NEXT}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div
      data-testid="suggested-plays-list"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="rounded-lg border border-gray-700 bg-gray-900/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
    >
      <h3 className="px-3 pt-3 text-sm font-semibold text-white">{T.LIST_TITLE}</h3>
      <div className="flex flex-wrap gap-2 px-3 pt-2" role="group" aria-label="Show">
        {STATE_FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={stateFilter === value}
            onClick={() => setStateFilter(value)}
            className={`min-h-11 px-3 rounded-full text-sm ${stateFilter === value ? 'bg-gray-500 text-white' : 'bg-gray-700 text-gray-200'}`}
          >
            {label} {counts[value]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 px-3 pt-2" role="group" aria-label="Label">
        {chips.map(({ label, count }) => (
          <button
            key={label}
            type="button"
            aria-pressed={labelFilter.has(label)}
            onClick={() => toggleLabel(label)}
            className={`min-h-11 px-3 rounded-full text-sm ${labelFilter.has(label) ? 'bg-fuchsia-600 text-white' : 'bg-gray-700 text-gray-200'}`}
          >
            {label} {count}
          </button>
        ))}
      </div>
      <ul className="mt-2 max-h-[60vh] overflow-y-auto">
        {visible.map((s) => {
          const expanded = expandedId === s.id;
          return (
            <li
              key={s.id}
              data-testid={`suggestion-row-${s.id}`}
              data-active={activeId === s.id || undefined}
              className={`border-t border-gray-800 ${expanded ? 'bg-gray-800/70' : ''}`}
            >
              <button
                type="button"
                data-testid={`suggestion-row-${s.id}-header`}
                aria-expanded={expanded}
                onClick={() => (expanded ? setExpandedId(null) : expand(s))}
                className="w-full min-h-11 px-3 py-2 flex items-center gap-3 text-sm text-gray-100 text-left"
              >
                <ChevronRight size={14} className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden="true" />
                <span className="flex-1">{s.labels[0]}</span>
                <span className="text-gray-300">{formatStamp(stampOf(s))}</span>
                <span className="text-gray-400 w-10 text-right">{T.durationLabel(s.end_time - s.start_time)}</span>
              </button>
              {s.state === 'dismissed' && onReopen && (
                <div className="px-3 pb-2">
                  <Button variant="secondary" size="sm" onClick={() => onReopen(s)}>{T.STATE_OPEN}</Button>
                </div>
              )}
              {expanded && s.state !== 'dismissed' && renderForm(s)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default SuggestedPlaysList;
