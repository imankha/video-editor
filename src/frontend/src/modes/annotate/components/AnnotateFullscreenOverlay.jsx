import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Pencil, Crop, Sparkles, ChevronDown, ChevronUp, Video, Clapperboard } from 'lucide-react';
import { getPositions, getTagSet, NO_SPORT } from '../constants/tagRegistry';
import { generateClipName } from '../../../utils/clipDisplayName';
import { maybeRecordRatedAndTagged } from '../../../utils/questAchievements';
import { TeammateTagInput } from '../../../components/shared/TeammateTagInput';
import { useCurrentProfile, useProfileStore, useProjectsList } from '../../../stores';
import { getClipStage, CLIP_STAGE } from '../clipStage';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { ClipScrubRegion } from './ClipScrubRegion';
import { Button } from '../../../components/shared/Button';
import { LayerSegmentedControl } from './LayerSegmentedControl';
import { AddDetailsPopup } from './AddDetailsPopup';
import { DetailsFields } from './DetailsFields';
import { RatingPill } from './RatingPill';
import { DeletePlayButton } from './DeletePlayButton';
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

/**
 * HighlightMadeChip (T11150) — shown once a play has produced a clip
 * (`existingClip.autoProjectId` truthy), replacing the old T10410 progress
 * badges' clip indicator. Gold (T11110 RATING_BADGE_COLORS[5] tint), no
 * spinner and no nudge — the create-project flow itself is untouched by this
 * task, this chip only reflects the resulting state.
 */
