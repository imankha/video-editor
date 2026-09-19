import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Pencil, Crop, Sparkles, ChevronDown, ChevronUp, Video } from 'lucide-react';
import { getPositions, getTagSet, NO_SPORT } from '../constants/tagRegistry';
import { generateClipName } from '../../../utils/clipDisplayName';
import { maybeRecordRatedAndTagged } from '../../../utils/questAchievements';
import { TagSelector } from '../../../components/shared/TagSelector';
import { NoSportTagWarning } from '../../../components/shared/NoSportTagWarning';
import { TeammateTagInput } from '../../../components/shared/TeammateTagInput';
import { useCurrentProfile, useProfileStore, useProjectsList } from '../../../stores';
import { getClipStage, CLIP_STAGE } from '../clipStage';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { ClipScrubRegion } from './ClipScrubRegion';
import { Button } from '../../../components/shared/Button';
import { StarRating } from '../../../components/shared/StarRating';
import { LayerSegmentedControl } from './LayerSegmentedControl';
import { AddDetailsPopup } from './AddDetailsPopup';
import { DetailsFields } from './DetailsFields';
import { PlayProgressBadges } from './PlayProgressBadges';
import { DeletePlayButton } from './DeletePlayButton';
import { getPlayProgress, CLIP_BADGE } from '../playProgress';
import { onTextFieldKeyDown } from '../textFieldCommit';
import { ANNOTATE } from '../../../config/displayNames';

// Persists across mounts within the same page session
let savedDockPosition = 'left';

function DockPositionSelector({ position, onPositionChange }) {
  return (
    <div className="flex gap-1 flex-shrink-0" title="Dock position">
      {['left', 'right'].map(side => (
        <button
          key={side}
          onClick={() => onPositionChange(side)}
          className={`relative w-[28px] h-[22px] rounded border transition-colors ${
            position === side
              ? 'border-green-500 bg-gray-700'
              : 'border-gray-600 bg-gray-800 hover:border-gray-400'
          }`}
        >
          <span className={`absolute ${side === 'left' ? 'left-[3px]' : 'right-[3px]'} top-[3px] bottom-[3px] w-[5px] rounded-sm transition-colors ${
            position === side ? 'bg-green-400' : 'bg-gray-500'
          }`} />
        </button>
      ))}
    </div>
  );
}

// DEFAULT_CLIP_BEFORE / DEFAULT_CLIP_AFTER (the tap-to-range capture window) are
// single-sourced in clipConstants.js (T9840) and imported above, so this
// overlay's default and useAnnotate's addClipRegion default stay one policy.
const DEFAULT_RATING = 4; // "Good"

/**
 * CutFromAngleChip (T8892) — while the active source is a non-backbone angle, the
 * Add/Edit Play editor tells the user WHICH camera this play will be cut from.
 * Violet family per EPIC decision 8 (matches AngleLanes / AngleSwitcherBadge), a
 * camera glyph, and a plain-language microcopy line. Renders NOTHING when `name`
 * is falsy (backbone / angle-free), so an angle-free game's editor is byte-
 * identical to before this task.
 */
function CutFromAngleChip({ name }) {
  if (!name) return null;
  return (
    <div data-testid="cut-from-angle" className="flex flex-col gap-1 mb-3">
      <span className="inline-flex items-center gap-1 self-start rounded-full border border-violet-500/40 bg-violet-600/20 px-2 py-0.5 text-xs font-medium text-violet-300">
        <Video size={12} className="shrink-0" />
        from {name}
      </span>
      <p className="text-xs text-violet-300/80">This play will be cut from {name}.</p>
    </div>
  );
}

// T9630: labels/colors for the Unsaved/Saving/Saved/error tri-state — derived
// from real persistence state (see `displayStatus` below), never asserted.
const SAVE_STATUS_COPY = {
  unsaved: { text: 'Unsaved changes', className: 'text-amber-400' },
  saving: { text: 'Saving...', className: 'text-gray-400' },
  saved: { text: 'Saved', className: 'text-green-400' },
  error: { text: "Couldn't save — try again", className: 'text-red-400' },
};

function SaveStatusBadge({ status }) {
  const copy = SAVE_STATUS_COPY[status];
  if (!copy) return null;
  return (
    <span data-testid="save-status" className={`text-xs ${copy.className}`}>
      {copy.text}
    </span>
  );
}

/**
 * AnnotateFullscreenOverlay - the play editor (all four layouts)
 *
 * T10610: this is ALWAYS an editor on an EXISTING play now — the container
 * creates the play (region + backend row) at the Mark play tap, before this
 * component ever opens (design doc T10600-design.md § A, D2). There is no
 * create-mode form and no Save/Update/Cancel button anywhere: every control
 * persists on its own gesture (§ 2.2's gesture -> write table), Done/X/Escape
 * commit any dirty text field then close, and Delete play is the only
 * destructive action.
 */