function HighlightMadeChip({ show }) {
  if (!show) return null;
  return (
    <span
      data-testid="highlight-made-chip"
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-[#F5B700]/50 bg-[#F5B700]/15 text-[#F5B700] text-xs font-medium"
    >
      <Clapperboard size={12} />
      {ANNOTATE.HIGHLIGHT_MADE}
    </span>
  );
}

// T9630: labels/colors for the Saving/Saved/error status, derived from real
// per-gesture write state (see `displayStatus` below), never asserted.
const SAVE_STATUS_COPY = {
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

  const [rating, setRating] = useState(existingClip.rating ?? null);
  const [selectedTags, setSelectedTags] = useState(existingClip.tags || []);
  // T10610 § B.1/B.2: LOCAL ECHO, seeded from the region, re-seeded ONLY on a
  // real clip-identity change (the reset effect below) — never a write itself.
  const [clipName, setClipName] = useState(existingClip.name || '');
  // T8760 item 4: in the strip (desktop edit) layout the header name IS the one
  // edit affordance — clicking the pencil turns it into an inline input. This
  // replaces the standalone name field the button row used to duplicate (item 3).
  const [isEditingName, setIsEditingName] = useState(false);
  // T11150: the formBody/portrait-strip layouts' name input (the strip has no
  // input until the pencil opens one).
  const nameInputRef = useRef(null);
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
    setRating(existingClip.rating ?? null);
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

  // T11150: ONE shared category(layer)/teammates write path, mirroring
  // handleRatingChange — the 5 render sites (strip, formBody, landscape-inline,
  // portrait-strip, inline) call these instead of inlining the logic (was pasted
  // 5x). T5725: switching TO My Athlete clears teammate tags in the SAME gesture
  // (teammates are Team-layer-only). layerDisabledReason is likewise single-sourced.
  const handleLayerChange = (mine) => {
    setMyAthlete(mine);
    if (mine) setTaggedTeammates([]);
    onUpdateClip(existingClip.id, mine ? { my_athlete: true, tagged_teammates: [] } : { my_athlete: false });
  };
  const handleTeammatesChange = (next) => {
    setTaggedTeammates(next);
    onUpdateClip(existingClip.id, { tagged_teammates: next });
  };
  const layerDisabledReason = existingClip.shared_by
    ? `Shared by ${existingClip.shared_by} — imported plays stay on the Team layer`
    : '';

  const handleNameChange = (e) => {
    setClipName(e.target.value); // local echo only — commitName below writes
  };

  // T10610 § B.1: commit-on-blur/Enter, no-op when the draft already matches
  // the stored value (the container's own clean-check makes this redundant
  // for correctness, but skips a wasted function call for a stray focus+blur).
  // Reads `e.target.value` (the live DOM value) instead of the closed-over
  // `clipName` state when a blur event is available — a synchronous Escape
  // revert (onTextFieldKeyDown) mutates the DOM directly for exactly this
  // reason, since React's own state update is not applied synchronously and
  // this handler can run (via the nested blur) before React re-renders. Falls
  // back to state for a programmatic call with no event (closeWithCommit).
  const commitName = useCallback((e) => {
    const value = e?.target?.value ?? clipName;
    if (value !== (existingClip.name || '')) onUpdateClip(existingClip.id, { name: value });
  }, [clipName, existingClip.id, existingClip.name, onUpdateClip]);

  const commitNotes = useCallback((e) => {
    const value = e?.target?.value ?? notes;
    if (value !== (existingClip.notes || '')) onUpdateClip(existingClip.id, { notes: value });
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

  // T8600: shared disclosure label.
  const detailsLabel = ANNOTATE.DETAILS;

  // T11150: RatingPill is keyed on clip identity (below, at each render site)
  // so its open popup resets on a REAL clip switch, but — like the
  // existingClip object itself — stays mounted (and open) across the
  // same-play identity churn a surgical update causes (updateClipRegion
  // spreads the region on every write), matching the reset effect's own
  // samePlay rule above.
  const highlightMade = !!existingClip.autoProjectId;

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

        {/* Name + rating tier (T11150: Play editor hierarchy) — the play's
            name and its rating sit on ONE tier, right after the time control,
            with the highlight-made chip alongside once a clip exists. */}
        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">{ANNOTATE.PLAY_NAME}</label>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              ref={nameInputRef}
              type="text"
              value={clipName}
              onChange={handleNameChange}
              onBlur={commitName}
              onKeyDown={(e) => onTextFieldKeyDown(e, { draftSetter: setClipName, storedValue: existingClip.name, allowEnterCommit: true })}
              placeholder="Enter play name..."
              className="flex-1 min-w-0 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-green-500"
            />
            <RatingPill key={existingClip.id} rating={rating} onRatingChange={handleRatingChange} myAthlete={myAthlete} isMobile={isMobile} />
            <HighlightMadeChip show={highlightMade} />
          </div>
        </div>

        {/* T10310 (2026-09-18 user request): the "Create clip" affordance moved
            out of the editor entirely -- onto the main Annotate screen's split
            [Edit Play]/[Frame Clip] row (AnnotateModeView), which both creates
            the project AND opens Framing in one gesture. */}

        {/* T9830/T11150: "Details" disclosure — category, teammates, sport,
            tags and notes. One button, two presentations: desktop expands
            the fields in place (below, category-first per H16); mobile opens
            the full-screen AddDetailsPopup (rendered by the inline layout
            wrapper). */}
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

        {/* Desktop expand-in-place details panel (mobile uses AddDetailsPopup).
            T11150 (H16): category (My athlete/Team) leads, then teammates
            (Team layer only), then the shared tags/notes fields. */}
        {!isMobile && detailsOpen && (
          <div className="mb-4 border-t border-gray-700 pt-4">
            <div className="mb-4">
              <label className="block text-gray-400 text-sm mb-2">{ANNOTATE.LAYER_LABEL}</label>
              <LayerSegmentedControl
                size={isMobile ? 'md' : 'sm'}
                value={myAthlete}
                disabled={!!existingClip.shared_by}
                disabledReason={layerDisabledReason}
                onChange={handleLayerChange}
                className="w-full"
              />
            </div>
            {!myAthlete && (
              <div className="mb-4">
                <label className="block text-gray-400 text-sm mb-2">Teammates</label>
                <TeammateTagInput
                  teammates={taggedTeammates}
                  onChange={handleTeammatesChange}
                  suggestions={teammateSuggestions}
                />
              </div>
            )}
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
      {displayStatus && (
        <div className="mb-1.5"><SaveStatusBadge status={displayStatus} /></div>
      )}
      <DeletePlayButton onDelete={() => onDeleteClip(existingClip.id)} />
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
      title={clipStage.stage === CLIP_STAGE.FOCUS ? ANNOTATE.FRAME_THIS_CLIP_HINT : `Open: ${clipStage.label}`}
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
    return (
      <>
        <div
          data-testid="annotate-editor-strip"
          className="rounded-lg border bg-gray-800/40 border-gray-700"
        >
          {/* T8892: which camera this play is cut from (angle-active only). */}
          {activeSourceName && (
            <div className="px-4 pt-2">
              <CutFromAngleChip name={activeSourceName} />
            </div>
          )}

          {/* Scrub row — T11150: time is the FIRST control, full strip width,
              at the top of the card (Play editor hierarchy). */}
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

          {/* Name + rating tier — T11150: the second tier, right after time.
              Inline-pencil rename (unchanged affordance) plus the RatingPill
              and (once a clip exists) the highlight-made chip. */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-700">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {isEditingName ? (
                <>
                  <Pencil size={16} className="shrink-0 text-gray-400" />
                  <input
                    type="text"
                    value={clipName}
                    onChange={handleNameChange}
                    onBlur={(e) => { commitName(e); setIsEditingName(false); }}
                    onKeyDown={(e) => onTextFieldKeyDown(e, { draftSetter: setClipName, storedValue: existingClip.name, allowEnterCommit: true })}
                    aria-label="Play name"
                    placeholder="Play name"
                    autoFocus
                    className="min-w-0 flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm
                               text-white placeholder-gray-500 focus:border-green-500 focus:outline-none"
                  />
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingName(true)}
                  title={ANNOTATE.RENAME_PLAY}
                  className="flex items-center gap-2 min-w-0 group"
                >
                  <Pencil size={16} className="shrink-0 text-gray-400 group-hover:text-gray-200" />
                  <span className="text-sm font-semibold text-white truncate group-hover:underline">
                    {existingClip.name || generateClipName(existingClip.rating, existingClip.tags, existingClip.notes) || 'this play'}
                  </span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <RatingPill key={existingClip.id} rating={rating} onRatingChange={handleRatingChange} myAthlete={myAthlete} isMobile={isMobile} />
              <HighlightMadeChip show={highlightMade} />
            </div>
          </div>

          {/* Controls row — T11150: category/Layer moved into the Details
              disclosure below (H16). */}
          <div className="px-4 pb-3 pt-3 flex flex-wrap items-center gap-3">
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
          </div>

          {/* Details panel — desktop expand-in-place. T11150 (H16): category
              (My athlete/Team) leads, then teammates (Team layer only), then
              the shared tags/notes fields via DetailsFields. */}
          {detailsOpen && (
            <div className="border-t px-4 py-3 border-gray-700">
              <div className="mb-4">
                <label className="block text-gray-400 text-sm mb-2">{ANNOTATE.LAYER_LABEL}</label>
                <LayerSegmentedControl
                  size="sm"
                  value={myAthlete}
                  onChange={handleLayerChange}
                  disabled={!!existingClip.shared_by}
                  disabledReason={layerDisabledReason}
                  className="w-full"
                />
              </div>
              {!myAthlete && (
                <div className="mb-4">
                  <label className="block text-gray-400 text-sm mb-2">Teammates</label>
                  <TeammateTagInput
                    teammates={taggedTeammates}
                    onChange={handleTeammatesChange}
                    suggestions={teammateSuggestions}
                  />
                </div>
              )}
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

          {/* Delete play + Done — placed after the details disclosure (open or
              closed) so toggling "Details" reveals content ABOVE these
              buttons rather than pushing them down past already-visible
              controls. */}
          <div className={`px-4 pb-3 flex items-center justify-end gap-2 ${detailsOpen ? 'pt-2 border-t border-gray-700' : ''}`}>
            {/* T10900: min-width, not a fixed w-32 -- the confirm state is TWO
                buttons ("Confirm Delete" + "Cancel") that overflowed a 128px
                slot and overlapped Done. */}
            <div className="min-w-[8rem] shrink-0">
              <DeletePlayButton onDelete={() => onDeleteClip(existingClip.id)} />
            </div>
            <button
              onClick={closeWithCommit}
              className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded transition-colors"
            >
              {ANNOTATE.DONE}
            </button>
          </div>
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
        {/* Name + rating tier (T11150: Play editor hierarchy). Landscape phone
            was never mocked (T11100 gate), so it is designed here against the
            live layout: one compact row — name absorbs the width (flex-1),
            RatingPill + highlight chip + the Details disclosure + Delete + close
            never shrink. Tags/notes/category live BEHIND Details (the
            full-screen AddDetailsPopup), NOT inline, matching the other four
            layouts' time -> name+rating -> Details hierarchy. */}
        <div className="flex items-center gap-2 mt-1.5">
          <input
            ref={nameInputRef}
            type="text"
            value={clipName}
            onChange={handleNameChange}
            onBlur={commitName}
            onKeyDown={(e) => onTextFieldKeyDown(e, { draftSetter: setClipName, storedValue: existingClip.name, allowEnterCommit: true })}
            aria-label={ANNOTATE.PLAY_NAME}
            placeholder="Name this play"
            className="flex-1 min-w-0 px-3 py-1.5 coarse-pointer:min-h-[44px] bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-green-500"
          />
          <RatingPill key={existingClip.id} rating={rating} onRatingChange={handleRatingChange} myAthlete={myAthlete} isMobile={isMobile} />
          <HighlightMadeChip show={highlightMade} />
          <button
            type="button"
            onClick={() => setDetailsOpen(o => !o)}
            aria-expanded={detailsOpen}
            data-testid="add-details-button"
            className="flex-none whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 coarse-pointer:min-h-[44px] bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
          >
            <ChevronDown size={14} />
            {detailsLabel}
          </button>
          <DeletePlayButton onDelete={() => onDeleteClip(existingClip.id)} variant="icon" />
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
        {/* Details -> full-screen AddDetailsPopup (category first per H16, then
            teammates, tags, notes). Delete stays inline above, so onDelete is
            NOT passed here (no double-render). */}
        {detailsOpen && (
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
            myAthlete={myAthlete}
            onLayerChange={handleLayerChange}
            layerDisabled={!!existingClip.shared_by}
            layerDisabledReason={layerDisabledReason}
            taggedTeammates={taggedTeammates}
            onTeammatesChange={handleTeammatesChange}
            teammateSuggestions={teammateSuggestions}
          />
        )}
      </div>
    );
  }

  if (layout === 'portrait-strip') {
    // T10620: mobile PORTRAIT editor — an in-flow compact strip rendered
    // DIRECTLY under the video card (AnnotateModeView), NOT a fixed bottom
    // sheet. Replaces the old `layout="inline"` sheet (fixed inset-x-0 bottom-0
    // max-h-[85vh]) whose whole point was pinning a Save footer (T8140) — that
    // footer is gone (T10610), so the video the trim handles refer to can stay
    // visible above the strip. Being in flow also retires the T10420
    // backdrop-filter containing-block trap for this surface (that trap only
    // bites `fixed`/`absolute` descendants).
    //
    // Deliberately its OWN branch, not a generalised landscape-inline: the two
    // still differ in spacing/rows (landscape packs name+rating+Details onto one
    // compact row for its height-starved viewport, portrait uses two rows). But
    // both now follow the SAME hierarchy (time → name+rating → Details) after the
    // T11150 landscape redesign, and BOTH reuse the component-scope write handlers
    // (handleRatingChange, handleLayerChange, handleTeammatesChange) + shared
    // building blocks (ClipScrubRegion compact, RatingPill's own popup, stageCta,
    // AddDetailsPopup, DeletePlayButton) — no copied write logic in any layout.
    //
    // Layout decision (360px, the narrowest supported width): category
    // (My athlete / Team), teammates and Delete play live BEHIND the disclosure,
    // not on strip row 2 — a segmented control on row 2 would crush the name
    // input below a usable width at 360px, and none of those fields are needed
    // while trimming.
    return (
      <div data-add-clip-form data-testid="annotate-portrait-strip" className="border-t border-gray-700 px-3 py-2">
        {/* T8892: which camera this play is cut from (angle-active only). */}
        <CutFromAngleChip name={activeSourceName} />

        {/* Strip row 1: compact trim bar + the T9480 typed-entry readouts —
            time is the FIRST control (T11150 Play editor hierarchy). */}
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

        {/* Row 1b: name + rating tier (T11150) — the second tier, right after
            time; name absorbs the squeeze (flex-1 min-w-0), the pill/chip never
            shrink. */}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <input
            ref={nameInputRef}
            type="text"
            value={clipName}
            onChange={handleNameChange}
            onBlur={commitName}
            onKeyDown={(e) => onTextFieldKeyDown(e, { draftSetter: setClipName, storedValue: existingClip.name, allowEnterCommit: true })}
            aria-label={ANNOTATE.PLAY_NAME}
            placeholder="Name this play"
            className="flex-1 min-w-0 px-3 py-2 coarse-pointer:min-h-[44px] bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-green-500"
          />
          <RatingPill key={existingClip.id} rating={rating} onRatingChange={handleRatingChange} myAthlete={myAthlete} isMobile={isMobile} />
          <HighlightMadeChip show={highlightMade} />
        </div>

        {/* Strip row 2: the disclosure + Done buttons NEVER shrink (flex-none,
            whitespace-nowrap). This is the artifact mockup's clipped-button
            regression — pinned by AnnotateFullscreenOverlay.portraitStrip.test. */}
        <div className="flex items-center gap-2 mt-1.5">
          <button
            type="button"
            onClick={() => setDetailsOpen(o => !o)}
            aria-expanded={detailsOpen}
            data-testid="add-details-button"
            className="flex-none whitespace-nowrap flex items-center gap-1.5 px-3 py-2 coarse-pointer:min-h-[44px] bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
          >
            <ChevronDown size={14} />
            {detailsLabel}
          </button>
          <button
            onClick={closeWithCommit}
            className="flex-none whitespace-nowrap px-4 py-2 coarse-pointer:min-h-[44px] bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {ANNOTATE.DONE}
          </button>
        </div>

        {/* Stage CTA (Frame / Apply Spotlight / View Final) full width below the
            strip when the clip has a project. */}
        {stageCta && <div className="mt-2">{stageCta}</div>}
        {keepMarkingCta && <div className="mt-1.5">{keepMarkingCta}</div>}

        {/* Everything else lives behind the disclosure -> full-screen popup (may
            cover the video; none of these are needed while trimming). Category,
            teammates and Delete play join the shared tags/notes/sport fields
            here on this surface only (optional props — the inline/mobileFs
            AddDetailsPopup render below stays byte-identical without them). */}
        {detailsOpen && (
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
            myAthlete={myAthlete}
            onLayerChange={handleLayerChange}
            layerDisabled={!!existingClip.shared_by}
            layerDisabledReason={layerDisabledReason}
            taggedTeammates={taggedTeammates}
            onTeammatesChange={handleTeammatesChange}
            teammateSuggestions={teammateSuggestions}
            onDelete={() => onDeleteClip(existingClip.id)}
          />
        )}
      </div>
    );
  }

  if (layout === 'inline') {
    // T8140: flex column = scrolling body (min-h-0 lets it shrink inside a bounded
    // flex parent — the ClipsSidePanel sidebar, the mobileFs sheet, the mobile
    // bottom sheet) + a pinned footer (Delete play + Done, T10610) that stays
    // reachable without scrolling (T4933 short-sidebar case AND the 390x844
    // mobile below-the-fold case).
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
            this layout, so both inherit it. T11150: formBody no longer
            renders category/teammates inline (moved into the Details
            disclosure, H16), so this popup now ALSO carries them — mirroring
            the portrait-strip AddDetailsPopup call. Delete stays in the
            pinned footer for this layout (actionsFooter above), so it is
            NOT passed here (no double-render). */}
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
            myAthlete={myAthlete}
            onLayerChange={handleLayerChange}
            layerDisabled={!!existingClip.shared_by}
            layerDisabledReason={layerDisabledReason}
            taggedTeammates={taggedTeammates}
            onTeammatesChange={handleTeammatesChange}
            teammateSuggestions={teammateSuggestions}
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