export function AnnotateFullscreenOverlay({
  isVisible,
  currentTime,
  videoDuration,
  existingClip,
  onUpdateClip,
  onClose,
  onSeek,
  videoController,
  isFullscreen = false,
  layout = 'overlay',
  teammateSuggestions = [],
  onScrubDragChange,
  // T8600: desktop strip only — opens the clip's project in Focus mode. Same
  // prop name/semantics ClipDetailsEditor already uses.
  onOpenInFocus,
  // T9330: opens the clip's project in Spotlight (Overlay mode) — the stage CTA
  // routes here when getClipStage returns action 'overlay'. Same prop name
  // ClipDetailsEditor already uses.
  onOpenInOverlay,
  // T10610 § D.2/D.3: deletes the play the editor is open on (confirm, then
  // closes + deselects — see AnnotateContainer.handleDeletePlayFromEditor).
  onDeleteClip,
  // T10610 § C.4: awaited by the stage CTA before navigating, so a write still
  // in flight (or failed) can't be followed into Framing/Spotlight.
  onAwaitWrites,
  // T10610 § C.5: 'idle' | 'saving' | 'saved' | 'error', the outcome of the
  // most recent per-gesture write on this region — drives SaveStatusBadge.
  writeStatus = 'idle',
  // T8892: display name of the active NON-backbone angle (from buildGameTimeline
  // via AnnotateModeView), or null when cutting from the backbone / an angle-free
  // game. Non-null => this play is being cut from an angle; render the "cut from"
  // chip + microcopy. Null => zero pixels (angle-free games stay byte-identical).
  activeSourceName = null,
  // T9480 review fix (MAJOR #5): the active angle's true media bound
  // ({mediaStart, mediaEnd} in virtual time, from buildGameTimeline's own
  // angles[].virtualStart/virtualEnd via AnnotateModeView), or null for the
  // backbone / an angle-free game -- ClipScrubRegion falls back to the whole
  // timeline (videoDuration) when this is null.
  mediaBounds = null,
}) {
  const isMobile = useIsMobile();
  // T9330: the clip's stage-aware CTA, shared with ClipDetailsEditor via
  // getClipStage. linkedProject is looked up the SAME way ClipDetailsEditor does
  // (useProjectsList by autoProjectId) — single source, not a passed prop.
  const projects = useProjectsList();
  const linkedProject = existingClip.autoProjectId
    ? projects.find(p => p.id === existingClip.autoProjectId)
    : null;
  const clipStage = getClipStage(existingClip, linkedProject);
  const currentProfile = useCurrentProfile();
  const updateProfile = useProfileStore(state => state.updateProfile);
  const sport = currentProfile?.sport || NO_SPORT;
  const tagSet = getTagSet(sport);

  // T7922: picking a sport from the inline no_sport Tag picker. Optimistic +
  // rolled back in the store; swallow the rejection here (store logs + reverts).
  const handleSetSport = useCallback((nextSport) => {
    if (!currentProfile?.id) return;
    updateProfile(currentProfile.id, { sport: nextSport }).catch(() => {});
  }, [updateProfile, currentProfile?.id]);

  const [dockPosition, setDockPosition] = useState(savedDockPosition);
  const handleDockChange = useCallback((pos) => {
    savedDockPosition = pos;
    setDockPosition(pos);
  }, []);

  const [rating, setRating] = useState(existingClip.rating || DEFAULT_RATING);
  const [selectedTags, setSelectedTags] = useState(existingClip.tags || []);
  // T10610 § B.1/B.2: LOCAL ECHO, seeded from the region, re-seeded ONLY on a
  // real clip-identity change (the reset effect below) — never a write itself.
  const [clipName, setClipName] = useState(existingClip.name || '');
  // T8760 item 4: in the strip (desktop edit) layout the header name IS the one
  // edit affordance — clicking the pencil turns it into an inline input. This
  // replaces the standalone name field the button row used to duplicate (item 3).
  const [isEditingName, setIsEditingName] = useState(false);
  // T10410: the formBody layouts' name input, so the "Name this play" badge can
  // focus it (the strip has no input until the pencil opens one — there the
  // badge opens the inline editor instead).
  const nameInputRef = useRef(null);
  // T10410: true while the clip badge's create call is in flight (the same
  // partial `{ createProject: true }` update the main screen's Frame clip
  // button sends). Memory-only view state driven by that one gesture; it clears
  // when the call settles, and the badge flips to done when the parent re-renders
  // with the landed autoProjectId.
  const [clipCreating, setClipCreating] = useState(false);
  // T10410: the clip id the reset effect last seeded the form from. `undefined`
  // = never seeded, so the first run always seeds.
  const seededClipIdRef = useRef(undefined);

  const [scrubStartTime, setScrubStartTime] = useState(existingClip.startTime);
  const [scrubEndTime, setScrubEndTime] = useState(existingClip.endTime);
  const [notes, setNotes] = useState(existingClip.notes || '');
  const [taggedTeammates, setTaggedTeammates] = useState(existingClip.tagged_teammates || []);
  const [myAthlete, setMyAthlete] = useState(existingClip.my_athlete ?? true);
  // T8600: Tags + Notes move behind a "Details" disclosure — one boolean, two
  // presentations (desktop expand-in-place, mobile full-screen popup).
  // Deliberately NOT reset by the [existingClip] effect below: the component
  // unmounts when the editor closes (parent gates the render), so it resets
  // naturally; re-seeding on a clip switch leaves the panel open, which is
  // harmless and avoids a second reset path.
  // T10290: used to open by default on desktop (>= md) — back when this
  // disclosure held the rating control, so it needed to be visible without an
  // extra tap. T10580: rating moved out to its own always-visible badge
  // (T10520), so the disclosure (now just sport/tags/notes) defaults CLOSED
  // on every layout. The initial value is the ONLY seed (the reset effect
  // never touches detailsOpen).
  const [detailsOpen, setDetailsOpen] = useState(false);
  const handleRatingChangeRef = useRef(null);
  // Ref-avoids-stale-closure pattern (same convention as handleRatingChangeRef
  // above) — the window keydown effect below has a narrow dep array, so it
  // must call through a ref rather than close over closeWithCommit directly.
  const closeWithCommitRef = useRef(null);

  // Re-seed the form ONLY on a real clip switch (T10610 § B.2: the SAME
  // guard the overlay already had — extended, not duplicated).
  useEffect(() => {
    // T10410: `existingClip` is a NEW OBJECT after every surgical region update
    // (updateClipRegion spreads the region; the parent's find() memo follows),
    // including ones this open editor itself triggers. Those are the SAME
    // play, so re-seeding here would silently discard every unsaved-but-not-
    // yet-blurred text draft (the trim/rating/tags fields below all persist
    // immediately on their own gesture, so they have nothing to lose — only
    // clipName/notes are drafts that could still be mid-edit). Only a real
    // switch (different clip id) resets the form; a same-play identity churn
    // keeps it.
    const clipKey = existingClip.id;
    const samePlay = seededClipIdRef.current === clipKey;
    seededClipIdRef.current = clipKey;
    if (samePlay) return;

    setIsEditingName(false); // T8760: close inline name editing on clip switch
    setRating(existingClip.rating || DEFAULT_RATING);
    setSelectedTags(existingClip.tags || []);
    setClipName(existingClip.name || '');
    setScrubStartTime(existingClip.startTime);
    setScrubEndTime(existingClip.endTime);
    setNotes(existingClip.notes || '');
    setTaggedTeammates(existingClip.tagged_teammates || []);
    setMyAthlete(existingClip.my_athlete ?? true);
  }, [existingClip]);

  // Handle keyboard shortcuts — uses handleRatingChangeRef to avoid a stale
  // closure. T8600 §2.6 / T10610 § B.4: Escape is handled in ONE place for
  // typing and non-typing targets alike: it closes the details surface first
  // (without discarding the whole play), then closeWithCommit on a second
  // Escape. A text field's OWN onKeyDown (onTextFieldKeyDown) stops
  // propagation on Escape, so this window handler only ever sees Escape when
  // no text field is focused — closeWithCommit's own commits are then no-ops
  // (the field-level handler already committed or reverted).
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e) => {
      const typing = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

      if (e.key === 'Escape') {
        e.preventDefault();
        if (detailsOpen) {
          setDetailsOpen(false);
          return;
        }
        closeWithCommitRef.current();
        return;
      }
      if (typing) return;

      if (e.key >= '1' && e.key <= '5') {
        handleRatingChangeRef.current(parseInt(e.key, 10));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, detailsOpen]);

  // T10610 § B.1/D3: rating persists on its OWN gesture now — no more
  // create-mode "manually edited" tracking (playProgress's `rated` is
  // unconditionally true; see playProgress.js). The container's clean-check
  // (constraint 6) makes a re-tap of the already-selected rating a no-op.
  const handleRatingChange = (newRating) => {
    setRating(newRating);
    onUpdateClip(existingClip.id, { rating: newRating });
    maybeRecordRatedAndTagged(newRating, selectedTags);
  };
  handleRatingChangeRef.current = handleRatingChange;

  const handleTagToggle = (tagName) => {
    const newTags = selectedTags.includes(tagName)
      ? selectedTags.filter((t) => t !== tagName)
      : [...selectedTags, tagName];
    setSelectedTags(newTags);
    onUpdateClip(existingClip.id, { tags: newTags });
    maybeRecordRatedAndTagged(rating, newTags);
  };

  const handleNameChange = (e) => {
    setClipName(e.target.value); // local echo only — commitName below writes
  };

  // T10610 § B.1: commit-on-blur/Enter, no-op when the draft already matches
  // the stored value (the container's own clean-check makes this redundant
  // for correctness, but skips a wasted function call for a stray focus+blur).
  const commitName = useCallback(() => {
    if (clipName !== (existingClip.name || '')) onUpdateClip(existingClip.id, { name: clipName });
  }, [clipName, existingClip.id, existingClip.name, onUpdateClip]);

  const commitNotes = useCallback(() => {
    if (notes !== (existingClip.notes || '')) onUpdateClip(existingClip.id, { notes });
  }, [notes, existingClip.id, existingClip.notes, onUpdateClip]);

  // T10610 § B.4: the ONE close path that commits any dirty text field first.
  // Wired at every close site (X buttons, Done, the window Escape branch,
  // keepMarkingCta) — see design doc § B.4 for why an explicit call is still
  // needed even though a plain click already blurs the focused input.
  const closeWithCommit = useCallback(() => {
    commitName();
    commitNotes();
    onClose();
  }, [commitName, commitNotes, onClose]);
  closeWithCommitRef.current = closeWithCommit;

  const handleTrimCommit = useCallback((finalStart, finalEnd) => {
    setScrubStartTime(finalStart);
    setScrubEndTime(finalEnd);
    onUpdateClip(existingClip.id, { startTime: finalStart, endTime: finalEnd });
  }, [existingClip.id, onUpdateClip]);

  if (!isVisible) return null;

  // T10610 § C.5: writeStatus comes straight from the container's own
  // per-gesture write outcome — no more local Unsaved/hasUnsavedEdits
  // derivation (nothing is ever "unsaved" once every control autosaves).
  const displayStatus = (writeStatus === 'saving' || writeStatus === 'saved' || writeStatus === 'error')
    ? writeStatus
    : null;

  // T8600: shared disclosure label — surfaces existing tag/note content so an
  // edit-mode user can see there's hidden content before opening it.
  const tagCount = selectedTags.length;
  const hasNote = notes.trim().length > 0;
  const detailsLabel = !tagCount && !hasNote
    ? ANNOTATE.DETAILS
    : `${ANNOTATE.DETAILS} (${[tagCount ? `${tagCount} tag${tagCount > 1 ? 's' : ''}` : null, hasNote ? 'note' : null].filter(Boolean).join(', ')})`;

  // T10410: the four play-progress badges (rated / named / note / clip) — a pure
  // read of the form state above plus the loaded clip. Rendered beside the name
  // on the desktop strip's header line and above the footer buttons on the
  // formBody layouts (decision artifact Option C, 2026-09-18). Replaces the
  // loose "Clip created" text the strip's action row used to carry.
  const progress = getPlayProgress({
    rating,
    clipName,
    loadedName: existingClip.name || '',
    loadedHasCustomName: !!existingClip.hasCustomName,
    notes,
    hasProject: !!existingClip.autoProjectId,
    creating: clipCreating,
  });
  // Each undone badge jumps to the control that completes it. T10520: the
  // rated badge is the exception — it opens its own popup rating picker
  // (RatingBadge) rather than jumping to the disclosure, so it takes
  // `rating`/`handleRatingChange` directly instead of a jump callback. It is
  // also the only badge that stays clickable once DONE, since a rating is a
  // value you may want to change again, not a one-time checkbox.
  const jumpToName = () => {
    if (layout === 'strip') setIsEditingName(true);
    else nameInputRef.current?.focus();
  };
  const jumpToNote = () => {
    setDetailsOpen(true);
    // The notes field lives inside the disclosure (desktop panel / mobile
    // popup), which mounts on this same gesture — focus it once it exists.
    requestAnimationFrame(() => document.getElementById('clip-notes')?.focus());
  };
  // The 5-star nudge: the same partial `{ createProject: true }` update the
  // main screen's Frame clip button sends — the editor stays open and the
  // badge flips to "Clip created" in place.
  const handleCreateClipFromBadge = async () => {
    if (clipCreating || existingClip.autoProjectId) return;
    setClipCreating(true);
    try {
      await onUpdateClip(existingClip.id, { createProject: true });
    } finally {
      setClipCreating(false);
    }
  };
  const renderProgressBadges = (size, className = '') => (
    <PlayProgressBadges
      // T10590 (Reviewer finding): keyed on clip identity so the rated
      // badge's open popup resets on a REAL clip switch, but — like the
      // existingClip object itself — stays mounted (and open) across the
      // same-play identity churn a surgical update causes (updateClipRegion
      // spreads the region on every write), matching the reset effect's own
      // samePlay rule just above.
      key={existingClip.id}
      progress={progress}
      size={size}
      className={className}
      rating={rating}
      onRatingChange={handleRatingChange}
      myAthlete={myAthlete}
      isMobile={isMobile}
      onName={jumpToName}
      onNote={jumpToNote}
      onCreateClip={progress.clip === CLIP_BADGE.NUDGE ? handleCreateClipFromBadge : undefined}
      createClipTitle={ANNOTATE.CREATE_CLIP_NUDGE_HINT}
    />
  );

  const formBody = (
    <>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className={`${layout === 'inline' ? 'text-sm' : 'text-lg'} font-semibold text-white`}>
            {ANNOTATE.EDIT_PLAY}
          </h3>
          <div className="flex items-center gap-2">
            {layout === 'overlay' && (
              <DockPositionSelector position={dockPosition} onPositionChange={handleDockChange} />
            )}
            <button
              onClick={closeWithCommit}
              className="p-1 hover:bg-gray-700 rounded transition-colors"
              title="Close (Esc)"
            >
              <X size={20} className="text-gray-400" />
            </button>
          </div>
        </div>

        {/* T8892: which camera this play is cut from (angle-active only). */}
        <CutFromAngleChip name={activeSourceName} />

        {/* Clip scrub region - visual timeline for selecting start/end */}
        <ClipScrubRegion
          currentTime={currentTime}
          videoDuration={videoDuration}
          existingClip={existingClip}
          startTime={scrubStartTime}
          endTime={scrubEndTime}
          onStartTimeChange={setScrubStartTime}
          onEndTimeChange={setScrubEndTime}
          onSeek={onSeek}
          onDragStart={() => onScrubDragChange?.(true)}
          onDragEnd={(finalStart, finalEnd) => { onScrubDragChange?.(false); handleTrimCommit(finalStart, finalEnd); }}
          videoController={videoController}
          mediaBounds={mediaBounds}
          clipEditorActive
        />

        {/* Clip Name — T10610 § B.1/B.2: local-echo draft, commit on blur/Enter only. */}
        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">{ANNOTATE.CLIP_NAME}</label>
          <input
            ref={nameInputRef}
            type="text"
            value={clipName}
            onChange={handleNameChange}
            onBlur={commitName}
            onKeyDown={(e) => onTextFieldKeyDown(e, { draftSetter: setClipName, storedValue: existingClip.name, allowEnterCommit: true })}
            placeholder="Enter clip name..."
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-green-500"
          />
        </div>

        {/* Layer — replaces the old My Athlete on/off toggle. Shown on mobile
            too: this overlay IS the mobile add/edit surface. Locked to Team,
            read-only, for imported clips (shared_by set) — they can never be
            promoted onto the My Athlete layer (T5700, epic decision 2). */}
        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">{ANNOTATE.LAYER_LABEL}</label>
          <LayerSegmentedControl
            size={isMobile ? 'md' : 'sm'}
            value={myAthlete}
            disabled={!!existingClip.shared_by}
            disabledReason={existingClip.shared_by ? `Shared by ${existingClip.shared_by} — imported clips stay on the Team layer` : ''}
            onChange={(mine) => {
              setMyAthlete(mine);
              // T5725: switching TO My Athlete clears teammate tags in the SAME
              // gesture — teammates are Team-layer-only, so a My Athlete clip
              // must never carry them.
              if (mine) setTaggedTeammates([]);
              onUpdateClip(existingClip.id, mine ? { my_athlete: true, tagged_teammates: [] } : { my_athlete: false });
            }}
            className="w-full"
          />
        </div>

        {/* Teammates — Team-layer only (T5725). Dropped the old !isMobile gate:
            teammate tagging reveals on the Team layer for BOTH desktop and
            mobile, and is hidden entirely when the clip is on My Athlete. */}
        {!myAthlete && (
          <div className="mb-4">
            <label className="block text-gray-400 text-sm mb-2">Teammates</label>
            <TeammateTagInput
              teammates={taggedTeammates}
              onChange={(next) => { setTaggedTeammates(next); onUpdateClip(existingClip.id, { tagged_teammates: next }); }}
              suggestions={teammateSuggestions}
            />
          </div>
        )}

        {/* T10310 (2026-09-18 user request): the "Create clip" affordance moved
            out of the editor entirely -- onto the main Annotate screen's split
            [Edit Play]/[Frame Clip] row (AnnotateModeView), which both creates
            the project AND opens Framing in one gesture. */}

        {/* T9830: "Optional details" disclosure — rating, sport, tags and notes.
            One button, two presentations: desktop expands the shared DetailsFields
            in place (below); mobile opens the full-screen AddDetailsPopup (rendered
            by the inline layout wrapper). */}
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setDetailsOpen(o => !o)}
            aria-expanded={detailsOpen}
            data-testid="add-details-button"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm text-gray-300 transition-colors"
          >
            {detailsOpen && !isMobile ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {detailsLabel}
          </button>
        </div>

        {/* Desktop expand-in-place details panel (mobile uses AddDetailsPopup). */}
        {!isMobile && detailsOpen && (
          <div className="mb-4 border-t border-gray-700 pt-4">
            <DetailsFields
              tagSet={tagSet}
              sport={sport}
              positions={getPositions(sport)}
              selectedTags={selectedTags}
              onTagToggle={handleTagToggle}
              onSetSport={handleSetSport}
              notes={notes}
              onNotesChange={(e) => setNotes(e.target.value)}
              onNotesCommit={commitNotes}
              storedNotes={existingClip.notes}
            />
          </div>
        )}

    </>
  );

  // T10610 § D.1/D.2: Delete play replaces Cancel everywhere; Done replaces
  // Save/Update (closeWithCommit commits any dirty text field first).
  const actionsFooter = (
    <div>
      {/* T10410: play-progress badges above the buttons (the formBody layouts'
          equivalent of the strip's header-line placement). */}
      {renderProgressBadges('sm', 'mb-2 justify-center')}
      {displayStatus && (
        <div className="mb-1.5"><SaveStatusBadge status={displayStatus} /></div>
      )}
      <DeletePlayButton hasProject={!!existingClip.autoProjectId} onDelete={() => onDeleteClip(existingClip.id)} />
      <button
        onClick={closeWithCommit}
        className="w-full mt-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
      >
        {ANNOTATE.DONE}
      </button>
    </div>
  );

  // T9330/T10610 § C.4: the stage-aware primary CTA (project exists) —
  // full-width, driven by getClipStage. SHARED by the desktop strip AND the
  // mobile edit sheet (layout==='inline'), so both surfaces get one
  // label/target. Awaits the region's write chain before navigating — a
  // rejected/in-flight tail means "do not navigate", not a confirm dialog
  // (there is nothing unsaved to confirm anymore).
  const stageCta = (existingClip.autoProjectId && clipStage) ? (
    <Button
      variant="cyan"
      size="lg"
      icon={clipStage.action === 'overlay' ? Sparkles : Crop}
      // 2026-09-18 (user request): the FOCUS-stage CTA gets a rollover explaining
      // what Framing does (already-approved copy); other stages keep the
      // generic "open the clip" hint.
      title={clipStage.stage === CLIP_STAGE.FOCUS ? ANNOTATE.FRAME_THIS_CLIP_HINT : `Open the clip: ${clipStage.label}`}
      className="w-full coarse-pointer:min-h-[44px]"
      onClick={async () => {
        const ok = onAwaitWrites ? await onAwaitWrites(existingClip.id) : true;
        if (!ok) return;
        if (clipStage.action === 'overlay') {
          onOpenInOverlay?.(existingClip.autoProjectId);
        } else {
          onOpenInFocus?.(existingClip.autoProjectId);
        }
      }}
    >
      {clipStage.label}
    </Button>
  ) : null;

  // T9330: create-in-flight — the project is being created but its id has not
  // landed. A disabled FOCUS-stage CTA ("Frame this clip" since T9580/N41) that
  // goes live once setAutoProjectId resolves (pure re-render). Desktop strip
  // only: mobile create closes on save, so the sheet is never open during that
  // window (focusPending stays false).
  // T9580 (N41): the first-clip invitation's dismiss secondary — "Keep marking
  // plays". Paired with the FOCUS-stage primary CTA ("Frame this clip"), so the
  // invitation reads as the intended two-choice prompt rather than a single
  // button. Routes through closeWithCommit (a pure EDITING->SELECTED transition
  // with no seek), so dismissing preserves the playhead and commits any dirty
  // text field. Only at the FOCUS moment: once a clip has a working video the
  // single stage CTA suffices.
  const showFocusInvitation = existingClip.autoProjectId && clipStage?.stage === CLIP_STAGE.FOCUS;
  const keepMarkingCta = showFocusInvitation ? (
    <Button
      variant="ghost"
      size="lg"
      className="w-full coarse-pointer:min-h-[44px]"
      onClick={closeWithCommit}
    >
      {ANNOTATE.KEEP_MARKING_PLAYS}
    </Button>
  ) : null;

  if (layout === 'strip') {
    // T8600 C2: the desktop under-canvas editor. Entirely separate markup
    // from formBody (like landscape-inline below) — full canvas width, tinted
    // by mode, header + scrub row + controls row + in-place details panel,
    // with the Layer/Focus row rendered OUTSIDE the tinted card as its own
    // sibling (this component owns myAthlete state, so the button row lives
    // here rather than being lifted to a state-less parent).
    // T10610: always the EDIT header now — there is no create mode left.
    const headerName = existingClip.name || generateClipName(existingClip.rating, existingClip.tags, existingClip.notes) || 'this play';
    return (
      <>
        <div
          data-testid="annotate-editor-strip"
          className="rounded-lg border bg-yellow-950/20 border-yellow-800/40"
        >
          {/* Header row 1 — T8960 items 2+5: the name is the FIRST control in
              BOTH modes (create shows the default/auto name until renamed; the
              pencil opens an inline input — the SAME affordance edit mode uses),
              the My Athlete | Team layer control sits on this top line, then the
              Close button. There is no separate name field in the controls row. */}
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-yellow-800/30">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {isEditingName ? (
                <>
                  <Pencil size={16} className="shrink-0 text-yellow-400" />
                  <input
                    type="text"
                    value={clipName}
                    onChange={handleNameChange}
                    onBlur={() => { commitName(); setIsEditingName(false); }}
                    onKeyDown={(e) => onTextFieldKeyDown(e, { draftSetter: setClipName, storedValue: existingClip.name, allowEnterCommit: true })}
                    aria-label="Clip name"
                    placeholder="Clip name"
                    autoFocus
                    className="min-w-0 flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm
                               text-white placeholder-gray-500 focus:border-green-500 focus:outline-none"
                  />
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingName(true)}
                  title={ANNOTATE.RENAME_CLIP}
                  className="flex items-center gap-2 min-w-0 group"
                >
                  <Pencil size={16} className="shrink-0 text-yellow-400 group-hover:text-yellow-300" />
                  <span className="text-sm font-semibold text-white truncate group-hover:underline">
                    {headerName}
                  </span>
                </button>
              )}
              {/* T10410 (Option C): progress badges on the identity line, right
                  after the name. */}
              {renderProgressBadges('md', 'ml-2')}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <LayerSegmentedControl
                size="sm"
                value={myAthlete}
                onChange={(mine) => {
                  setMyAthlete(mine);
                  if (mine) setTaggedTeammates([]);
                  onUpdateClip(existingClip.id, mine ? { my_athlete: true, tagged_teammates: [] } : { my_athlete: false });
                }}
                disabled={!!existingClip.shared_by}
                disabledReason={existingClip.shared_by ? `Shared by ${existingClip.shared_by} — imported clips stay on the Team layer` : ''}
              />
              <button onClick={closeWithCommit} title="Close (Esc)" className="p-1.5 hover:bg-gray-700/50 rounded transition-colors shrink-0">
                <X size={18} className="text-gray-400" />
              </button>
            </div>
          </div>

          {/* Header row 2 — symmetric "Edit play" title (T9330: the editor now
              stays open after a create and always lands here). */}
          <div className="px-4 pt-2 flex items-center justify-center gap-1.5">
            <Pencil size={14} className="text-yellow-400 shrink-0" />
            <span className="text-sm font-semibold text-white">{ANNOTATE.EDIT_PLAY}</span>
          </div>

          {/* T8892: which camera this play is cut from (angle-active only). */}
          {activeSourceName && (
            <div className="px-4 pt-2">
              <CutFromAngleChip name={activeSourceName} />
            </div>
          )}

          {/* Scrub row — non-compact, full strip width */}
          <div className="px-4 pt-3">
            <ClipScrubRegion
              currentTime={currentTime}
              videoDuration={videoDuration}
              existingClip={existingClip}
              startTime={scrubStartTime}
              endTime={scrubEndTime}
              onStartTimeChange={setScrubStartTime}
              onEndTimeChange={setScrubEndTime}
              onSeek={onSeek}
              onDragStart={() => onScrubDragChange?.(true)}
              onDragEnd={(finalStart, finalEnd) => { onScrubDragChange?.(false); handleTrimCommit(finalStart, finalEnd); }}
              videoController={videoController}
          mediaBounds={mediaBounds}
              clipEditorActive
            />
          </div>

          {/* Controls row — T10610: rating + sport live in the details
              disclosure below; Delete play + Done replace Save + Cancel
              (T10410 moved the "Clip created" status up to the header line as
              the clip badge). */}
          <div className="px-4 pb-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setDetailsOpen(o => !o)}
              aria-expanded={detailsOpen}
              data-testid="add-details-button"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700
                         rounded text-sm text-gray-300 transition-colors"
            >
              {detailsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {detailsLabel}
            </button>

            {!myAthlete && (
              <div className="min-w-[180px] max-w-xs flex-1">
                <TeammateTagInput
                  teammates={taggedTeammates}
                  onChange={(next) => { setTaggedTeammates(next); onUpdateClip(existingClip.id, { tagged_teammates: next }); }}
                  suggestions={teammateSuggestions}
                />
              </div>
            )}

            <div className="ml-auto flex items-center gap-2 shrink-0">
              {/* T10410: the "Clip created" text that sat here is now the clip
                  badge on the header line (renderProgressBadges). */}
              <div className="w-32">
                <DeletePlayButton hasProject={!!existingClip.autoProjectId} onDelete={() => onDeleteClip(existingClip.id)} />
              </div>
              <button
                onClick={closeWithCommit}
                className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded transition-colors"
              >
                {ANNOTATE.DONE}
              </button>
            </div>
          </div>

          {/* T9630: Unsaved/Saving/Saved — own row so it never widens the
              flex-wrap controls row above. */}
          {displayStatus && (
            <div className="px-4 pb-2 -mt-2">
              <SaveStatusBadge status={displayStatus} />
            </div>
          )}

          {/* Details panel — desktop expand-in-place. T8960 item 6: no inner
              scroll (the panel grows to fit Rating + Tags + Notes); dismissal is
              the toggle button itself, no separate Done/X. T9830: rating + the
              (de-ambered) sport prompt now live here, via the shared DetailsFields. */}
          {detailsOpen && (
            <div className="border-t px-4 py-3 border-yellow-800/30">
              <DetailsFields
                tagSet={tagSet}
                sport={sport}
                positions={getPositions(sport)}
                selectedTags={selectedTags}
                onTagToggle={handleTagToggle}
                onSetSport={handleSetSport}
                notes={notes}
                onNotesChange={(e) => setNotes(e.target.value)}
                onNotesCommit={commitNotes}
                storedNotes={existingClip.notes}
              />
            </div>
          )}
        </div>

        {/* T9330: the full-width stage-aware primary CTA (extracted so the
            mobile inline edit sheet reuses the exact same button). */}
        {stageCta && <div className="mt-5">{stageCta}</div>}
        {keepMarkingCta && <div className="mt-2">{keepMarkingCta}</div>}
      </>
    );
  }

  if (layout === 'landscape-inline') {
    return (
      <div data-add-clip-form className="border-t border-gray-700 px-3 py-2">
        {/* T8892: which camera this play is cut from (angle-active only). Same
            chip as the other editor surfaces so landscape phone isn't the one
            orientation left without it. */}
        <CutFromAngleChip name={activeSourceName} />
        <ClipScrubRegion
          currentTime={currentTime}
          videoDuration={videoDuration}
          existingClip={existingClip}
          startTime={scrubStartTime}
          endTime={scrubEndTime}
          onStartTimeChange={setScrubStartTime}
          onEndTimeChange={setScrubEndTime}
          onSeek={onSeek}
          onDragStart={() => onScrubDragChange?.(true)}
          onDragEnd={(finalStart, finalEnd) => { onScrubDragChange?.(false); handleTrimCommit(finalStart, finalEnd); }}
          videoController={videoController}
          mediaBounds={mediaBounds}
          clipEditorActive
          compact
        />
        <div className="flex items-center gap-2 mt-1.5">
          {/* T9630 N35: the standalone notation span that used to sit here was
              a straight duplicate of the label StarRating already renders —
              two rating indicators for one value on the tightest layout. */}
          <StarRating rating={rating} onRatingChange={handleRatingChange} size={20} showLabel />
          <div className="h-4 w-px bg-gray-700 flex-shrink-0" />
          <div className="flex-1 overflow-x-auto scrollbar-hide">
            {tagSet ? (
              <TagSelector
                positions={getPositions(sport)}
                tagsByPosition={tagSet.tags}
                selectedTags={selectedTags}
                onTagToggle={handleTagToggle}
                size="sm"
                flat
              />
            ) : sport === NO_SPORT ? (
              <NoSportTagWarning compact />
            ) : null}
          </div>
          <div className="h-4 w-px bg-gray-700 flex-shrink-0" />
          <DeletePlayButton hasProject={!!existingClip.autoProjectId} onDelete={() => onDeleteClip(existingClip.id)} variant="icon" />
          <button
            onClick={closeWithCommit}
            className="p-1 hover:bg-gray-700 rounded transition-colors flex-shrink-0"
            title="Close (Esc)"
          >
            <X size={18} className="text-gray-400" />
          </button>
        </div>
        {/* T9630: same real Unsaved/Saving/Saved/error state as the other two
            layouts — this is the one surface that previously had NO save
            feedback at all. Own line so it never competes with the button row
            on the height-starved landscape layout. */}
        {displayStatus && (
          <p className="mt-1"><SaveStatusBadge status={displayStatus} /></p>
        )}
      </div>
    );
  }

  if (layout === 'inline') {
    // T8140: flex column = scrolling body (min-h-0 lets it shrink inside a bounded
    // flex parent — the ClipsSidePanel sidebar, the mobileFs sheet, the mobile
    // bottom sheet) + a pinned footer that stays reachable without scrolling
    // (T4933 short-sidebar case AND the 390x844 mobile Save-below-the-fold case).
    return (
      <div data-add-clip-form className="border-t border-gray-700 flex flex-col min-h-0 max-h-full">
        <div className="p-3 overflow-y-auto min-h-0 flex-1">{formBody}</div>
        {/* T9330 (design §2.6): the mobile edit sheet gets the SAME stage-aware
            CTA as the desktop strip (Apply Framing / Apply Spotlight / View
            Final / View Published), so editing an existing clip-with-a-project on
            a phone has a path into Framing/Spotlight/the finished video. Edit mode
            only — mobile CREATE still closes on save (Save/Cancel below) and does
            not surface the in-flight CTA. Its own row above the footer. */}
        {stageCta && (
          <div className="px-3 pt-3 border-t border-gray-700 bg-gray-900/95 flex-shrink-0">{stageCta}</div>
        )}
        {/* T9580 (N41): the mobile EDIT sheet shares the FOCUS-stage invitation, so
            it gets the "Keep marking plays" dismiss beside "Frame this clip". */}
        {keepMarkingCta && (
          <div className="px-3 pt-2 bg-gray-900/95 flex-shrink-0">{keepMarkingCta}</div>
        )}
        {/* T8790/F3: this sheet is `fixed bottom-0` but a `backdrop-blur` ancestor
            (AnnotateModeView's frosted card) becomes its containing block, so the
            sheet is anchored to that card's bottom (mid-screen), not the viewport, so
            the pinned Save then lands ~363px down, BELOW the keyboard-reduced fold on
            the two SHORT phones (568/667 tall). Extra bottom padding on short
            viewports lifts Save clear of the keyboard band; tall phones (844/926)
            already cleared it, so the height query leaves them untouched. */}
        <div className="p-3 [@media(max-height:700px)]:pb-9 border-t border-gray-700 bg-gray-900/95 flex-shrink-0">{actionsFooter}</div>
        {/* T8600: mobile-only full-screen "Add details" popup — the bottom
            sheet (T8140) and the mobile fullscreen portrait sheet both use
            this layout, so both inherit it. */}
        {isMobile && detailsOpen && (
          <AddDetailsPopup
            tagSet={tagSet}
            sport={sport}
            positions={getPositions(sport)}
            selectedTags={selectedTags}
            onTagToggle={handleTagToggle}
            onSetSport={handleSetSport}
            notes={notes}
            onNotesChange={(e) => setNotes(e.target.value)}
            onNotesCommit={commitNotes}
            storedNotes={existingClip.notes}
            onDone={() => setDetailsOpen(false)}
          />
        )}
      </div>
    );
  }

  const isRight = dockPosition === 'right';

  return (
    <div className={`absolute ${isRight ? 'right-0' : 'left-0'} top-0 bottom-0 z-50 flex items-stretch`}>
      <div
        className={`bg-gray-900/95 shadow-2xl border-gray-700 pointer-events-auto w-[400px] flex flex-col ${isRight ? 'border-l' : 'border-r'}`}
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="p-5 overflow-y-auto min-h-0 flex-1">{formBody}</div>
        <div className="px-5 py-4 border-t border-gray-700 bg-gray-900/95 flex-shrink-0">{actionsFooter}</div>
      </div>
    </div>
  );
}

export default AnnotateFullscreenOverlay;
