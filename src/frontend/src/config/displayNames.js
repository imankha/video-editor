import { formatLength, PRECISION } from '../utils/timeFormat';
import { STORAGE_DURATION_DAYS } from '../utils/storageCost';
import { DEFAULT_CLIP_BEFORE, DEFAULT_CLIP_AFTER } from '../components/shared/clipConstants';

// T9520 / T14600: the canonical vocabulary, single source. The word list is
// .claude/references/copy-glossary.md (read it before adding copy). Object model:
// a GAME holds PLAYS (marked moments, or short videos the parent uploaded); a PLAY
// becomes a HIGHLIGHT (the finished video) after the paid AI step; several
// highlights played as one video are a HIGHLIGHT REEL. "clip", "draft", "reel",
// "moment" and "annotation" are retired from user copy. Internal names (the `my_athlete` field,
// `autoProjectId`, EDITOR_MODES, routes, analytics events) are deliberately NOT
// renamed to match — deep links and greppability beat cosmetic consistency.
// Editor mode names live in MODE_NAMES below (T9860 moved them off the per-mode
// editorStore.SCREENS[].label and out of this comment).
export const ANNOTATE = {
  // T13270: footage placed by prefix-sum (no usable recorded time) plays right after the
  // previous video. The bar hint + toast say so in words; one canonical copy.
  appendedFootageTitle: (name) => `${name}. We couldn't tell when it was filmed, so it was added at the end of the game. Tap to jump to the start of this video`,
  appendedFootageToast: (name) => `Added ${name} after the previous video; it plays through continuously. We couldn't tell when it was filmed, so it went at the end.`,
  // T13280: the Videos control for a game with 2+ videos (SourceBar under the player on
  // every width, VideoLane on the desktop timeline). Blue = main footage, violet = angle.
  VIDEOS_LABEL: 'Videos',
  // T14610: other cameras filmed at the same time (code: "angles"). Never "angle" in copy.
  CAMERAS_LABEL: 'Cameras',
  CAMERAS_HELP: 'Other cameras filmed at the same time. Pick a bar to switch.',
  moreCameras: (n) => `${n} more camera${n === 1 ? '' : 's'}`,
  cameraLabel: (name) => `Camera: ${name}`,
  PLAY_THIS_CAMERA: 'Play this camera',
  // T13280 follow-up (2026-10-22, user: "the main video doesn't need any visual
  // indication, only added footage does"): the game's own original video, when it
  // has no stored filename to show, should never fall through to `videoDisplayName`'s
  // "Extra video {n}" fallback -- that phrase is for ANGLES/add-ons missing a name,
  // not the primary recording. Distinct from MAIN_CAMERA (the overlap game's backbone
  // vocabulary, used only once an angle exists to be "main" relative to).
  ORIGINAL_VIDEO: 'Game video',
  MAIN_CAMERA: 'Main camera',
  BACK_TO_MAIN_CAMERA: 'Back to main camera',
  videoPosition: (i, n) => `Video ${i} of ${n}`,
  watchingSource: (name) => `Watching ${name}`,
  nowWatching: (name) => `Now watching ${name}`,
  jumpToVideoTitle: (name) => `Jump to the start of ${name}`,
  switchHereTitle: (name) => `Switch to ${name} here`,
  // T14610: "Fix timing" is retired; the action names the parent's goal.
  LINE_UP_VIDEO: 'Line up this video with the game',
  fixTimingFor: (name) => `Line up ${name} with the game`,
  dragToRepositionTitle: (name) => `Drag to reposition ${name}`,
  // Shown (in the Videos bar's notice slot) when a video is picked while line-up
  // is open: picking would seek the COMMITTED timeline, i.e. the video's old spot.
  FINISH_FIX_TIMING_FIRST: 'Tap Done to keep the move first, or X to undo it',
  VIDEOS_HELP: 'The videos in this game. Tap one to watch it. Where two cameras filmed at the same time, tapping switches cameras without moving.',
  PREV_VIDEO: 'Previous video',
  NEXT_VIDEO: 'Next video',
  MODE_DESCRIPTION: 'Mark plays: tap Mark play right after a great play.', // N04/T11850 mode-switcher help
  BACK_TO_MARK_PLAYS: 'Back to plays',
  SOURCE_EXPIRED_PLAYS_LISTED: 'Your plays are still listed.',
  // T14610 (audit F-35): the game video is gone after the storage window.
  SOURCE_EXPIRED_TITLE: 'Game video expired',
  SOURCE_EXPIRED_CANT_MARK: "The full game video is no longer stored, so you can't mark new plays. Your plays are still listed.",
  // T14610 (audit F-44/F-45): screen-reader names for the player.
  GAME_VIDEO_LABEL: 'Game video',
  WATCHING_PLAYS_LABEL: 'Playing your marked plays',
  GETTING_READY: 'Getting ready...',
  // T14610 (audit F-03): action-card descriptions say play, matching the buttons.
  MARK_PLAY_CARD: 'Save a play to turn into a highlight.',
  WATCH_PLAYS_CARD: "Watch the plays you've marked.",
  SHARE_GAME_CARD: 'Share the game and your marked plays.',
  BACK_TO_GAME_CARD: 'Go back to the game and mark more plays.',
  MARK_PLAY: 'Mark play',                  // N05 — primary create CTA
  EDIT_PLAY: 'Edit play',                  // N05 — edit CTA
  // T12410: one supporting line under the Mark play card text. The 6/2 numbers are read
  // from clipConstants (T9840), never typed here, so the copy cannot drift from the real
  // capture window. Says nothing about framing or tracking.
  CAPTURE_WINDOW_HINT: `grabs last ${DEFAULT_CLIP_BEFORE}s and next ${DEFAULT_CLIP_AFTER}s`,
  // T11860: reveals the frame-step / timeline zoom / layer filter hidden on a fresh game.
  MORE_CONTROLS: 'More controls',
  PLAYS_HEADING: 'Plays',                  // N06 — sidebar list heading
  JUST_SAVE_PLAY: 'Just save this play',
  // T14610: one placeholder for the play name field (audit F-58).
  NAME_PLACEHOLDER: 'Name this play',
  NOTES_LABEL: 'Notes (optional)',
  NOTES_PLACEHOLDER: 'Add a note about this play',
  // T14610 (audit F-48): a typed teammate name that was never added.
  TAG_NOT_ADDED_TITLE: 'Add the teammate first',
  TAG_NOT_ADDED_MESSAGE: 'Tap Add next to the name to tag them.',
  // T14610 (audit F-60..F-62): the plays list controls.
  FILTER_LABEL: 'Show plays for',
  PLAY_TYPE_LABEL: 'Play type',
  LOADING_PLAYS: 'Loading your plays...',
  NO_PLAYS: 'No plays yet',
  NO_FILTER_PLAYS: 'No plays match this filter',
  SHOW_PLAYS: 'Show plays',
  HIDE_PLAYS: 'Hide plays',
  BACK_TO_PLAYS: 'Back to plays',
  // T14610: play-save failures (useRawClipSave). One error voice; never "highlight"
  // for a marked play, never "cloud".
  SAVE_PLAY_FAILED: "We couldn't save your play. Try again.",
  UPDATE_PLAY_FAILED: "We couldn't save your change to this play. Try again.",
  DELETE_PLAY_FAILED: "We couldn't delete your play. Try again.",
  LINK_PLAY_FAILED: "We couldn't change this play's game. Try again.",
  // T11130: CREATE_EDITABLE_CLIP / SAVE_PLAY_AND_CLIP / CREATE_CLIP removed —
  // the "Create clip"/"Save and create clip" affordances are gone; a play
  // becomes a highlight through the rating + Done -> Highlight popup gesture
  // (HIGHLIGHT_CHOICE_* / HIGHLIGHT_MOVED_TO_CLIPS below), not a manual toggle.
  // T10550: the rating popup's own visible heading (+ its accessible name, so
  // they match) — layer-aware like `getRatingCaption`'s existing `mine` split,
  // so a Team play never claims to be "your athlete's".
  RATE_ATHLETES_PLAY: "Rate your athlete's play",
  RATE_TEAMS_PLAY: "Rate your team's play",
  DELETE_CLIP: 'Delete highlight',         // N14 - delete a highlight (library/DraftTile, T11280)
  DELETE_PLAY: 'Delete play',              // N14 - delete a bare play marker
  RENAME_CLIP: 'Rename highlight',         // N15 - rename action (library/DraftTile, T11280)
  CLIP_NAME: 'Highlight name',             // N15 - name field (library/DraftTile, T11280)
  // T11150 (Play editor hierarchy): the Annotate editor's own name/rename/rate
  // vocabulary, split off CLIP_NAME/RENAME_CLIP/DELETE_CLIP above — those stay
  // frozen (LIBRARY_ACTIONS re-exports them for the library/DraftTile surface,
  // T11280 scope) while the editor itself drops "clip" wording entirely.
  PLAY_NAME: 'Play name',
  RENAME_PLAY: 'Rename play',
  // T11840: the editor's single labeled rating row (replaces the gray "Rate this
  // play" pill + the bare star row). Captions under each star come from
  // RATING_ADJECTIVES (clipConstants); the caption is the selected rating's
  // RATING_MEANINGS line.
  RATING_QUESTION: 'How good was this play?',
  // Muted suffix after the question: new plays default to Good, so say it is changeable.
  RATING_CHANGE_HINT: 'Tap to change',
  // T11840: icon-only X in the highlight choice card header (Escape's touch twin).
  RATE_MODAL_CLOSE_LABEL: 'Back to the play',
  // T11840: mode-bar help (retired by T12130; Annotate shows no tabs until a highlight exists).
  // T11130: the Done -> Highlight choice card (in-place gold mode-swap of the
  // edit strip when Done fires on a Brilliant-rated play that is not yet a
  // highlight). "Keep Annotating" is the explicit return-to-work action.
  // Escape is the only
  // no-save exit; never closes on backdrop.
  HIGHLIGHT_CHOICE_EYEBROW: 'Highlight',
  HIGHLIGHT_CHOICE_TITLE: 'Make this a highlight now?',
  MAKE_HIGHLIGHT_NOW: 'Make highlight',
  BACK_TO_EDITING: 'Keep marking plays',
  BACK_TO_EDITING_SUBTEXT: 'Saves this play as a highlight in Plays. Open it there to edit or finish it.',
  // T11130: the "Keep Annotating" confirmation toast (via announceReelCreated,
  // no action button) — the editor closes, so the toast IS the confirmation.
  // "Clips" (capital C) names the Home tab; one of only two strings in Annotate
  // that still say "Clips".
  HIGHLIGHT_MOVED_TO_CLIPS: 'Highlight moved to Plays so you can edit it later',
  // T11150: error-path toasts (AnnotateContainer) — single-sourced so the
  // "no clip wording in Annotate" sweep is greppable/testable, not buried inline.
  // T14610 (audit F-34): one title for a game that is gone.
  GAME_REMOVED_TITLE: 'This game was removed',
  GAME_REMOVED_RETURNED: 'We took you back to your games.',
  // T14970: a link or bookmark named something that is in none of the user's profiles.
  GAME_NOT_HERE: 'That game is no longer here',
  PLAY_NOT_HERE: 'That play is no longer here',
  GHOST_GAME_SAVE_MESSAGE: "Your play couldn't be saved because this game was removed. Your work is still on screen. Head back to your games to continue.",
  IMPORT_FAILED_TITLE: 'Plays not saved',
  IMPORT_FAILED_MESSAGE: "Your imported plays couldn't be saved because the game isn't ready. Please try importing again.",
  // T14370: Mark play never fails silently. A tap while /load is in flight is
  // refused with this; any other exit from the Mark play chain shows the
  // not-saved copy with an action that opens Report a problem.
  MARK_PLAY_LOADING_TITLE: 'Still loading this game',
  MARK_PLAY_LOADING_MESSAGE: 'Wait a few seconds, then mark the play again.',
  MARK_PLAY_FAILED_TITLE: 'Play not saved',
  MARK_PLAY_FAILED_MESSAGE: "We couldn't save this play. Report it so we can fix it.",
  MARK_PLAY_REPORT_ACTION: 'Report a problem',
  // T10610: the play editor's sole close affordance now that there is no
  // Save/Update button — commits any dirty text field first (closeWithCommit),
  // then closes. Nothing is ever discarded.
  DONE: 'Done',
  PREVIEW_PLAYS: 'Watch plays',            // N26 / T14610 — playback-all button (glossary action "Watch plays")
  // T11750: the zero-plays "Review plays" control is locked (no plays to review
  // yet). It stays tappable (aria-disabled, not disabled) and this toast explains
  // why, deduped so repeated taps show one toast.
  REVIEW_PLAYS_LOCKED_TOAST: 'Mark your first play to watch it.',
  SHARE_PLAYS_LOCKED_TOAST: 'Mark your first play to share it.',
  PREVIEW_CLIP: 'Watch play',              // N26 — per-play preview (T14610)
  LAYER_LABEL: 'Who is this play about?',  // T12170 (was 'Play category', N28)
  LAYER_MINE: 'My athlete',                // N28, reversed by T9860 (2026-09-14)
  LAYER_TEAM: 'Team',                      // N28 — unchanged
  // T14610: the plays-list filter chips and empty states (audit F-59). The
  // "Who is this play about?" answers stay My athlete / Team; a list of plays
  // reads "my athlete's plays" / "team plays", never "layer".
  FILTER_ALL: 'All',
  sharedTeamPlay: (name) => `Shared by ${name}, so this stays a team play`,
  FILTER_MINE: "My athlete's plays",
  FILTER_TEAM: 'Team plays',
  NO_MINE_PLAYS: 'No plays for your athlete yet',
  NO_TEAM_PLAYS: 'No team plays yet',
  // N41 (T9580) — the first-clip invitation after a saved play. FRAME_THIS_CLIP
  // is the FOCUS-stage primary CTA (single-sourced into clipStage.getClipStage,
  // so the desktop strip and the sidebar share it); KEEP_MARKING_PLAYS is its
  // dismiss secondary (closes the editor, playhead preserved). Later stages keep
  // their T9320/T9330 labels (Apply Spotlight / View Final / View Published).
  // 2026-09-18 (user request): shortened from "Frame this clip" to "Frame" —
  // the timeline strip's Edit play/Frame pairing already frames it as an
  // action on the currently-selected clip; no need to repeat "this clip".
  FRAME_THIS_CLIP: 'Make highlight',       // FOCUS-stage primary CTA
  // T11430: the primary CTA once at least one highlight instance exists for
  // the play (any instance, published or in-progress — design §4.5 decision B).
  MAKE_ANOTHER_HIGHLIGHT: 'Make another highlight',
  // T11910: orientation vocabulary, still used by the T14770 list rows below.
  PORTRAIT: 'Portrait',
  LANDSCAPE: 'Landscape',
  HIGHLIGHT_NOT_STARTED: 'Not started',
  // A slot while its game is still uploading: the source isn't stored yet.
  HIGHLIGHT_AFTER_UPLOAD: 'Available when your upload finishes',
  // Row action for an EXISTING highlight still at the framing stage; "Make
  // Highlight" there reads like creating another one.
  CONTINUE_HIGHLIGHT: 'Continue highlight',
  ADD_SPOTLIGHT: 'Add spotlight',
  CONTINUE_SPOTLIGHT: 'Continue adding spotlight',
  WATCH_HIGHLIGHT: 'Watch highlight',
  startHighlight: (orientation, ordinal) => `Start ${orientation.toLowerCase()} highlight ${ordinal}`,
  // T14770 (decision C, 2026-11-03): ONE Make highlight entry button (the shape
  // is picked in Frame, not here) + the "Highlights from this play" list below
  // it. Replaces the T11910 two-slot surface.
  MAKE_HIGHLIGHT: 'Make highlight',
  MAKE_HIGHLIGHT_CARD: 'Turn this play into a video you can share.',
  EDIT_PLAY_CARD: 'Fix the timing, rating or tags.',
  OPENING_FRAME: 'Opening Frame...',
  HIGHLIGHTS_FROM_PLAY: 'Highlights from this play',
  highlightCountChip: (orientation, n) => `${n} ${orientation.toLowerCase()}`,
  SHOW_FEWER_HIGHLIGHTS: 'Show fewer',
  showAllHighlights: (n) => `Show all ${n} highlights`,
  STALE_HIGHLIGHT_SUBLINE: 'Play timing changed',
  highlightRowName: (orientation, ordinal) => `${orientation}${ordinal >= 2 ? ` ${ordinal}` : ''}`,
  // Frame's "Where will you share it?" shape choice (T14770 decision 1, Option C).
  SHARE_WHERE_TITLE: 'Where will you share it?',
  SHARE_WHERE_PORTRAIT_HINT: 'Instagram Reels, TikTok, Stories',
  SHARE_WHERE_LANDSCAPE_HINT: 'YouTube, TV, sending to coaches',
  switchShapeTitle: (toLabel) => `Switch to ${toLabel.toLowerCase()}?`,
  SWITCH_SHAPE_BODY: 'Your box positions will be refit to the new shape.',
  SWITCH_SHAPE_CONFIRM: 'Switch',
  keepShapeLabel: (fromLabel) => `Keep ${fromLabel.toLowerCase()}`,
  // 2026-09-18 (user request): rollover on the Frame this clip button, using
  // ALREADY-APPROVED copy -- the Clips-tab guidance body (T10280, the user's
  // own words, 2026-09-17) is the one place the app explains what Framing
  // does; this reuses its "what Framing does" sentence verbatim.
  FRAME_THIS_CLIP_HINT: 'In Frame you keep your athlete in the box, trim the play and add slow motion.',
  // T11130: KEEP_MARKING_PLAYS removed with the editor's first-clip invitation
  // (H8 removed the editor stage buttons); the Highlight popup owns the
  // create-vs-keep-editing choice now.
  // T10240 (N42): the Framing-entry action. "Frame" is the VERB form of the
  // Framing mode (MODE_NAMES.FRAMING = 'Framing', T9860) — deliberately NOT
  // the old "Focus" mode name, and NOT the noun "Framing" (which would read
  // "Framing clip"). FRAME_CLIP pairs with CREATE_CLIP as the two NO_PROJECT
  // stage actions (create-only vs create-and-open-Framing, T10240).
  // T10610: SAVE_AND_FRAME (the editor's create-then-open-Framing outcome)
  // is retired — there is no save gesture left to attach it to.
  FRAME_CLIP: 'Make Highlight',            // retained for FramingHeaderStatus / ClipSelectorSidebar
  // T11130: FRAME_NOW / FRAME_LATER / FRAME_LATER_HINT removed — the T10450
  // main-screen Frame Now / Frame Later create row is gone; a play becomes a
  // highlight through the rating + Done -> Highlight popup gesture. A play that
  // already has a project keeps the single existing stage-CTA button
  // (Frame/Apply Spotlight/View Final/View Published) on the main screen (H8).
  // T10290: the details disclosure label (was the inline literal "Add details",
  // then just "Details", then "Rate and Tag", then "Notes and Tags"). T10620:
  // back to "Details" — the portrait strip moved category/teammates/Delete play
  // behind this same disclosure, so "Notes and Tags" undersold what it holds
  // (and produced the redundant "Notes and Tags (note)" suffix below).
  // The count suffix (e.g. "Details (2 tags, note)") is composed at the call
  // site when content exists.
  DETAILS: 'Details',
  // T14610: one heading for the details editor (audit F-56), so both read Details.
  ADD_TAGS_AND_NOTES: 'Details',
  VIEW_TAGS_AND_NOTES: 'Details',
  // T9900: caption under the create-in-flight DISABLED "Frame this clip" button, so a
  // briefly-disabled onward action explains its temporary preparation state instead of
  // reading as broken (evidence E09). Clears itself when the project id lands.
  PREPARING_CLIP: 'Getting ready...',
};

// T9560 (Shared Vocabulary epic, N34): the Annotate share controls, single source.
// The old copy ("Share Annotations" / "Shared w/ Tagged Teammates") both said
// "Annotations" (off the play/clip object model) and, worse, the "Shared …" state
// label read as a claim that sharing had already happened when it may not have.
// Split cleanly: SHARE_PLAYS is the ACTION (open the share flow); SETTINGS is the
// state-neutral label for managing an existing share (opens the same dialog without
// re-implying a fresh share). Never imply sharing that has not occurred.
// T11840: game-card play count, singular/plural in ONE place.
export const GAME_CARD = {
  PLAYS_COUNT: (n) => `${n} play${n !== 1 ? 's' : ''}`,
  // T12950: accessible name for the gold-star brilliant (5-star) count segment.
  BRILLIANT_COUNT: (n) => `${n} brilliant`,
  // T12930: top-left chip on a game kept for its marked plays only.
  PLAYS_ONLY_CHIP: 'Plays only',
  // T12850: storage deadline row in the game menu.
  AVAILABLE_UNTIL: (date) => `Available until ${date}`,
  // T12930: shown under the chip while the on-demand plays backup has failed (visible, not silent).
  PLAYS_NOT_BACKED_UP: 'Plays not backed up yet',
};

// T12930: "Keep only marked plays" gesture + its Restore twin. Vocabulary: "play" for a
// marked moment, "highlight" for the finished product.
export const PLAYS_ONLY = {
  PANEL_TITLE: 'Marked plays only',
  PANEL_BODY: 'This game keeps only its marked plays. Restore the full video to mark more.',
  KEEP_TITLE: 'Keep the marked plays only?',
  keepBody: (dateLabel, n) =>
    `The full game video stays${dateLabel ? ` until ${dateLabel}` : ''} and you can restore it until then. After that only your ${n} play${n !== 1 ? 's' : ''} remain. Plays can still become highlights.`,
  KEEP_CONFIRM: 'Keep plays only',
  keptToast: (dateLabel) =>
    `Only the marked plays are kept.${dateLabel ? ` Restore the full video any time before ${dateLabel}.` : ''}`,
  RESTORE_TITLE: 'Restore the full video?',
  RESTORE_BODY: 'You can mark more plays again. Keep-only can be chosen again later.',
  RESTORE_CONFIRM: 'Restore video',
  RESTORED_TOAST: 'Full video restored',
  RESTORE_STALE_TOAST: 'The full video is no longer available to restore.',
  FAILED_TOAST: "That didn't work. Please try again.",
  CANCEL: 'Cancel',
  MORE_PLAYS_PROMPT: 'Want to mark more plays?',
};

// T14610: the game plays modal (RecapPlayerModal). Glossary: all plays from one game
// back to back are "game plays"; a 5-star play is "brilliant"; "recap", "draft",
// "moment" and "annotation" are retired from this copy.
export const RECAP = {
  TITLE: 'Game plays',
  TEAM_TAB: 'Team plays',
  athleteTab: (name) => (name ? `${name}'s plays` : "My athlete's plays"),
  ALL_TAB: 'All plays',
  BRILLIANT_TAB: 'Brilliant plays',
  MINE_HEADING: "My athlete's plays",
  TEAM_HEADING: 'Team plays',
  playsCount: (n) => `${n} play${n === 1 ? '' : 's'}`,
  MAKE_HIGHLIGHT: 'Make highlight',
  MAKE_HIGHLIGHT_HINT: 'Make a highlight from this play',
  MAKE_HIGHLIGHT_IN_MARK_PLAYS_HINT: 'Open this play in Mark plays to make a highlight',
  ALREADY_IN_PLAYS: 'This play is already in Plays',
  ADDED_TO_PLAYS: 'Added to Plays',
  VIDEO_UNAVAILABLE: 'Game video unavailable',
  SHOW_LIST: 'Show plays list',
  HIDE_LIST: 'Hide plays list',
  VIDEO_GONE: "This game's video has expired, but your marked plays are still listed.",
  LEGACY_VIDEO_GONE: "This game's video has expired.",
  LEGACY_NOTE: "This is an older video that plays every rated play together. Skipping plays and filtering by teammate aren't available for this game.",
  LOAD_FAILED: "We couldn't load these plays. Try again.",
};

export const SHARING = {
  SHARE_PLAYS: 'Share game',       // the action — open the game-invitation flow
  SHARE_PLAYS_SHORT: 'Share',       // narrow-viewport action label
  SETTINGS: 'Sharing settings',     // state-neutral: manage/adjust an existing share
  SETTINGS_SHORT: 'Sharing',        // narrow-viewport state label
  // T9810: the "Share game" buttons (fullscreen bar + normal-view promoted/compact)
  // all open the game-scoped SharePlaybackDialog now. Tagged-player sharing (T2820,
  // ShareWithTeammatesModal) keeps its OWN honest affordance, rendered only when
  // tagged clips exist so it can never silently no-op.
  TAGGED_SHARE: 'Share with tagged teammates',       // T2820 tagged-player sharing entry
  TAGGED_SHARE_SHORT: 'Tagged teammates',            // narrow-viewport label
  // T9810: scope disclosure for the game-invitation dialog. VERIFIED against
  // POST /api/games/{id}/share-playback -> materialize_game_share/_copy_game +
  // _materialize_clips: a recipient receives the FULL game recording (blake3_hash +
  // all game_videos) PLUS every marked play (all raw_clips for the game), not a
  // subset. Do NOT narrow this to "only invited plays" without re-checking that grant.
  SCOPE_DISCLOSURE: "Anyone you invite can watch this entire game and every play you've marked in it.",
  // T9810: open-failure state (dialog reached without a game context). Distinct from
  // the per-recipient send-failure toast ("Failed to send to: ...").
  OPEN_ERROR: "Game invitations couldn't open. Try again.",
};

// T9860 (Shared Vocabulary epic, copy and concept sweep): the editor MODE noun,
// single source. Was declared per-mode in editorStore.SCREENS[].label (a store
// owning a UI string) plus duplicated across draftStage, SegmentedProgressStrip,
// DraftTile, AnnotateFullscreenOverlay and quest_config.py. FRAMING replaces the
// prior epic override that had named this mode noun after the render engine
// (see the T9550 comment below, superseded).
// T12500: Overlay Text tab copy (no editor jargon: no "region", "playhead", "lane").
export const OVERLAY_TEXT = {
  SHEET_TITLE: 'Text',
  INPUT_PLACEHOLDER: 'Name or number, e.g. #7 Maya',
  EMPTY_STATE: 'Tap Add text to put a name or number on the video.',
  typeHint: (seconds) => `Type your text below. It shows for ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`,
};

// T14520: detection copy. The parent picks the athlete; the app only finds people
// in the frame, so no string here may say it tracks, follows or frames anyone.
export const DETECTION = {
  FINDING: 'Finding athletes...',
  MARKER_DISABLED: 'Finding athletes is unavailable right now',
  FREE_LINE: 'Finding athletes in your video',
  count: (n) => `${n} ${n === 1 ? 'athlete' : 'athletes'} found`,
  MARKER_PICKED: 'Athlete picked. Tap to change.',
  markerFound: (n) => `${n} ${n === 1 ? 'athlete' : 'athletes'} found. Tap to pick yours.`,
};

// T14780 (user pick 2026-11-07): "Frame" renamed to "Zoom in" -- a first-time
// parent doesn't know what framing is, but "zoom in" says what the step does.
export const MODE_NAMES = {
  ANNOTATE: 'Mark Plays',
  FRAMING: 'Zoom in',
  SPOTLIGHT: 'Spotlight',
};

// Header mode-bar labels are calls to action while the broader MODE_NAMES
// vocabulary remains the noun used by status text, progress strips, and tiles.
export const MODE_SWITCHER_NAMES = {
  ANNOTATE: MODE_NAMES.ANNOTATE,
  FRAMING: 'Zoom in',
  SPOTLIGHT: 'Spotlight',
};

export const MODE_SWITCHER_DESCRIPTIONS = {
  FRAMING: 'Reframe, trim and speed',
  SPOTLIGHT: 'Spotlight, text and cover',
};

// T12130: header tab lock reasons. Shown as visible text (and the tap toast), never
// only as a hover title. Annotate with no highlight renders no tabs at all.
export const MODE_SWITCHER_LOCKED = {
  SPOTLIGHT_NEEDS_HIGHLIGHT: 'Make your highlight first, then add a spotlight.',
  LOADING_PLAYS: 'Loading your plays...',
  LOADING_WORKING_VIDEO: 'Loading video...',
  OUT_OF_SYNC: 'Your highlight no longer matches your zoom. Sharpen it again, then add a spotlight.',
};

// T9860 (Shared Vocabulary epic, copy and concept sweep, design doc section 2.3
// Section 5): one reason sentence per stage, none using the feature's own name
// as the reason. T9860 aliased FOCUS_PUBLISH.SPOTLIGHT_CAPTION to SPOTLIGHT;
// T10670 broke that alias (the Focus completion tile now has its own short caption)
// so SPOTLIGHT stands alone as the Spotlight-mode reason line. Declared here (near
// MODE_NAMES) rather than at the file's end because FOCUS_PUBLISH and OVERLAY_PUBLISH
// below both read PUBLISH as part of their publish captions.
// T10310 (2026-09-18 user request): MARK_PLAY ("You are bookmarking, not
// editing...") was dropped -- the Annotate primary CTA area no longer shows a
// stage-reason line, only the capture-window mechanic sentence.
export const STAGE_REASONS = {
  FRAMING: 'Put the box on your athlete. Only what is inside it stays in your highlight.',
  SPOTLIGHT: 'Twenty-two athletes in the same uniform: this is how anyone watching knows which one is yours.',
  PUBLISH: 'Nobody else can see this until you share a link.',
};

// T10180 (design doc §3.1): the private-result-surface publish -> visibility-
// review -> link-ready vocabulary, single source. Policy-checked against the
// T9670 audience contract: publishing alone grants no audience; a link is
// CREATED, never sent/emailed/watched. "Update shared version" (item 4) ships
// in T10860 (design doc §9 Q2 accepted the strings below as proposed).
// T12210: share-modal visibility control (ShareModal + CollectionShareModal).
export const SHARE_VISIBILITY = {
  LABEL: 'Who can watch',
  RESTRICTED: 'Only people I add',
  PUBLIC: 'Anyone with the link',
  RESTRICTED_HELP: 'Only the people you add can watch.',
  PUBLIC_HELP: 'Anyone with the link can watch. Creating a link does not send it.',
};

export const RESULT_PUBLISH = {
  // Idle primary action -- starts the review flow, does NOT publish yet.
  PUBLISH_GET_LINK: 'Get link',
  // Visibility-review confirm card.
  REVIEW_TITLE: (name) => `Share "${name}"?`,
  REVIEW_BODY: 'Anyone with the link can watch. Creating a link does not send it.',
  REVIEW_CANCEL: 'Cancel',
  REVIEW_CONFIRM: 'Create link',
  // Busy + failure (reuse existing amber copy for the retry banner; this is the actionBar label).
  PUBLISHING: 'Creating link...',
  // Link-ready success state.
  LINK_READY: 'Link ready',
  // Heading while no link exists yet (never claim 'Link ready' without a URL).
  SHARE_HEADING: 'Share this highlight',
  COPY_LINK: 'Copy link',
  SHARE_LINK: 'Share link...',   // coarse-pointer native share entry
  // T10860: re-point an already-distributed share token to a moved final_video
  // after a private re-export. Shown only when payload.staleShare is non-null.
  UPDATE_SHARED: 'Update link',
  UPDATE_SHARED_HINT: 'Your link still shows your earlier highlight. Update it to show the latest.',
};

export const SECTION_NAMES = {
  // Single-clip auto-draft tab (Home). Tab id stays `projects` / URL
  // `/home/reels` (frozen for deep-link compat). T9530 (Shared Vocabulary epic,
  // N10, 2026-09-10) dropped the "In Progress" prefix — status is shown per item,
  // not baked into the object name — so the label is now just "Clips" (was
  // "In Progress Clips" T8555, "Clips" T8360, "Reel Drafts" before). This makes
  // the full label match SECTION_NAMES_SHORT.CLIPS universally.
  CLIPS: 'Plays',
  CLIPS_LOWER: 'plays',

  // T11230 removed the In Progress Reels TAB and its Create-reel builder. T11280
  // (R2) then repointed LockedReasonModal's collections copy to PUBLISHED (where
  // collections actually live now, inside PublishedReelsPanel) and swept the
  // "reel" noun to "highlight", so this constant has NO remaining consumers. Key +
  // value kept only as an out-of-scope internal identifier (T11280 is a UI copy
  // sweep, not a rename pass); it renders nowhere.
  REELS: 'Reels',

  // Published reels tab (T8555) -- every published reel regardless of single-
  // or multi-clip origin (the old gallery/DownloadsPanel published list,
  // relocated to its own top-level tab).
  PUBLISHED: 'Highlights',
};

// T9530 (Shared Vocabulary epic, N01-N03/N12-N15): the Library-surface object
// action vocabulary, single source. Object model: you UPLOAD a game or a clip
// (source ingest), ADD footage to an existing game, and CREATE a reel by
// assembling multiple clips. Per-card actions name their OWN object — a Clip
// (a single-clip auto-draft, project.is_auto_created === true) is deleted /
// renamed / published as a clip; a Reel (assembled multi-clip, is_auto_created
// === false) as a reel. The two clip strings reuse ANNOTATE's canonical values
// so a single datum never drifts across surfaces (one canonical location rule).
export const LIBRARY_ACTIONS = {
  UPLOAD_GAME: 'Upload game',              // N01 — was "Add Game"/"Add New Game"
  UPLOADING_GAME: 'Uploading game...',     // N01 — submit busy state
  ADD_FOOTAGE: 'Add video',                // N03 / T14610 — glossary verb for another half or camera
  DELETE_CLIP: ANNOTATE.DELETE_CLIP,       // N14 — 'Delete highlight'
  RENAME_CLIP: ANNOTATE.RENAME_CLIP,       // N15 — 'Rename highlight'
  PUBLISH_CLIP: 'Finish highlight',       // N12
  // PUBLISH_REEL survives the T11230 Reels-building removal: it is still the
  // publish label on the KEEP CollectionPlayer/published surface. T11280 (R2)
  // retires the "reel" noun in user-facing copy: "highlight" everywhere, "Reel"
  // reserved for T11300. Key name kept (internal identifier, out of scope).
  PUBLISH_REEL: 'Finish highlight',       // N12
  KEEP_ONLY_PLAYS: 'Keep only marked plays', // T12930
  RESTORE_FULL_VIDEO: 'Restore full video',  // T12930
};

// T8980: one-line short tab labels shown BELOW `sm`. T9530 (N10/N11) collapsed
// SECTION_NAMES onto these exact words at every breakpoint — the full labels no
// longer carry an "In Progress" prefix, so SECTION_NAMES and SECTION_NAMES_SHORT
// now render the SAME set (Games / Clips / Reels / Published). This constant is
// the single source the tab bar and EmptyTabGuide's partial-variant aria-label
// read from (T10280 deleted the flow strip that also read it); "Published"
// sitting next to "Reels" is what reads the middle two as in-progress, so status
// lives per item, never in the tab name.
export const SECTION_NAMES_SHORT = {
  GAMES: 'Games',
  CLIPS: 'Plays',
  // REELS removed by T11230 with the In Progress Reels tab (this constant's only
  // consumer was that tab button + EmptyTabGuide's reels partial variant, both gone).
  PUBLISHED: 'Highlights',
};

// T14600: Home tile menus, badges and group labels, single source (glossary:
// .claude/references/copy-glossary.md). Verbs: Edit highlight / Edit spotlight reopen
// a highlight; "Move to Highlights" files it under the Highlights tab. Counts say plays.
export const HOME_TILE = {
  EDIT_HIGHLIGHT: 'Edit highlight',
  EDIT_SPOTLIGHT: 'Edit spotlight',
  MOVE_TO_HIGHLIGHTS: 'Move to Highlights',
  moveToHighlightsHint: () => `Move to ${SECTION_NAMES.PUBLISHED}`,
  TAP_AGAIN_CONFIRM: 'Tap again to confirm',
  GAME_HIGHLIGHTS: 'Game highlights',
  UNTITLED_GAME: 'Untitled game',
  containsPlays: (n) => `Contains ${n} ${n === 1 ? 'play' : 'plays'}`,
  stalePlays: (n) => `${n} ${n === 1 ? 'play' : 'plays'} changed since this highlight was made`,
  staleHint: (n) => `${n} ${n === 1 ? 'play' : 'plays'} changed since this highlight was made. Sharpen it again to update it.`,
  HIGHLIGHTS_LOAD_ERROR: 'We couldn’t load your highlights. Try again.',
  OTHER_GROUP: 'Other plays',
  EARLIER_GROUP: 'Earlier highlights',
  EARLIER_NOTICE: 'You can still watch, download and share these, but they can no longer be edited.',
};

// T14600: the Mark plays overlay's per-play stage status, same words as the Home
// ladder (utils/draftStage.js): Not started / In progress / Finished.
export const NOTES_OVERLAY_STATUS = {
  IN_PROGRESS: 'In progress',
  FINISHED: 'Finished',
};

// T10280 (2026-09-17): UPLOAD_ENTRY_HINT (the T9640 one-line game-vs-clip
// distinction shown beneath each populated Games/Clips upload entry) was DELETED.
// The populated Games/Clips tabs now render the same centered EMPTY_TAB_GUIDE
// headline + body block (via TabGuideHeader) above their CTA, so the standalone
// hint caption is redundant. The game-vs-clip distinction now lives in the Clips
// tab's body copy ("A short clip can also skip straight to Framing, no game
// needed.") in config/emptyStates.js.

// Division of work shown near the start action (Upload game), so a first-time
// parent can tell their job (marking plays, framing their player) from the
// app's job (smooth motion, sharper picture, a highlight to share). T11880:
// picking the player from AI boxes is left out rather than misdescribed;
// Spotlight explains it in context. Do NOT claim autonomous framing/tracking here - Focus mode's crop is
// user-placed (FramingInstructions.jsx), and player "tracking" is the user
// clicking their kid on AI-proposed per-frame boxes (PlayerDetectionOverlay),
// not identity tracking. No em dashes (project-wide rule).
export const DIVISION_OF_WORK =
  'You mark the best plays and frame your athlete. We smooth the motion, sharpen the picture, and build a highlight you can share.';

export const CLIP_UPLOAD = {
  UPLOAD_CLIP: 'Upload a play',
  // T10300: uploads no longer come with a permanent "not linkable" consequence —
  // a directly-uploaded clip STARTS unlinked but can be linked to a game later
  // from the Clips tab (POST /api/clips/raw/{id}/link). The notice now states the
  // starting state and the recovery path instead of the old "won't be part of a
  // game" absolute. "Framing" is MODE_NAMES.FRAMING (a noun, never a verb); curly
  // apostrophes match this file's existing convention; no em dashes.
  NOTICE_TITLE: 'About uploaded plays',
  NOTICE_BODY: 'You can link the play to a game from the Plays tab.',
  // T13247: Add Clip takes a zip of clips (unzipped into loose videos, utils/zipClips.js).
  NOTICE_PICK: 'Pick videos or a zip of plays.',
  // Immediate confirmation when files are picked, before the first progress tick.
  uploadingToast: (n, name) => (n === 1 ? `Uploading ${name}...` : `Uploading ${n} plays...`),
  UPLOADING_BUTTON: 'Uploading...',
  NOTICE_CONTINUE: 'Continue',
  NOTICE_CANCEL: 'Cancel',
  // T10250: over-cap pre-flight dialog. The MB number is DERIVED from the
  // server-provided cap (configStore.maxClipUploadBytes) — there is no `500`
  // literal here; this sentence mirrors the backend refusal in
  // games_upload.py so the two never drift.
  SIZE_LIMIT_TITLE: 'This play is too large to upload',
  sizeLimitBody: (mb) =>
    `Play uploads are limited to ${mb}MB. For a longer video, use ${LIBRARY_ACTIONS.UPLOAD_GAME} instead.`,
  SIZE_LIMIT_ADD_GAME: `${LIBRARY_ACTIONS.UPLOAD_GAME} instead`,
  SIZE_LIMIT_CANCEL: 'Cancel',
  // T10310 (2026-09-18 user request): the SAME over-cap refusal, but caught only
  // AFTER an upload attempt (the pre-flight gate above is skipped while
  // maxClipUploadBytes hasn't hydrated yet — see ProjectManager's null guard), so
  // there is no File left in hand to auto-carry into Add Game. Surfaced as its own
  // popup (not just the inert rail row, which is easy to miss) with the concrete
  // click-path instead of an auto-action button.
  POST_UPLOAD_TOO_LARGE_TITLE: 'This play is too large for Plays',
  postUploadTooLargeBody: (mb) =>
    `Play uploads are limited to ${mb}MB. Tap Games, then tap ${LIBRARY_ACTIONS.UPLOAD_GAME} to add this as a full game instead.`,
  POST_UPLOAD_TOO_LARGE_DISMISS: 'Got it',
  // T10250: non-retryable server refusals surfaced verbatim on the rail (no
  // Retry). Keyed on the clip-batch error codes (clips.py upload_clips_batch);
  // `duration_exceeds_cap` is parameterized by the server duration cap
  // (configStore.maxClipDurationS) so, again, no minutes literal is hardcoded.
  refusalMessage: (code, { durationMinutes } = {}) => {
    switch (code) {
      case 'duration_exceeds_cap':
        return durationMinutes
          ? `This highlight is longer than the ${durationMinutes}-minute limit. For longer footage, use ${LIBRARY_ACTIONS.UPLOAD_GAME} instead.`
          : `This highlight is longer than the allowed limit. For longer footage, use ${LIBRARY_ACTIONS.UPLOAD_GAME} instead.`;
      case 'probe_failed':
        return "We couldn't read this video. Make sure it's a valid MP4, MOV, or WebM file.";
      case 'source_missing':
        return "We couldn't find the uploaded video. Please pick the file and add it again.";
      case 'insufficient_credits':
        return "You don't have enough credits to add this highlight.";
      default:
        return 'This highlight could not be added.';
    }
  },
};

// T10300: link/unlink an uploaded clip to a game (the recovery path promised by
// CLIP_UPLOAD.NOTICE_BODY). Only surfaced on tiles whose clip.source === 'upload'
// (a game-cut clip can never be relinked; the backend 409s it). Single source for
// the tile action labels + the game-picker modal copy. No em dashes; curly
// apostrophes match this file's convention.
export const CLIP_LINK = {
  LINK_TO_GAME: 'Link to game',       // tile action + picker title, unlinked highlight
  unlinkFrom: (name) => (name ? `Unlink from ${name}` : 'Unlink from game'),
  PICKER_TITLE: 'Link this highlight to a game',
  PICKER_SUBTITLE: 'It shows up with that game’s highlights.',
  PICKER_SEARCH_PLACEHOLDER: 'Search games',
  PICKER_EMPTY: 'You don’t have any games yet. Upload a game first, then link this highlight to it.',
  PICKER_NO_MATCH: 'No games match your search.',
  CANCEL: 'Cancel',
  // Success toasts confirm the re-grouping the user just triggered.
  linkedToast: (name) => (name ? `Highlight linked to ${name}` : 'Highlight linked to game'),
  UNLINKED_TOAST: 'Highlight unlinked from game',
  // 409: a non-upload highlight somehow reached the link endpoint. Should never
  // happen (the affordance is upload-gated), but surface it instead of swallowing it.
  ERROR_NOT_UPLOAD: 'Only uploaded highlights can be linked to a game.',
  ERROR_GENERIC: "Couldn't update this highlight's game. Please try again.",
  clipCount: (n) => `${n} highlight${n === 1 ? '' : 's'}`,
};

// T9430: honest upload-state vocabulary shown next to the local preview. The four
// states map from the real uploadManager phase machine (see utils/uploadPresentation
// .js), NOT engineering copy ("Computing hash" / "15%"). A visible local preview must
// never read as "saved online": LOCAL_PREVIEW_NOTICE labels it not-yet-persisted until
// the server acknowledges (COMPLETE, only after activate_game returns). N37's progress
// vocabulary ("Preparing video / Uploading / Rendering") is owned by T9540; these are
// this task's state labels, kept independent of that rename. Single source (T8555/T8380).
export const UPLOAD_STATE = {
  PREPARING: 'Preparing',
  UPLOADING: 'Uploading',
  SAVED: 'Uploaded',
  FAILED: 'Upload stopped',
  NOTICE_UPLOADING: 'Uploading your game. Keep this tab open.',
  NOTICE_PREPARING: 'Getting your game ready. Keep this tab open.',
  RETRY_UPLOAD: 'Retry upload',
};

// T11870: one sentence per upload phase (no percent in it: the bar owns the single
// percentage). The uploadManager `message` strings are for logs, resume text and error
// details only; users read these. Phase -> sentence map lives in utils/uploadPresentation.js.
export const UPLOAD_PROGRESS_COPY = {
  PREPARING: 'Getting your game ready to upload',
  UPLOADING: 'Uploading your game',
  FINALIZING: 'Finishing up',
  ALREADY_UPLOADED: 'Already uploaded, finishing up',
  ALREADY_UPLOADING: 'Already uploading...',
  COMPLETE: 'Your game is uploaded.',
  VIDEO_ADDED: 'Your video is added.',
  VIDEOS_ADDED: 'Your videos are added.',
  ERROR: 'Upload stopped.',
  KEEP_TAB_OPEN: 'Keep this tab open until it finishes.',
  CAN_MARK_PLAYS: 'You can start marking plays.',
};

// T9540 (Shared Vocabulary epic, N19-N21/N37): render-action / job / progress /
// completion vocabulary, single source. Keyed on the export `type` ('framing' |
// 'overlay') the store + WS payload already carry, so the button, the job list, the
// toast and the completion message never disagree about the stage (one object, one
// stage). Mode names (MODE_NAMES.FRAMING / MODE_NAMES.SPOTLIGHT) are deliberately NOT
// here -- a mode names a PLACE you edit, a job names a THING YOU DO. The post-export
// action-bar labels (FOCUS_PUBLISH / OVERLAY_PUBLISH below) are T9590 territory,
// untouched here.
//
// T14620 (glossary): the paid step inside Frame is "Sharpen my highlight", and it never
// shares a label with "Make highlight", which only OPENS Frame. Completion is exactly
// "Your highlight is ready". The free spotlight job is not the paid step, so it never
// says sharpen.
export const EXPORT_JOBS = {
  framing: {
    action: 'Sharpen my highlight',
    inProgress: 'Sharpening your highlight...',
    completed: 'Your highlight is ready',
    jobNoun: 'Highlight',
  },
  overlay: {
    action: 'Add spotlight to highlight',
    inProgress: 'Adding spotlight to highlight...',
    completed: 'Highlight with spotlight ready',
    jobNoun: 'Highlight with spotlight',
    // Q1 (approved): the effects render charges ZERO credits (backend-confirmed: no
    // reserve_credits in overlay.py). Surface that honestly instead of staying silent.
    costNote: 'Effects are free, no credits needed',
  },
};

// N37 — export PROGRESS vocabulary. Honest user copy that replaces engineering strings
// ("Detecting players", "frame 150/180", "Processing frames..."). Mapped from the backend
// `phase` (see utils/exportProgressPresentation.js); counters stay as OPTIONAL detail.
export const EXPORT_PROGRESS = {
  PREPARING: 'Getting your video ready',       // init/queued/validating/downloading/starting
  QUEUED: 'Waiting in line, other videos are being made', // gpu_queued (T14100: all GPUs busy)
  UPLOADING: 'Finishing up',                   // upload + detecting_players (T12120: runs at 92% of every export)
  RENDERING: 'Sharpening your highlight...',   // processing/modal_processing/rendering/analyzing
  RENDERING_SPOTLIGHT: 'Adding your spotlight', // processing, overlay job
  ENHANCING: 'Sharpening the picture',         // upscaling/ai_upscale (matches DIVISION_OF_WORK)
  READY: 'Your highlight is ready',            // the job finished
  // T14620: reconnect states shared by the paid step and the free spotlight job, so no verb.
  STILL_RUNNING: 'Still working on your highlight...',
  // T9900: honest "unavailable estimate" fallback — shown instead of a blank slot or a
  // frozen/fabricated countdown when no live ETA is trustworthy (too little data yet, or
  // the estimate broke its own promise). The real stage line still shows alongside it.
  ETA_VARIES: 'Time remaining varies.',
};

// T11330: the explanatory popup shown when the T11320 preflight cost guard rejects an
// export as too large (WS error frame, code === 'export_too_large'). Bug 58p's user
// retried the identical over-budget export four times over 13 hours with no idea what to
// change; a bare "Export failed" toast is not enough — this names the WHY and the concrete
// levers (crop in on the worst clips, split the batch) plus the honest credit outcome.
// Numbers are DERIVED from the guard payload (estimated_gpu_seconds / biggest_contributors);
// there are no magic thresholds here. Credit copy matches T11330 Step 4 decision (a): the
// guard rejects inside the background task AFTER credits were reserved+confirmed at dispatch,
// so the same handler refunds them — the net cost is zero, stated honestly as "refunded".
export const EXPORT_TOO_LARGE = {
  TITLE: 'This highlight is too big to sharpen in time',
  WHY:
    'Every frame gets sharpened, and this one needs more time than a single job can run. '
    + 'Rather than run for the full limit and then fail, we stopped it now so you can trim it down.',
  WHAT_TO_DO_HEADING: 'To get it through, try one of these:',
  SUGGESTION_CROP: 'Use a tighter box on the highlights below. A smaller box is much faster to sharpen.',
  // Shown only for a multi-clip rejection (>1 contributing clip); it isn't actionable for a
  // single clip (the /render path also hits this guard with a one-element list, T11330 minor 2).
  SUGGESTION_SPLIT: 'Sharpen fewer highlights at once.',
  CONTRIBUTORS_HEADING: 'Biggest contributors',
  // A single worst-offender row: "Highlight 3, 1920x1080 crop, about 6 min".
  contributorLine: (c) => {
    const label = c.clip_name || `Highlight ${(c.clip_index ?? 0) + 1}`;
    const crop = c.crop_width && c.crop_height ? `${c.crop_width}x${c.crop_height} box, ` : '';
    return `${label}, ${crop}${formatApproxMinutes(c.estimated_gpu_seconds)}`;
  },
  CREDIT_NOTE: 'The credits for this highlight were refunded. This attempt cost you nothing.',
  DISMISS: 'Got it',
};

// Human "about N minutes" from a GPU-seconds estimate (guard payload). Never a bare second
// count — the user thinks in minutes of waiting. Under a minute reads "under a minute".
export function formatApproxMinutes(gpuSeconds) {
  if (!gpuSeconds || gpuSeconds <= 0) return 'unknown time';
  if (gpuSeconds < 60) return 'under a minute';
  const minutes = Math.round(gpuSeconds / 60);
  return minutes === 1 ? 'about 1 min' : `about ${minutes} min`;
}

// T8390 / re-hierarchized T9590 / T10670 celebration tiles: Focus's post-export
// completion action bar (FocusPublishActionBar). T9590 (2026-09-10) established the
// three-level hierarchy + a quiet exit; T10670 (2026-09-19, approved V2 design)
// turned each choice into an icon-forward TILE that IS the button, added a HEADLINE
// row with a one-word "Saved" chip in place of the green
// retention sentence, and renamed the exit link to "Done for now" (no caption --
// SAVE_DRAFT_CAPTION was deleted; only the two bars + their tests read it):
//   PRIMARY   Add spotlight             (dominant; opens the Spotlight editor, no export)
//   SECONDARY Publish without spotlight (publishes the framed reel as-is)
//   TERTIARY  Edit framing              (back into Framing; the paid re-export path)
//   QUIET     Done for now              (leave the flow; the landing toast names Clips/Reels)
// Captions state each destination + the honest cost/audience BEFORE the click
// (T9590 acceptance). PUBLISH_CAPTION's audience wording is verified against the
// real endpoints (downloads.py publish -> moves the reel to the owner's own
// Published tab; shares.py -> a share link is a SEPARATE gesture). T9670 §4,
// live-verified by T9710 (2026-09-13): publishing sets published_at and moves the
// reel to Published, and creates no link and grants no audience by itself --
// sharing a link is a second, separate gesture. PUBLISH_CAPTION states the
// destination and that precondition instead of the "anyone with the link" claim,
// which was false as a consequence of publishing alone (T9860 D5).
// EDIT_FRAMING_CAPTION keeps the honest "uses credits" re-export warning.
// T10670: SPOTLIGHT_CAPTION stops aliasing STAGE_REASONS.SPOTLIGHT (the 22-kids
// sentence stays the Spotlight-mode reason line; it is too long for a tile caption)
// and HEADLINE is a new completion title; EXPORT_JOBS.framing.completed
// stays the toast/job-row string. No em dashes anywhere.
// T11810: one caption pair shared by the Focus and Overlay ready screens.
const FINISH_CAPTION = 'Moves it to Highlights. Only you can see it until you share a link.';
const EDIT_FRAMING_CAPTION_TEXT = 'Change the framing and sharpen it again. Uses credits.';
export const FOCUS_PUBLISH = {
  HEADLINE: 'Your highlight is ready',
  ADD_SPOTLIGHT_LABEL: 'Add spotlight',
  SPOTLIGHT_CAPTION: 'Show everyone watching which athlete is yours.',
  PUBLISH_LABEL: 'Finish without spotlight',
  PUBLISH_CAPTION: FINISH_CAPTION,
  EDIT_FRAMING_LABEL: 'Edit framing',
  EDIT_FRAMING_CAPTION: EDIT_FRAMING_CAPTION_TEXT,
  SAVE_DRAFT_LABEL: 'Done for now',
};

// T10650: Focus's "Back to preview" affordance. When the current framing is
// already rendered, the primary CTA reopens that render instead of paying to
// re-render byte-identical framing (mode 'preview'); once framing changes, the
// same label survives as a secondary ghost link beside "Generate Framing" so the
// previous render stays reachable. No em dashes in this copy.
export const FOCUS_PREVIEW = {
  BACK_TO_PREVIEW_LABEL: 'Watch highlight',
  // T11970: CTA label between the framing job completing and the completion panel opening.
  OPENING_LABEL: 'Opening your highlight...',
  NO_CREDITS_NOTE: 'No credits needed',
  // Prefixes a finished-at timestamp in the left status cell, e.g. "Sharpened 3:14 PM".
  RENDERED_PREFIX: 'Sharpened',
  // Shown (loud, never a silent re-render) when the working-video URL cannot resolve.
  LOAD_FAILED: "We couldn't load your highlight. Try again.",
};

// T14620: Frame screen strings that used to sit inline in the components.
export const FRAME_COPY = {
  LENGTH_CHANGED: 'Length of your highlight. Credits are based on this.',
  LENGTH_UNCHANGED: 'Length of your highlight (no slow motion or trim).',
  LENGTH_LABEL: 'Length',
  lengthChip: (clock) => `Length ${clock}`,
  LOADING_VIDEO: 'Loading video...',
  LOADING_PLAYS: 'Loading your plays...',
  LOADING: 'Loading...',
  VIDEO_ERROR_TITLE: "We couldn't load this video",
  MOVE_VIDEO: 'Move the video',
  MOVE_BOX: 'Move the box',
  BOX_HELP: "Drag the box onto your athlete. Drag the corners to resize it. Only what's inside the box is kept.",
  BOX_TOO_TIGHT: 'This box is very tight, so the sharpened video may look softer. Try a slightly wider box.',
  BOX_TOO_TIGHT_SHORT: 'Box is very tight',
  VIDEO_TRACK_HINT: 'Video track. Tap anywhere to move through the highlight. Press Space to play or pause.',
  BOX_TRACK_HINT: 'Frame timeline. Tap to add a position. Drag the box on the video to keep your athlete in view.',
  SECTION_TRACK_HINT: 'Trim and slow motion. Tap a section to change its speed. Drag the ends to trim the highlight.',
  SPLIT_HINT: 'Split the highlight to trim it or slow it down.',
  sectionTitle: (n, detail) => `Section ${n}: ${detail}`,
  slowMotionSpeed: (speed) => `${speed}x slow motion`,
  NORMAL_SPEED: 'Normal speed',
  SETTINGS_TITLE: 'Video',
  TRIM_SECTION: 'Trim section',
  SPLIT_AT: (seconds) => `Split at ${seconds}s`,
  DELETE_SPLIT: 'Delete split',
  positionAt: (seconds) => `Position at ${seconds}s`,
  AUDIO_HINT: "Include the highlight's original audio",
  CREDIT_SHORT_NOTE: '. Add credits to sharpen it.',
  highFpsNote: (fps) => `Recorded at ${fps}fps. Your highlight is 30fps for a smaller file that costs less.`,
  EDITS_NOT_THROUGH: "Some edits didn't go through. Tap Retry, then try again.",
  CROP_TIP: 'Move or resize the box to add a position.',
  TILE_SHARPENING: 'Sharpening',
  TILE_ADDING_SPOTLIGHT: 'Adding spotlight',
  STRIP_DONE: 'Done',
  STRIP_OFFLINE: 'Not connected',
  STRIP_SHARPENING: 'Sharpening...',
  STRIP_ADDING_SPOTLIGHT: 'Adding spotlight...',
  STRIP_STARTED_FRAME: 'Started. Sharpen it to finish.',
  STRIP_STARTED_SPOTLIGHT: 'Started. Add the spotlight to finish.',
};

// T10840: the landscape-phone "cockpit" layout — edge-rail labels, sheet titles,
// and the two rotation hints (D14). Kept here so the parent-facing copy is
// single-sourced, matching the rest of the editor vocabulary.
export const FOCUS_COCKPIT = {
  // Zone A / D rail button labels (10px, under a Lucide icon).
  BACK: 'Back',
  SETUP: 'Settings',
  PREVIEW: 'Check zoom',
  // Compact CTA, two 10px lines (D9 / D13).
  GENERATE_LINE_1: 'Sharpen my',
  GENERATE_LINE_2: 'highlight',
  BACK_TO_PREVIEW_LINE_1: 'Watch',
  BACK_TO_PREVIEW_LINE_2: 'highlight',
  // T11970: finished render is being opened (replaces Generate until the panel opens).
  OPENING_LINE_1: 'Opening',
  OPENING_LINE_2: 'highlight',
  // Zone E sheet titles.
  SHEET_SETUP: 'Settings',
  SHEET_TRIM: 'Trim and slow motion',
  CLOSE_SHEET: 'Close',
  // Timeline strip caps (D10).
  ADD_FOCUS_POINT: 'Add position',
  OPEN_TRIM: 'Trim and slow-mo',
};

// T12230: the ONE copy table for the on-screen guide (T9550 single-source rule).
// resolveGuide.js picks a rule; every sentence it can show lives here. Plain
// words: the draggable rectangle is the 'box', the child is 'your athlete'
// (Q15 = C), no em dashes, no motion claims the app does not make.
export const GUIDE = {
  annotate: {
    watch: { title: 'Tap Play to watch the game. When your athlete does something great, tap Mark play.', body: '' },
    watchPlaying: { title: 'See a great play? Tap Mark play.', body: '' },
    hasPlaysOne: { title: 'You’ve marked 1 play. Keep going, or tap a play to make it a highlight.', body: '' },
    hasPlaysMany: { title: 'You’ve marked {n} plays. Keep going, or tap a play to make it a highlight.', body: '' },
    editor: { title: 'Drag the green ends so the play starts and stops where you want. Tap Play to confirm you have the full play. Rate the play and optionally add tags and notes, then tap Done.', body: '' },
    choice: { title: 'Play added. Tap Make highlight to turn it into a video you can share, or keep marking plays.', body: '' },
    // T14770: Edit play now comes first on screen, so the sentence names it first too.
    selectedNone: { title: 'You can edit this play or make a highlight from it.', body: 'Tap Edit play to fix its timing, rating or tags, or Make highlight to turn it into a video you can share.' },
    hasHighlightsOne: { title: 'This play has 1 highlight.', body: 'Tap it to pick up where you left off, or Make highlight for another.' },
    hasHighlightsMany: { title: 'This play has {n} highlights.', body: 'Tap one to pick up where you left off, or Make highlight for another.' },
    brilliant: { title: 'Brilliant play. Make a highlight to share it.', body: 'Tap Make highlight and keep your athlete in the picture. Edit play is there if the timing is off.' },
    portrait: { title: 'Continue your portrait highlight.', body: 'Finish your zoom on your athlete, then add a spotlight if you want.' },
    generating: { title: 'Your highlight is being sharpened. It will be ready soon.', body: '' },
    spotlight: { title: 'Your highlight is ready. Tap it to add a spotlight or finish it.', body: '' },
    preview: { title: 'Your portrait highlight is ready.', body: 'Watch it to check the finished result.' },
    published: { title: 'Your highlight is finished.', body: 'Open it to watch or share it, or mark another play to make your next one.' },
    review: { title: 'Your plays, back to back. Tap Share game to send the game and your plays to family or coaches.', body: '' },
    expired: { title: 'This game’s video has expired. Upload it again to mark more plays.', body: '' },
    // The game is still uploading: highlights can't be made from it yet, so never steer there.
    uploadingSelected: { title: 'Highlights unlock once your game finishes uploading. Keep marking plays until then.', body: '' },
    uploadingPlays: { title: 'Keep marking plays. Highlights unlock once your game finishes uploading.', body: '' },
    // T13390: the upload failed; the banner above the player has the only way forward.
    uploadFailed: { title: 'Your game didn’t finish uploading. Tap Retry upload to try again.', body: '' },
  },
  // T12250: Home tabs and the Upload modal. Each value is { title, body }.
  home: {
    gamesEmpty: { title: 'Start with your game video. Tap Upload game.', body: '' },
    gamesUploading: { title: 'Your game is uploading. Open it now to start marking plays.', body: '' },
    gamesError: { title: 'Your games didn’t load. Tap Retry.', body: '' },
    gamesNoPlays: { title: 'Open your game to find the plays worth keeping.', body: '' },
    gamesPlays: { title: 'Open your game and turn your best play into a highlight.', body: '' },
    gamesFinished: { title: 'Your highlight is ready to share. Open Highlights.', body: '' },
    gamesKeepReviewing: { title: 'You haven’t watched all of your game yet. Open your game to keep looking for plays.', body: '' },
    gamesAllDone: { title: 'Congrats, you’ve reviewed your whole game and finished every highlight. Tap Upload game to start your next one.', body: '' },
    clipsEmpty: { title: 'Plays you’re turning into highlights wait here. Open a game in Games to start one.', body: '' },
    clipsUnfinished: { title: 'Pick up where you left off. Tap a play to make its highlight.', body: '' },
    clipsAllDone: { title: 'Every play is finished. Open a game to mark more plays.', body: '' },
    finishedFirst: { title: 'Your highlight is ready. Tap it to share it or download it.', body: '' },
    finishedMany: { title: 'You have {n} highlights. Tap one to share it or download it, or open a game to mark another play.', body: '' },
    finishedEmpty: { title: 'Your highlights show here. Open a game to make your first one.', body: '' },
  },
  upload: {
    choose: { title: 'Pick your game video. Name and details are optional.', body: '' },
    submit: { title: 'Tap Upload game. You can start marking plays while it uploads.', body: '' },
    failed: { title: 'That upload didn’t finish. Tap Retry to try again.', body: '' },
  },
  focus: {
    // T14770: step 1 of 6 — the shape choice shows before the box drag step.
    shareWhere: 'Where will you share it? Portrait for Instagram and TikTok, landscape for YouTube and coaches.',
    drag: 'Drag the box onto your athlete. Your highlight shows what’s inside it.',
    dragPrePlaced: 'The box is already on your athlete. Drag it if it isn’t, then tap Play.',
    play: 'Tap Play and watch your athlete.',
    keep: 'If your athlete leaves the box, pause and drag it back. The view moves smoothly between the positions you set.',
    preview: 'Tap Check zoom to see exactly what you’ll share.',
    watchPreview: 'Watch it through. Tap Back to full video to change anything.',
    generate: `Looks right? Tap ${EXPORT_JOBS.framing.action}.`,
    experienced: `You know the basics. Set the box on your athlete, then open Trim and slow motion to cut dead time, or tap Check zoom when it looks right.`,
    generateAdvanced: `Looks right? Tap ${EXPORT_JOBS.framing.action}, or open Trim and slow motion first to cut dead time.`,
    credits: `You need more credits for this highlight. Tap ${EXPORT_JOBS.framing.action} to add them, then sharpen it.`,
    progressExport: 'Sharpening your highlight. You can wait here or go mark more plays. We’ll tell you when it’s ready.',
    finishing: 'Your highlight is done. Opening it now.',
    failed: `Your highlight didn’t finish. Tap ${EXPORT_JOBS.framing.action} to try again.`,
    ready: 'Your highlight is ready. Add a spotlight so people know which athlete is yours, or tap Finish without spotlight.',
    trimSplit: 'Tap the timeline to split your play where you want to trim or slow it.',
    trimAdjust: 'Tap 0.5x to slow a section, or the trash can to trim an end.',
    // T12790: video load failure, fullscreen hand-off, and the landscape cockpit's own controls.
    videoErrorRetry: 'This video didn’t load. Tap Retry Loading Video.',
    videoError: 'This video didn’t load. Go back and open this play again.',
    leaveFullscreen: 'Exit fullscreen to check your zoom and sharpen your highlight.',
    leaveFullscreenJob: 'Exit fullscreen to see your highlight’s status and what to do next.',
    cockpitPreview: 'Tap Check zoom to see exactly what you’ll share.',
    cockpitWatchPreview: 'Watch it through. Tap Check zoom again to change anything.',
  },
  finished: {
    viewer: `Done! Tap ${RESULT_PUBLISH.PUBLISH_GET_LINK} to send it, or Download to save it.`,
    done: 'Keep going: upload videos, mark plays and make highlights. Turn guidance off for now. You can always turn it back on if you get confused.',
    doneCta: 'Turn off guidance for now',
  },
  share: {
    modal: 'Choose who can watch, then tap Share.',
  },
  overlay: {
    progress: 'Adding your spotlight. We’ll show you when it’s ready.',
    failed: `Your spotlight didn’t finish. Tap ${EXPORT_JOBS.overlay.action} to try again.`,
    ready: 'Looks good? Tap Finish, then Share to get a link.',
    // T12280/T12360: spotlight pick walk. THE copy for every pick state: SpotlightPickGuide and
    // EDITOR_PANELS.PICK_GUIDE_* read these, never a second string. {k}/{n} are filled by resolveGuide.
    // The step label ("Tap k of n") is formatted once, in EDITOR_PANELS.PICK_GUIDE_STEP.
    pick: {
      first: { title: 'Tap your athlete', body: 'Tap your athlete each time we stop so the spotlight lands on them.' },
      next: { title: 'Got it', body: '' },
      atMarker: { title: 'Tap your athlete', body: 'Tap your athlete again here.' },
      away: { title: '{k} of {n} still needs a tap', compactTitle: '{k} still needs a tap', body: '' },
      notOutlined: { title: "Don't see your athlete outlined? Drag the circle onto them.", body: '' },
      none: { title: 'Drag the circle onto your athlete.', body: '' },
      done: { title: 'Spotlight set.', body: `Tap ${EXPORT_JOBS.overlay.action}. Tap Play first if you want to check it.` },
    },
    text: 'Type a name, number or caption, then drag its ends on the timeline to set when it shows.',
  },
  // T12790: one sentence for every dialog a user can open. resolveGuide's `modal.*` rules pick these.
  modal: {
    attachVideoChoose: 'Choose the video file with the rest of this game.',
    attachVideoSubmit: 'Tap Add video to add it to this game.',
    clipUploadNotice: 'Tap Continue to pick your videos.',
    clipUploadTooLarge: 'Some highlights were too large to upload. Tap Got it, then upload a smaller file or add the whole game.',
    clipSizeLimit: `This file is too large for a highlight. Tap ${LIBRARY_ACTIONS.UPLOAD_GAME} instead to upload it as a game.`,
    editGame: 'Change what you need, then tap Save Changes.',
    linkClip: 'Tap the game this highlight came from.',
    linkClipEmpty: 'You have no games to link to yet. Add a game first, then link this highlight.',
    shareGame: 'Add people or copy the link, then tap Share.',
    collectionShare: 'Add people, then tap Share.',
    collectionShareDone: 'Shared. Tap Done.',
    teammates: 'Pick who gets each tagged play, then tap Share.',
    teammatesDone: 'Every tagged play is already shared. Tap Close.',
    sharePlayback: 'Add people, then tap Share to send them these plays.',
    sharePlaybackError: 'These plays can’t be shared right now. Tap Close.',
    sharedVideo: 'Someone shared this highlight with you. It plays right here.',
    sharedVideoSignIn: 'Sign in to watch this highlight. Tap Sign in.',
    sharedVideoError: 'This link didn’t open. Ask the person who sent it for a new one.',
    buyCreditsPick: 'Tap a credit pack to buy it.',
    buyCreditsPay: 'Enter your card, then tap Pay.',
    insufficientCredits: 'You need more credits for this. Tap Buy credits.',
    creditHistory: 'Every credit you added or spent is listed here.',
    paymentSuccess: 'Your credits are added. Tap OK.',
    paymentFailed: 'The payment didn’t go through. Tap OK, then try again.',
    storageExtension: 'Tap Extend storage to keep this game longer.',
    exportTooLarge: 'This highlight is too big to sharpen. Tap Got it, then use a tighter box or shorten it.',
    tutorialVideo: 'Watch the video, then close it and try it yourself.',
    profilesList: 'Tap a profile to switch to it, or tap + Add profile for another athlete.',
    profileAdd: 'Fill in your athlete’s details, then tap Create.',
    profileEdit: 'Change your athlete’s details, then tap Save.',
    moveProfilePick: 'Tap the athlete profile to move this to.',
    moveProfileConfirm: 'Tap Move highlight to confirm.',
  },
};

// Guided framing steps: the Focus screen shows ONE instruction at a time. Drag the
// box onto the player, play the video, then keep the box on the player. Pressing
// Trim and slow motion swaps in the two trim instructions. Parent-facing vocabulary, no
// em dashes, and the only motion claim is the one the user causes by placing the
// box themselves (no track/follow/center claim).
export const FRAMING_GUIDE = {
  STEP_DRAG: GUIDE.focus.drag,
  STEP_PLAY: GUIDE.focus.play,
  STEP_KEEP: GUIDE.focus.keep,
  STEP_PREVIEW: GUIDE.focus.preview,
  WATCH_PREVIEW: GUIDE.focus.watchPreview,
  STEP_GENERATE: GUIDE.focus.generate,
  TRIM_SPLIT: GUIDE.focus.trimSplit,
  TRIM_ADJUST: GUIDE.focus.trimAdjust,
  STEP_LABEL: (step, total) => `Step ${step} of ${total}`,
  TRIM_BUTTON: 'Trim and slow motion',
  LOCKED_TITLE: 'Finish the steps above to unlock',
};

// T10850 (design D14): the two discovery hints that bracket the landscape flip.
// Copy lives here (T9550 single-source rule), parent-facing vocabulary: "position",
// never "keyframe". The icons are Lucide, inline, aria-hidden.
export const FOCUS_HINTS = {
  // Portrait nudge — a slim bar directly under the stage, shown while the clip
  // still has no focus points. Dismissed by its 44px X (a named gesture).
  // T11700/T11710: rephrased so rotating reads as optional, not required.
  ROTATE_TITLE: 'Optional: rotate your phone for a larger video',
  // T11710 merge-order note (now resolved): held at the old value until T11740
  // (which removes the portrait horizontal overflow) merged -- it has, so
  // "nothing scrolls" is honest and the subtitle switches here.
  ROTATE_SUBTITLE: 'Everything here also works upright',
  ROTATE_DISMISS: 'Dismiss',
  // T11710: coaching copy for the 0-focus-point state. GENERATE_LOCKED is the
  // visible disabled-Generate caption; COACH_DRAG is the chip pinned over the
  // video; TIMELINE_EMPTY is the empty crop-timeline hint. All name the drag
  // gesture and "your player"; the only motion claim allowed is "moves smoothly
  // between the focus points you set" (lives in FRAMING_INSTRUCTIONS).
  // T14830: Generate unlocks on the drag alone (pressing Play is coach advice,
  // not a lock), so the caption names only the drag gesture.
  GENERATE_LOCKED: 'Drag the box onto your athlete to unlock',
  COACH_DRAG: 'Drag the box onto your athlete',
  TIMELINE_EMPTY: 'No positions yet. Drag the box on the video to add one.',
  // T11720: the phone-only compact locked band (one ~52px row while Generate is
  // still locked). GENERATE_LOCKED_SHORT is the amber left-side copy; the right
  // pill echoes the Generate verb in its disabled state.
  GENERATE_LOCKED_SHORT: 'Drag the box to unlock',
  GENERATE_LOCKED_CTA: 'Sharpen',
  // Landscape first-entry card — shown once, over the stage, on the first
  // cockpit entry. Dismissed by "Got it" or the first touch on the stage.
  COCKPIT_INTRO_TITLE: 'More room in landscape',
  COCKPIT_INTRO_BODY: 'Playback is on the left now, Sharpen my highlight on the right.',
  COCKPIT_INTRO_CONFIRM: 'Got it',
};

// T8390: "Add Spotlight Later" toast copy. Was routed by is_auto_created (T8360
// split) to a SINGLE_CLIP vs MULTI_CLIP variant; T11230 removed the MULTI_CLIP
// variant with the Reels building surfaces, so every draft (including legacy
// multi-clip drafts, which now live in the Clips tab's Legacy reels group) uses
// this one copy. Callers reference SINGLE_CLIP directly, no branch.
export const FOCUS_PUBLISH_LATER_TOAST = {
  SINGLE_CLIP: {
    title: 'Added to Plays',
    message: 'Your highlight isn’t finished yet. Add a spotlight or finish it any time.',
  },
};

// T11800: the consume-once banner Annotate shows after "Done for now" (replaces the old
// "publish it from here" toast, which read as if the work had disappeared).
export const FRAMED_BANNER = {
  title: (playName) => `${playName} is framed`,
  body: "It's in Plays. Add a spotlight or finish it any time.",
  ADD_SPOTLIGHT_LABEL: 'Add spotlight',
  VIEW_IN_CLIPS_LABEL: 'View in Plays',
  DISMISS_LABEL: 'Dismiss',
};

// 2026-09-08: "Add Spotlight Now" confirmation toast (product owner: every
// FocusPublishActionBar choice should confirm what happened + what's next,
// same as the existing Add Spotlight Later toast above). Short, since the
// user isn't leaving the flow -- they land straight in Overlay right after.
export const FOCUS_ADD_SPOTLIGHT_TOAST = {
  title: EXPORT_JOBS.framing.completed,
  message: 'Now add a spotlight to your highlight. You can still finish it whenever you\'re ready.',
};


// T9110 / re-hierarchized T9590 / T10670 celebration tiles: Overlay's post-export
// completion action bar (OverlayPublishActionBar). T9590 re-hierarchized IN LOCKSTEP
// with FOCUS_PUBLISH above; T10670 (2026-09-19, approved V2 design) mirrors Focus's
// tile treatment here (icon-forward tiles, headline + "Saved" chip, "Done for now"
// exit, SAVE_DRAFT_CAPTION deleted). On THIS screen the spotlight is already applied,
// so the promoted forward action is Publish (Focus promotes "Add spotlight" instead
// -- the hierarchy tracks pipeline position, not a fixed action):
//   PRIMARY   Publish           (dominant; the reel is finished)
//   SECONDARY Reapply spotlight (back into Spotlight editing)
//   TERTIARY  Reapply Framing   (reframe; the paid re-export path)
//   QUIET     Done for now      (leave the flow; the landing toast names Clips/Reels)
// PUBLISH_CAPTION states the destination + the honest precondition BEFORE the tap.
// T9670 §4, live-verified by T9710 (2026-09-13): publishing moves the reel to
// Published and creates no link and grants no audience by itself -- sharing a
// link is a second, separate gesture (T9860 D5). REAPPLY_FOCUS_CAPTION keeps the
// honest "uses credits" warning, verbatim with Focus's so the two read as one
// system.
export const OVERLAY_PUBLISH = {
  HEADLINE: 'Your highlight is ready',
  PUBLISH_LABEL: 'Finish',
  PUBLISH_CAPTION: FINISH_CAPTION,
  REAPPLY_OVERLAY_LABEL: 'Redo spotlight',
  REAPPLY_OVERLAY_CAPTION: 'Go back and change the spotlight.',
  REAPPLY_FOCUS_LABEL: 'Edit framing',
  REAPPLY_FOCUS_CAPTION: EDIT_FRAMING_CAPTION_TEXT,
  SAVE_DRAFT_LABEL: 'Done for now',
};

// T9110: "Reapply Framing" confirmation toast. Mirrors FOCUS_ADD_SPOTLIGHT_TOAST's
// reasoning (product owner, 2026-09-08): a choice that moves the user into
// ANOTHER edit mode has no other confirmation their prior work was saved, so it
// gets a toast. Honest that the spotlight carries over the Framing re-export
// (highlight carry-forward, T4350/T4355) and that a fresh export follows.
export const OVERLAY_REAPPLY_FOCUS_TOAST = {
  title: 'Spotlight kept',
  message: `Change your framing in ${MODE_NAMES.FRAMING}, then sharpen it again. Your spotlight carries over to the new highlight.`,
};

// T9550 (Shared Vocabulary epic, N16-N32): the editor-stage IN-PANEL vocabulary,
// single source. These name the CONTROLS you tune once inside Framing / Spotlight
// -- the focus point, the styling sliders, the cover image. Deliberately NOT here:
// the mode NAMES (MODE_NAMES.FRAMING / MODE_NAMES.SPOTLIGHT, editorStore SCREENS --
// unchanged) and the render-action strings (EXPORT_JOBS, T9540) -- a mode names a
// PLACE you edit, a job names a THING YOU DO, and this block names the controls in
// between. One noun per primitive so T9610/T9620's instructional copy reuses these
// exact words.
//
// T9860 (reversed 2026-09-14, reversing T9550's 2026-09-11 comment here): "athlete"
// is back. The two words name different things, so both stay, each locked to a
// grammatical number: "athlete" = your kid, the subject. Always possessive or
// singular: "your athlete", "My athlete". "player" = anyone on the field, or a
// detection count. Always generic or plural: "22 players detected", "Finding
// players". "keyframe" is intentionally absent as a primary label: it survives
// only as advanced help in component tooltips (FocusTimeline), per the task's
// "demote, don't ban" rule.
// T14630: Spotlight and Frame dim the same way, so both controls say the same thing.
const DIM_OUTSIDE = 'Dim outside';

export const EDITOR_PANELS = {
  // N17 -- the crop primitive is a "focus point"; its timeline track is the
  // "Framing timeline". "crop keyframe" stays only in advanced help/tooltips.
  FOCUS_POINT: 'Position',
  FRAMING_TIMELINE: 'Frame timeline',
  // N29 -- spotlight styling. "Highlight Color" mixed brand + generic for one thing:
  // the spotlight. The shape options say WHERE the spotlight sits vs the player.
  SPOTLIGHT_COLOR: 'Spotlight color',
  // T11020 -- full-spectrum custom picker + eyedropper, alongside the 5 presets.
  SPOTLIGHT_CUSTOM_COLOR: 'Custom color',
  SPOTLIGHT_MATCH_UNIFORM: 'Match color from uniform',
  SPOTLIGHT_AROUND_PLAYER: 'Around athlete', // was "Body" / "Body ellipse"
  SPOTLIGHT_UNDER_PLAYER: 'Under athlete',   // was "Ground" / "Ground spotlight"
  // N30 -- styling sliders in plain words; the component keeps the live px/% readout.
  OUTLINE_THICKNESS: 'Outline thickness',   // was "Stroke Width"
  SPOTLIGHT_FILL: 'Spotlight fill',         // was "Fill"
  DIM_BACKGROUND: DIM_OUTSIDE,               // T14630: one phrase with Frame's DARKEN_OUTSIDE
  // N31 -- the share still is a "Cover image"; the timeline marker CHOOSES its frame.
  COVER_IMAGE: 'Cover',                      // was "Thumbnail"
  CHOOSE_COVER_FRAME: 'Pick cover',         // was "Thumbnail marker"
  COVER_IMAGE_HELPER: 'What people see before they press play.',
  // T9620 (UX-10) -- the spotlight editor leads with PICKING YOUR PLAYER, not the
  // styling controls. These name that primary task (stated on screen, never a
  // tooltip) and gate the styling copy behind it. The word "player" keeps the
  // detection COUNTS unmistakable as counts, not jersey identities.
  // T11570: SELECT_PLAYER_TAP/FIND are RETIRED (zero callers) -- the guided
  // walk auto-navigates to each marker itself (PICK_GUIDE_TAP/CLICK below), so
  // there's no "find a marker yourself" or boxes-not-visible-yet copy anymore.
  // SELECT_PLAYER_CLICK survives for the pre-selection panel body (T14630: reads "Tap").
  SELECT_PLAYER_TITLE: 'Pick your athlete',
  SELECT_PLAYER_CLICK: 'Tap your athlete to add a spotlight',
  SELECT_PLAYER_STYLING_HINT: 'Spotlight color, shape and dimming appear once you pick your athlete.',
  // T9960 (EP05) -- SELECT_PLAYER_OPTIONAL reassures (pre-selection) that Spotlight
  // never blocks reaching the framed result. SELECT_PLAYER_DONE/ADD_MORE (the old
  // single-pick "done" copy) are RETIRED by T11570's guided walk below -- the panel's
  // step checklist replaces them.
  SELECT_PLAYER_OPTIONAL: 'Spotlight is optional. You can finish your highlight without it.',
  // T11570 -- the guided athlete-pick walk: auto-advance through every unpicked
  // detection marker instead of leaving the user to hunt for the next one. Counts
  // are always FRAMES, never jersey numbers. `compact` drops words for the smallest
  // viewports (SpotlightPickGuide picks it from the responsive placement table).
  PICK_GUIDE_TAP: GUIDE.overlay.pick.first.title,
  PICK_GUIDE_STEP: (n, total, compact) => (compact ? `Tap ${n}/${total}` : `Tap ${n} of ${total}`),
  PICK_GUIDE_WHY: (total) => GUIDE.overlay.pick.first.body.replace('{n}', total),
  PICK_GUIDE_AGAIN: GUIDE.overlay.pick.atMarker.body,
  PICK_GUIDE_CONFIRM: GUIDE.overlay.pick.next.title,
  PICK_GUIDE_NOT_OUTLINED: "My athlete isn't outlined",
  PICK_GUIDE_NOT_OUTLINED_DONE: 'Done placing athlete',
  PICK_GUIDE_DRAG: GUIDE.overlay.pick.none.title,
  PICK_GUIDE_AWAY: (n, total, compact) =>
    (compact ? GUIDE.overlay.pick.away.compactTitle : GUIDE.overlay.pick.away.title)
      .replace('{k}', n).replace('{n}', total),
  PICK_GUIDE_AWAY_BUTTON: () => 'Next tap',
  PICK_GUIDE_DONE: (total, compact) => (compact ? 'Spotlight set' : GUIDE.overlay.pick.done.title),
  PICK_GUIDE_DONE_BODY: GUIDE.overlay.pick.done.body,
  PICK_GUIDE_PLAY_SPOTLIGHT: 'Play spotlight',
  // T9960 -- surface the (already adjustable) effect interval as its own primary
  // readout, with the advanced styling controls kept secondary below it. The
  // interval is adjusted by dragging the region ends on the timeline and previewed
  // with Play spotlight -- this names it, it does not add a new default timing.
  SPOTLIGHT_DURATION: 'Spotlight duration',
  SPOTLIGHT_DURATION_HINT: 'Drag the ends on the timeline to adjust, or tap Play spotlight to preview.',
  // The timeline trim track is opened by the "Trim and slow motion" button
  // (FRAMING_GUIDE.TRIM_BUTTON); this is its rollover hint.
  // 2026-09-18 (user request: rollover hints on every Framing-screen button).
  TRIM_AND_SLOWMO_HINT: 'Split this highlight into sections, change playback speed, or trim the start and end.',
  // T12180: Focus settings in plain labels (the draggable rectangle is the 'box').
  MORE_OPTIONS: 'More options',
  FIX_TILT: 'Fix a tilted camera',
  FIX_TILT_HELP: 'Drag along a straight line on the field to level it.',
  DARKEN_OUTSIDE: DIM_OUTSIDE,
  DARKEN_OUTSIDE_HELP: 'Editing view only. Your highlight is not changed.',
  UNDO: 'Undo',
  UNDO_NOTHING: 'Nothing to undo',
  // T9950 Slice 3 -- preview approximation disclosure (design doc §4). Exact for
  // crop/timing/format/audio; approximate for image quality. Never a
  // sharpness claim in either direction.
  PREVIEW_HIGHLIGHT: 'Check zoom',
  PREVIEW_BACK_TO_FRAMING: 'Back to full video',
  // T12020 -- the Preview tile's caption follows its label: framing check before
  // previewing, return-to-box while previewing.
  PREVIEW_CAPTION_FRAMING: 'See what your highlight will show before you sharpen it.',
  PREVIEW_CAPTION_RETURN: 'Return to dragging the box.',
  PREVIEW_DISCLOSURE: 'This shows your zoom, timing and format. Final picture quality comes when you sharpen your highlight.',
  // T10970 -- the Overlay timeline's Text lane sits behind a disclosure, the
  // same disclosure shape as the Trim and slow motion track (user request 2026-09-21).
  TEXT_LANE: 'Text',
  TEXT_LANE_HINT: 'Add a title, name, or caption over the highlight.',
  // T10980 -- the Focus clip rail's framing badge. Undone reuses ANNOTATE.FRAME_CLIP
  // as its name; these are the done label and the undone hover copy.
  CLIP_FRAMED: 'Framed',
  FRAME_CLIP_HINT: 'Not framed yet. Move the box onto your athlete.',
};

// T14630: Spotlight step copy. The circle on the athlete is always "spotlight" (never a
// highlight, region, layer or ellipse); "highlight" stays the finished video.
export const SPOTLIGHT_COPY = {
  TAP_BOX: 'Tap to add spotlight',
  EMPTY_TIMELINE: 'Tap to add a spotlight',
  TURN_ON: 'Turn spotlight on',
  TURN_OFF: 'Turn spotlight off',
  TURNED_OFF_HINT: 'Tap the circle icon to turn spotlight on',
  DRAG_HINT: 'Drag the spotlight on the video to adjust it',
  numbered: (n) => `Spotlight ${n}`,
  positionAt: (seconds) => `Spotlight position at ${seconds}s`,
  DELETE: 'Delete spotlight',
  DELETE_CONFIRM_TITLE: 'Delete this spotlight?',
  DELETE_CONFIRM_BODY: "This can't be undone. You can add a new one with Add spotlight, but where you placed this one will be lost.",
  DISMISS_NOTICE: 'Dismiss spotlight notice',
  SHOW_OUTLINES: 'Show athlete outlines',
  HIDE_OUTLINES: 'Hide athlete outlines',
  SETTINGS: 'Spotlight settings',
  NO_SPOTLIGHT_HELP: 'Add a spotlight to change its color, shape and how much the rest of the video is dimmed.',
  STALE_FRAMING: "You changed this play's start or end after framing. Your spotlight still uses the old framing.",
  REDO_FRAMING: 'Redo framing',
  NEEDS_SHARPEN_MANY: `This highlight has more than one play. Sharpen it in ${MODE_NAMES.FRAMING}, then add a spotlight.`,
  NEEDS_SHARPEN_EDITS: 'You changed your framing. Sharpen your highlight, then add a spotlight.',
  GO_TO_FRAME: `Go to ${MODE_NAMES.FRAMING}`,
  LOADING_VIDEO: 'Loading video...',
  checklistStep: (n) => `Tap ${n}`,
  // Notices when a new sharpen moved or dropped spotlights (utils/highlightCarryNote.js).
  carryDropped: (n) => (n === 1
    ? '1 spotlight fell outside your new trim. Place it again in Spotlight.'
    : `${n} spotlights fell outside your new trim. Place them again in Spotlight.`),
  CARRY_RESET: 'Your spotlights were reset because your plays changed. Place them again in Spotlight.',
  CARRY_CHECK: 'Sharpening changed the timing. Check where your spotlights land in Spotlight.',
  // Save failures. Success stays quiet about saving (style rule 7).
  RETRY_DONE: 'Your spotlight changes are in.',
  SAVE_FAILED_TITLE: "We couldn't save some spotlight changes",
  SAVE_FAILED_BODY: `Tap Retry before you tap ${EXPORT_JOBS.overlay.action}.`,
  CHANGE_REJECTED_TITLE: "We couldn't save that spotlight change",
  CHANGE_REJECTED_BODY: "It's still on screen. Undo it and try again.",
  FLUSH_FAILED: "We couldn't save your spotlight changes. Try again.",
};

// T14630: text and cover controls in the Spotlight step.
export const TEXT_COPY = {
  SHOW: 'Show text',
  HIDE: 'Hide text',
  DELETE: 'Delete text',
  DELETE_ALL: 'Delete all this text',
  EXPAND: 'Expand text',
  COLLAPSE: 'Collapse text',
  SELECT_TO_EDIT: 'Select text to edit it.',
  NONE_HERE: 'No text at this point in the video',
  moveLabel: (label) => `Text "${label}". Drag or use arrow keys to move.`,
  SHADOW_SOFTNESS: 'Shadow softness',
  ALIGNMENT: 'Alignment',
  CUSTOM_POSITION: 'Custom position',
};

export const COVER_COPY = {
  DRAG_TO_PICK: 'Drag to pick the cover people see before they press play.',
  OWN_PHOTO: "You're using your own cover photo.",
  USE_STILL: 'Use a still from the video',
  autoPicked: (time) => `Picked for you at ${time}. Drag on the timeline to change it.`,
  youPicked: (time) => `You picked ${time}`,
  dragging: (time) => `Cover: ${time}`,
  dragWithTime: (time) => `Drag to pick the cover people see before they press play. Now at ${time}.`,
  SLIDER_LABEL: 'Pick cover. Drag on the timeline.',
};

// T9480 -- single source for the billing-rule copy, verbatim from
// BuyCreditsModal's shipped T9750 wording (round-HALF-UP, NOT ceil). Every
// disclosure surface reads from here so the copy cannot drift from what's
// actually charged (creditStore.roundCreditsHalfUp / getRequiredCredits).
export const CREDITS = {
  PER_SECOND_RULE: '1 credit per second, rounded to the nearest second',
  MIN_CHARGE: 'Every highlight you sharpen costs at least 1 credit.',
  // T14240: the paid and free steps, named by what the user does (never a bare "render").
  // Paid = framing export (AI upscaling), charged on every create; free = overlay export.
  PAID_HIGHLIGHT: 'Sharpening a highlight after you frame it',
  PAID_RECREATE: 'Sharpening a highlight again after changing its framing costs credits again.',
  FREE_OVERLAY: 'Adding or changing spotlight and text on a highlight you already sharpened',
  // T13310: storage rule, one credit surface string. Mirrors storageCost.js.
  STORAGE_RULE: '1 credit per GB per 30 days, rounded up to the next GB. Even a tiny file is 1 credit per 30 days. Uploading a game adds 1 credit for the automatic highlight.',
  // T14560: the one place "credit" is pluralized.
  count: (n) => `${n} credit${n === 1 ? '' : 's'}`,
  added: (n) => `${CREDITS.count(n)} added to your balance!`,
  REFUNDED: 'The credits used for this highlight were refunded.',
  billableLine: (exactSeconds, credits) =>
    `${formatLength(exactSeconds, PRECISION.TENTH)} of video · ${CREDITS.count(credits)} · ${CREDITS.PER_SECOND_RULE}.`,
};

// T11770: the shared cost/balance row (CreditCostRow) used by the four credit
// modals. Labels are formatters (not bare strings) so the "credits" noun and its
// singular/plural stay with the number in one source — the row renders
// "Cost: 2 credits" / "Balance: 54 credits".
export const CREDIT_COST_ROW = {
  COST: (n) => `Cost: ${CREDITS.count(n)}`,
  BALANCE: (n) => `Balance: ${CREDITS.count(n)}`,
};

// T11770: the retention notes shown under the cost row in the four credit modals.
// Built from STORAGE_DURATION_DAYS (the same constant calculateUploadCost prices
// against) so the storage window and the charge can never drift. Each is a full
// standalone sentence because CreditCostRow renders the note on its own line.
// EXTENSION_NOTE's duration is the user-chosen extension span, not the 30-day
// default, so it takes the value as an argument.
// T12160: picking a sport for play tags (header chip, tag helper, upload modal row).
export const SPORT_PICK = {
  CHIP: 'Pick sport',
  CHIP_ARIA: 'Pick your sport for play tags',
  HELPER: 'Pick your sport to see tags for it. You can keep editing this play.',
  UPLOAD_LABEL: 'Sport (for play tags)',
  UPLOAD_PLACEHOLDER: 'Pick a sport',
};

export const UPLOAD = {
  GAME_RETENTION_NOTE: `Your game video is kept for ${STORAGE_DURATION_DAYS} days.`,
  INVALID_VIDEO_FILE: "This file isn't a video we can open. Use an MP4, MOV or WebM.",
  ATTACH_RETENTION_NOTE: `This video is kept for ${STORAGE_DURATION_DAYS} days.`,
  FOOTAGE_RETENTION_NOTE: `This video is kept for ${STORAGE_DURATION_DAYS} days.`,
  // T14610: AttachVideoModal (add another half or camera to a game).
  ATTACH_VIDEO_INTRO: 'Add another half or camera to this game. The plays you already marked stay where they are.',
  TAP_TO_CHOOSE_VIDEO: 'Tap to choose a video',
  ADDING_VIDEO: 'Adding video...',
  EXTENSION_NOTE: (days) => `Adds ${days} days of storage.`,
  // T14810: the Upload game modal's disclosure for a parent with no game video
  // on this device (the biggest Add footage loss, prod Journey 2026-11-03).
  NO_VIDEO_TOGGLE: "Don't have the game video on this phone?",
  NO_VIDEO_STEPS: "Download the game from your camera's app or website, then come back here. A highlights zip works too.",
  NO_VIDEO_STEPS_LINK: 'See the steps for your camera',
  NO_VIDEO_SWITCH: 'Upload a play instead',
  NO_VIDEO_OTHER_DEVICE: 'On another device? Open reelballers.com there. Your account is the same.',
};

// Retention, stated as the three distinct outcomes confirmed in the T9680
// decision record (never "everything survives" or "everything is lost"). The
// public landing site states the same three facts. No em dashes.
// - SOURCE: game_storage row + raw R2 object, kept 30 days, extendable.
// - EXPORTED: final_videos survive source expiry, no cascade, free to store.
// - DRAFT: an un-exported draft has no independent source copy (T4130), so it
//   stays visible but becomes un-editable / un-exportable once its source is gone.
export const RETENTION = {
  SOURCE: `Your uploaded game is kept for ${STORAGE_DURATION_DAYS} days, and you can extend it anytime.`,
  EXPORTED: 'Highlights you sharpen are kept for good and are free to store.',
  DRAFT: `A play you haven't sharpened stays viewable, but you need its game video to edit or sharpen it, so finish the ones you want to keep before the ${STORAGE_DURATION_DAYS} days are up.`,
};

// T10190: the shared finished-result surface (CollectionPlayer + the card CTAs
// that open it), single source. WATCH_HIGHLIGHT/WATCH_MARKED_PLAYS are the
// entry-point card CTAs (DraftTile.jsx, ReelTile.jsx); LOADING/LOAD_ERROR are
// CollectionPlayer's T9470 skeleton/retry copy (state machine unchanged, copy
// only); BACK_TO_GAME is the new opt-in backlink affordance (design §2.4).
export const RESULT_SURFACE = {
  WATCH_HIGHLIGHT: 'Watch finished highlight',
  WATCH_MARKED_PLAYS: 'Watch marked plays',
  LOADING: 'Loading your highlight...',
  LOAD_ERROR: "Couldn't load the video. Try again.",
  SESSION_EXPIRED: 'Your session ended. Sign in to keep watching.',
  BACK_TO_GAME: 'Back to game plays',
};


// T14640: sharing copy. Share, link, people; one dead-link message for every shared page.
export const SHARE_COPY = {
  ADD_PEOPLE: 'Add people',
  PEOPLE_WITH_ACCESS: 'People with access',
  EMAIL_HINT: 'Add emails, separated by commas',
  CONTACTS_FAILED: "We couldn't load your contacts. You can still type emails.",
  DEAD_LINK: 'This link no longer works.',
  RESTRICTED: 'Only people it was shared with can watch. Sign in with the email the link was sent to.',
  COPY_LINK: 'Copy link',
  COPIED: 'Copied',
  LINK_COPIED: 'Link copied',
  GAME_LINK_COPIED: 'Game link copied. Drop it in the team chat.',
  // The browser refused the copy, so the link itself is the only way to reach it.
  COPY_IT_HERE: 'Your link is ready. Copy it from here:',
  PUBLIC_LINK_LIVE: 'Anyone with the link can watch these highlights. The link updates as new highlights are added.',
  TURN_OFF_LINK: 'Turn off link',
  TURNING_OFF: 'Turning off...',
  KEEP_LINK: 'Keep link',
  STOP_SHARING: 'Stop sharing',
  TURN_OFF_TITLE: 'Turn off this game link?',
  TURN_OFF_BODY: "Anyone you already sent the link to can't watch anymore. People you added above can still watch. You can create a new link later, but it will be a different link.",
  LINK_OFF: 'Link off. No one can watch with a link.',
  GAME_LINK_OFF: 'Game link turned off',
  NO_GAME_LINK: "This game doesn't have a link.",
  PUBLIC_GAME_HELP: 'Watches the game plays. No account needed.',
  EMAILS_SENT: 'Emails sent',
  LOADING_PEOPLE: 'Loading people...',
  LINK_UPDATED: 'Link updated',
  LINK_UP_TO_DATE: 'Link is up to date',
  UPDATE_LINK_FAILED: "We couldn't update this link",
  PRIVATE_UNTIL_LINK: 'Only you can see this until you create a link.',
  peopleCount: (n) => `${n} ${n === 1 ? 'person' : 'people'}`,
  sharedWith: (n) => `Shared with ${SHARE_COPY.peopleCount(n)}`,
  gameSharedWith: (n) => `Game shared with ${SHARE_COPY.peopleCount(n)}`,
  playsSharedWith: (n) => `Plays shared with ${SHARE_COPY.peopleCount(n)}`,
  teammatesSharedWith: (n) => `Shared with ${n} teammate${n === 1 ? '' : 's'}`,
  playAt: (time) => `Play at ${time}`,
  playsFor: (email) => `Plays for ${email}`,
  HIDE_PLAYS: 'Hide plays',
  SHOW_PLAYS: 'Show plays',
  // Tagged teammates.
  TEAMMATES_TITLE: 'Share with teammates',
  TEAMMATES_LINK_NOTE: "Each teammate gets a link to these plays. The link can be forwarded, and anyone who opens it can add the plays to their account, so it isn't tied to the email you enter.",
  LOADING_EMAILS: 'Loading emails...',
  ALL_TEAMMATES_SHARED: "You've shared with all tagged teammates.",
  // Highlight reels.
  REEL_SHARED: 'Highlight reel shared',
  REEL_LINK_LIVE: 'This link always shows the current highlights in this highlight reel.',
  REEL_INTRO_FROZEN: "Set when you share. Changing this highlight's intro card later won't change this link.",
  // Shared pages.
  SHARED_VIDEO: 'Shared video',
  LOADING_SHARED_PLAYS: 'Loading shared plays...',
  LOADING_GAME_PLAYS: 'Loading game plays...',
  GAME_PLAYS_UNAVAILABLE: "These game plays aren't available right now.",
  INVITE_FRIEND: 'Invite a friend to ReelBallers',
  NO_HIGHLIGHTS_YET: 'No highlights yet. Check back soon.',
};

// T14640: credit surfaces. CREDIT_HISTORY_LABELS is display only; ledger sources never change.
export const CREDIT_COPY = {
  BUY: 'Buy credits',
  NOT_ENOUGH: 'Not enough credits',
  HISTORY_TITLE: 'Credit history',
  NO_HISTORY: 'No credits used or added yet.',
  HISTORY_FOOTER: 'Showing your most recent credits.',
  ADDED_TITLE: 'Credits added!',
  PAYMENT_ISSUE: 'Payment issue',
  PAYMENT_LOAD_FAILED: "We couldn't load the payment form. Try again.",
  MOST_POPULAR: 'Most popular',
  BEST_VALUE: 'Best value',
  COST_LEAD: 'Sharpening a highlight costs',
  FREE_FINISHED_STORAGE: 'Storing your finished highlights',
  typicalHighlight: (credits) => `A typical highlight uses ~${credits} credits.`,
  highlightCost: (required, length) =>
    `Sharpening this highlight costs ${CREDITS.count(required)} for ${length} of video (${CREDITS.PER_SECOND_RULE}).`,
  uploadCost: (n) => `Adding this game costs ${CREDITS.count(n)} and keeps it for ${STORAGE_DURATION_DAYS} days.`,
  balanceHint: (n) => `${CREDITS.count(n)}. Tap to buy more`,
};

export const CREDIT_HISTORY_LABELS = {
  PURCHASE: 'Credit purchase',
  HIGHLIGHT: 'Highlight',
  HIGHLIGHT_REFUND: 'Highlight refund',
  GAME_UPLOAD: 'Game upload',
  STORAGE: 'Storage extension',
  BONUS: 'Bonus credits',
  REFUND: 'Refund',
  VIDEO_ADDED: 'Video added to a game',
  PLAY_UPLOAD: 'Play upload',
  PLAY_UPLOAD_REFUND: 'Play upload refund',
};

// T14640: storage. One reassurance line for the game tile menu and the expiry banner.
export const STORAGE_COPY = {
  EXTEND: 'Extend storage',
  EXTEND_LABEL: 'Add storage time',
  EXTEND_ROW: 'Added time',
  extendFor: (credits) => `Extend storage: ${CREDITS.count(credits)}`,
  addedUntil: (days, date) => `+${days} days, until ${date}`,
  EXPIRY_REASSURANCE: "Sharpened every highlight you want? It's fine to let the game expire. Your marked plays stay playable.",
  expiringSoon: (games, plays) =>
    `${games} ${games === 1 ? 'game' : 'games'} expiring soon. ${plays} ${plays === 1 ? 'play' : 'plays'} in progress ${plays === 1 ? 'depends' : 'depend'} on ${games === 1 ? 'it' : 'them'}.`,
  GAME_VIDEO_EXPIRED: 'Game video expired',
  gameVideoExpires: (days) => `Game video expires in ${days} day${days === 1 ? '' : 's'}`,
  EXPIRED_BODY: "This game's video is gone because its storage ended, so this highlight can't be edited.",
  EXPIRED_CAN_EXTEND: ' Extend storage to keep editing.',
  EXPIRED_FOR_GOOD: " Its storage ended and it can't be recovered.",
  EXPIRED_NOTE: "If you already sharpened this highlight, that finished highlight is safe. You just can't edit it from the game video anymore.",
  EXPIRED_TAP: 'Game expired. Tap to extend',
  expiresTap: (days) => `Expires in ${days} day${days === 1 ? '' : 's'}. Tap to extend`,
};

// T14640: profiles and intro cards. "athlete" is the parent's kid (glossary D4). CONSENT_LINE is
// a parental consent: keep all three parts (parent or guardian, agreement, who can see it).
export const INTRO_COPY = {
  TITLE: 'Intro card',
  LIST_TITLE: 'Intro cards',
  NEW: 'New intro card',
  DELETE: 'Delete intro card',
  NONE: 'No intro card',
  NONE_YET: 'No intro cards yet.',
  GRID_EMPTY: 'No intro cards yet. Create one to open a highlight with your athlete.',
  NAME_LABEL: 'Intro card name',
  ON_THE_CARD: 'On the intro card',
  PUBLIC_NOTE: 'Anyone with the link can see this intro card.',
  CREATE_ARIA: 'Create new intro card',
  CONSENT_BODY: "An intro card shows your athlete's photo, and anyone you share a link with can see it. Make sure you have permission before you build one.",
  CONSENT_LINE: "I'm this athlete's parent or guardian and I agree to use their photo and details on an intro card. I understand anyone I share a link with can see it.",
  CONSENT_NEEDED: "Adding an intro card needs a parent or guardian's consent for this profile.",
  CONSENT_SETTINGS: 'Go to consent settings',
  CONSENT_PATH: 'Open your profile menu, then Manage profiles, then Intro cards, to give consent.',
  FACTS_PATH: 'Open your profile menu, then Manage profiles, to add a position, class, or team.',
  ADD_NEW_TITLE: 'Add your new intro card?',
  ADD_NEW_BODY: "Your new intro card is in your library, but it isn't added here yet. The previous intro card would keep playing.",
  DONT_ADD: "Don't add",
  ADD: 'Add intro card',
  exposure: (linkLabel) => `This intro card includes a photo. Anyone with this ${linkLabel} can see it.`,
  addFact: (label) => `Add ${label.toLowerCase()}`,
  introFor: (title) => `Intro card for "${title}"`,
  generatedName: (n) => `Intro card ${n}`,
};

export const PROFILE_COPY = {
  MANAGE: 'Manage profiles',
  ADD: 'Add profile',
  EDIT: 'Edit profile',
  DELETE: 'Delete profile',
  DELETE_BODY: 'All plays and highlights for this profile will be permanently deleted. Game videos shared with other profiles will not be affected.',
};

// T14640: "Guidance" is the only name for the tips toggle; progress is "Getting started".
export const GUIDANCE_COPY = {
  LABEL: 'Guidance',
  GETTING_STARTED: 'Getting started',
  gettingStarted: (done, total) => `Getting started: ${done} of ${total}`,
  ACCOUNT_HINT: 'Use the Guidance switch at the top of the app to turn tips on or off.',
};

// T14640: ranking, named by what the parent does (no matchup, rematch or confidence).
export const RANKING_COPY = {
  PICK_HINT: 'Tap a highlight to pick it, or use',
  TITLE: 'Pick the better highlight',
  UNDO: 'Undo last pick',
  PROGRESS: 'Ranking progress',
  PURPOSE: 'Pick the better of two highlights so your best ones show first.',
  ALL_RANKED: 'All highlights ranked',
  ADD_MORE: 'Add more highlights to keep picking.',
  NOT_STARTED_NOTE: "You haven't started yet, but you should. It's fun!",
  ALMOST_NOTE: 'Almost there. Just a few more!',
  CAUGHT_UP_HINT: 'New highlights will ask for a few picks when you finish them.',
  LOADING: 'Loading your highlights...',
  INTRO_BODY: "You're choosing the better of two highlights: the one that plays first and the one that plays next.",
  MOVE: "Change this highlight's spot",
  MOVE_TOAST: "We'll ask about this one again",
  MOVE_TOAST_BODY: 'It goes back into your picks so its spot can move.',
  favorite: (n) => `Your #${n} favorite highlight this season`,
};

// T14640: account and sign-in, sentence case.
export const ACCOUNT_COPY = {
  TITLE: 'Account settings',
  SIGN_IN: 'Sign in',
  SIGN_OUT: 'Sign out',
  SEND_CODE: 'Send code',
  RESEND_CODE: 'Send a new code',
  USE_DIFFERENT_EMAIL: 'Use a different email',
  SIGNED_IN_EMAIL: 'Signed in with email',
  SIGN_IN_ANYWHERE: 'Sign in to keep your work on every device',
  GOOGLE_ACCOUNT: 'Google account',
  LINK_ACCOUNT: 'Link account',
  PRIVACY_RIGHTS: 'Your privacy rights',
  DELETE_ACCOUNT: 'Delete my account',
  DELETE_FOREVER: 'Delete forever',
  GATE_TITLE: 'Make your first highlight',
  GATE_BODY: 'Sign in to get started. Your plays are waiting.',
  TAGLINE: 'Turn game video into high-quality highlights using AI upscaling',
};

// T13230: Veo highlights zip -> clips pick list (Path B). Factual, nominative use of the
// name (EPIC.md decision V5). No em dashes.
export const VEO_CLIP_IMPORT = {
  TITLE: 'Choose highlights to add',
  READING: 'Reading the zip...',
  NOT_VEO: 'Only Veo highlights zips are supported.',
  READ_FAILED: 'Could not read this zip.',
  NONE_SELECTED: 'Nothing selected. Pick the plays you want.',
  SELECT_ALL: 'Select all',
  CLEAR: 'Clear',
  CANCEL: 'Cancel',
  addButton: (n) => `Add ${n} highlight${n === 1 ? '' : 's'}`,
  GAME_TITLE: 'Choose highlights for the game',
  createGameButton: (n) => `Create game from ${n} highlight${n === 1 ? '' : 's'}`,
  extractingGame: (done, total) => `Preparing ${done}/${total}...`,
  // T13246: the optional game details step of "make a game".
  DETAILS_SUMMARY: 'Game details (optional)',
  DETAILS_FROM_ZIP: "Filled in from your zip's name. Check it's right.",
  DETAILS_LATER: 'You can add an opponent and game date later.',
  // The game video's file name, shown on the Videos lane: the play, not the zip entry's raw name.
  gameVideoName: (label, stamp_s) => `${label} ${Math.floor(stamp_s / 3600) ? `${Math.floor(stamp_s / 3600)}h` : ''}${Math.floor((stamp_s % 3600) / 60)}m${String(Math.floor(stamp_s % 60)).padStart(2, '0')}s.mp4`,
  titlePreview: (title) => `Game title: ${title}`,
  EXTRACTING: 'Preparing...',
  durationLabel: (s) => `${Math.round(s)}s`,
};

// T13247: any zip of clips handed to an upload (utils/zipClips.js). Generic: never "Veo".
export const ZIP_CLIPS = {
  NO_VIDEOS: 'This zip has no videos in it.',
  UNZIPPING: 'Unzipping your plays...',
  tooBig: (name) => `${name} is too big to unzip here, upload it on its own`,
  unreadable: (name) => `Could not read ${name}.`,
};

// T13240: where a dropped Veo zip goes (Path A suggested plays / Path B clips).
export const VEO_ROUTING = {
  TITLE: 'Veo highlights zip',
  READING: 'Checking the zip...',
  addAsPlays: (game) => `Add as suggested plays to ${game}`,
  playedOn: (date) => `Played ${date}`,
  NO_MATCH_DATE: 'No match date set',
  UPLOAD_AS_CLIPS: 'Upload as plays',
  MAKE_GAME: 'Make a game from these highlights',
  CANCEL: 'Cancel',
  NO_GAME_NOTE: 'Upload the full Veo game first and these highlights become suggested plays on it.',
  gameLabel: (g) => g.name || [g.opponent_name && `vs ${g.opponent_name}`, g.game_date].filter(Boolean).join(' ') || `Game ${g.id}`,
};

// T13220: Annotate "Import Veo highlights" (suggested plays). Literals live here, not inline.
export const VEO_SUGGESTIONS = {
  SHEET_TITLE: 'Import Veo highlights',
  NOT_VEO: 'Only Veo highlights zips are supported.',
  READ_FAILED: 'Could not read this zip.',
  reading: (done, total) => (total ? `Reading ${total} highlights... ${done}/${total}` : 'Reading the zip...'),
  summary: (n, parts) => `${n} play${n === 1 ? '' : 's'}${parts ? `: ${parts}` : ''}`,
  WHICH_VIDEO: 'Which video are these highlights from?',
  videoOption: (seq) => `Video ${seq}`,
  IMPORT: 'Import',
  IMPORTING: 'Importing...',
  CANCEL: 'Cancel',
  IMPORT_FAILED: 'Could not import these highlights. Try again.',
  IMPORT_REFUSED: "These highlights can't be imported into this game.",
  IMPORT_REFUSED_NEXT_STEP: 'To use this zip, choose "Make a game from these highlights" on the Games screen.',
  ALIGN_QUESTION: 'Does the play start here?',
  EARLIER: '-1 s',
  LATER: '+1 s',
  LOOKS_RIGHT: 'Looks right',
  REMOVE_IMPORT: 'Remove import',
  LIST_TITLE: 'Suggested plays',
  STATE_OPEN: 'Open',
  STATE_KEPT: 'Kept',
  STATE_DISMISSED: 'Dismissed',
  NAME_LABEL: 'Name',
  NOT_MY_PLAYER: 'Not my athlete',
  NEXT: 'Next',
  EDIT_PLAY: 'Edit play',
  UNDO: 'Undo',
  keptHeader: (ratingWord) => `Play \u00b7 ${ratingWord}`,
  KEPT_TOAST: 'Play kept',
  DISMISSED_TOAST: 'Suggestion dismissed',
  SAVE_FAILED: 'Could not save this play. Try again.',
  durationLabel: (s) => `${Math.round(s)}s`,
};

// T14530: the mode-switch dialog (leaving Frame or Spotlight with unmade edits). Framing
// edits rebuild the highlight, so that body keeps the warning that spotlight work resets.
export const MODE_SWITCH_DIALOG = {
  TITLE: 'Unsaved changes',
  SPOTLIGHT_BODY: "You changed your spotlight but haven't added it to the highlight yet.",
  FRAMING_BODY: "You changed your framing but haven't sharpened the highlight yet. Sharpening it now resets your spotlight.",
  DISCARD: 'Discard changes',
  SHARPEN: EXPORT_JOBS.framing.action,
  ADD_SPOTLIGHT: EXPORT_JOBS.overlay.action,
  KEEP_EDITING: 'Keep editing',
};

// T14570: resuming an upload with a file whose name differs from the one it started with.
export const RESUME_FILE_DIALOG = {
  TITLE: 'Different file name',
  BODY: 'This file has a different name than the one you started with. Is it the same video?',
  USE_IT: 'Yes, use it',
  PICK_ANOTHER: 'Pick another',
};

// T14570: the in-app confirm for a CtaBar action with `confirm` set.
export const CTA_CONFIRM_DIALOG = {
  TITLE: 'Are you sure?',
  CANCEL: 'Cancel',
};

// T14530: one error voice ("We couldn't [thing]. Try again."). Technical detail goes to
// the console only; utils/userError.js decides which text a parent may read.
// T14670: small app-shell surfaces the area sweeps did not own.
export const APP_SHELL_COPY = {
  SYNC_PENDING: 'Still backing up your work',
  INSTALL_ICON: 'Home screen icon: one tap to open',
  INSTALL_FULL_SCREEN: 'Full screen: no browser bars',
  REPORT_INCLUDED: 'A screenshot and logs are included automatically',
  REPORT_ASK: 'One sentence helps us fix it. A screenshot and logs are included automatically',
  REPORT_PREVIEW: 'This is exactly what will be copied. Known credentials are removed, so glance over it before sharing. Paste it to us if retrying keeps failing.',
};

export const ERROR_COPY = {
  CONNECTION: "We couldn't connect. Check your internet and try again.",
  CONNECTING: 'Connecting...',
  WAKING_UP: 'Getting things ready, one moment...',
  RETRY_ANOTHER_MOMENT: "We couldn't connect. We'll keep trying...",

  // Sign in
  SEND_CODE: "We couldn't send your code. Try again.",
  CHECK_CODE: "We couldn't check your code. Try again.",

  // Making a highlight
  MAKE_HIGHLIGHT: "We couldn't sharpen your highlight. Try again.",
  ADD_SPOTLIGHT: "We couldn't add your spotlight. Try again.",
  SAVE_HIGHLIGHT: "We couldn't save your highlight. Try again.",
  MAKE_HIGHLIGHT_REFUNDED: `We couldn't sharpen your highlight. ${CREDITS.REFUNDED} Try again.`,
  SAVE_EDITS: "We couldn't save your edits. Try again.",
  EDITS_RETRYING: "Some edits didn't save. We're trying again, so tap again in a moment.",
  OPEN_HIGHLIGHT_AGAIN: "We couldn't find this highlight. Open it again and try again.",
  NO_VIDEO: 'Add a video first, then try again.',
  NO_POSITION: 'Place the box on your video first, then try again.',
  VIDEO_LENGTH: "We couldn't read this video's length. Try again.",
  STILL_MAKING: "We lost connection, but we're still working on your highlight. Reconnecting...",
  CHECKING_HIGHLIGHT: 'Checking on your highlight...',
  RECONNECTED: 'Reconnected. Picking up where we left off...',
  STILL_CHECKING: 'Still checking on your highlight...',

  // Frame edits
  UNDO_EDIT: "We couldn't undo that. Try again.",
  SAVE_POSITION: "We couldn't save that position. Try again.",
  DELETE_POSITION: "We couldn't delete that position. Try again.",
  MOVE_POSITION: "We couldn't move that position. Try again.",
  PASTE_POSITION: "We couldn't paste that position. Try again.",
  SAVE_ROTATION: "We couldn't save the rotation. Try again.",
  SAVE_TRIM: "We couldn't save your trim. Try again.",
  SPLIT_SECTION: "We couldn't split this section. Try again.",
  REMOVE_SPLIT: "We couldn't remove that split. Try again.",
  SET_SPEED: "We couldn't change the speed. Try again.",

  // Video playback
  LOAD_VIDEO: "We couldn't load this video. Try again.",
  VIDEO_UNSUPPORTED: "This browser can't play this video.",

  // Games and uploads
  LOAD_GAMES: "We couldn't load your games",
  LOAD_PLAYS: "We couldn't load your plays",
  CHECK_INTERNET: 'Check your internet and try again.',
  CREATE_GAME: "We couldn't add this game. Try again.",
  UPDATE_GAME: "We couldn't update this game. Try again.",
  UPLOAD: "We couldn't finish your upload. Tap Retry upload to try again.",
  UPLOAD_WAIT_STALLED: 'This video was already uploading, but it stopped. Tap Retry upload to try again.',
  FINALIZE_UPLOAD: "We couldn't finish saving your video. Try uploading again.",
  ADD_VIDEO: "We couldn't add your video. Try again.",
  EXTEND_STORAGE: "We couldn't extend your storage. Try again.",
  READ_FILE: "We couldn't read this file. Try again.",

  // Credits
  START_PAYMENT: "We couldn't start your payment. Try again.",
  LOAD_CREDIT_HISTORY: "We couldn't load your credit history. Try again.",

  // Sharing and downloads
  SHARE: "We couldn't share that. Try again.",
  CREATE_LINK: "We couldn't create your link. Try again.",
  TURN_OFF_LINK: "We couldn't turn off your link. Try again.",
  COPY_LINK: "We couldn't copy your link. Try again.",
  UPDATE_SHARE: "We couldn't update this link. Try again.",
  DOWNLOAD: "We couldn't download this. Try again.",
  COMPARISON: "We couldn't make your before and after video. Try again.",
  COMPARISON_UNAVAILABLE: "A before and after video isn't available for this highlight.",

  // Finishing and reopening
  FINISH: "We couldn't finish your highlight. Try again.",
  OPEN_HIGHLIGHT: "We couldn't open this highlight. Try again.",

  // Profile and intro cards
  UPLOAD_PHOTO: "We couldn't upload your photo. Try again.",
  REMOVE_PHOTO: "We couldn't remove your photo. Try again.",
  SAVE_CONSENT: "We couldn't save your consent. Try again.",
  SAVE_CHANGE: "We couldn't save that change. Try again.",
  CREATE_CARD: "We couldn't create your intro card. Try again.",
  DUPLICATE_CARD: "We couldn't copy your intro card. Try again.",

  // One voice for the remaining failures (audit F-14, F-16)
  LOAD_CREDIT_PACKS: "We couldn't load the credit packs. Try again.",
  SEND_EMAILS: "We couldn't send your emails. Try again.",
  SEND_EMAILS_CHECK: "We couldn't send your emails. Check the addresses and try again.",
  REST_SENT: 'The rest were sent.',
  emailFailed: (names) => `We couldn't email ${names}. Check the address and try again.`,
  LOAD_SHARED: "We couldn't load what was shared. Try again.",
  LOAD_PROFILE: "We couldn't load your profile. Try again.",
  LOAD_COLLECTION: "We couldn't load this highlight reel. Try again.",
  LOAD_SHARED_VIDEO: "We couldn't load this video. Try again.",
  RERANK: "We couldn't move this highlight. Try again.",
  DOWNLOAD_REEL: "We couldn't download this highlight reel. Try again.",
  DOWNLOAD_HIGHLIGHT: "We couldn't download this highlight. Try again.",
  SAVE_SPORT: "We couldn't save your sport. Try again.",
  SAVE_GUIDANCE: "We couldn't save your Guidance setting. Try again.",
  OPEN_DRAFT: "We couldn't open this highlight",
  OPEN_HIGHLIGHT_TITLE: "We couldn't open this highlight",
  SAVE_VIDEO_CHOICE: "We couldn't change the camera. Try again.",
  SAVE_TIMING: "We couldn't line up this video. Try again.",
  LOAD_GAME: "We couldn't load this game. Try again.",
  SAVE_PLAY: "We couldn't save this play",
  SAVE_THIS_CHANGE: "We couldn't save this change",
  SAVE_CHANGE_TITLE: "We couldn't save your change",
  REMOVE_FROM_PROFILE: "We couldn't remove this from your profile. Try again.",
  MOVE_HIGHLIGHTS: "We couldn't move your highlights. Try again.",
  DELETE_HIGHLIGHT_NOT_SYNCED: "We couldn't delete your highlight. Try again.",
  REOPEN_NOT_SYNCED: "We couldn't finish saving. Your highlight is back in progress on this device and finishes saving when you tap Retry.",
  CHANGES_NOT_SYNCED: "Some changes didn't save.",
  VERIFY_PAYMENT: "We couldn't confirm your payment yet. Your credits may still be added shortly.",
  FINISH_TITLE: "We couldn't finish your highlight",
  TRY_AGAIN: 'Try again.',

  // Problem reports
  REPORT_NOT_SENT: "We couldn't send your report. Your message is still here, so try again below.",
  REPORT_NO_CONNECTION: "We couldn't connect. Your message is still here, so try again below.",
};

// T14530: errors for an imported plays file. Parents see these beside the file they
// picked, so they name what to fix, never a column id.
export const IMPORT_FILE_ERRORS = {
  EMPTY: 'This file is empty. Pick a file with your plays in it.',
  WRONG_FORMAT: "This file doesn't look like a plays file. Check it and try again.",
  NO_PLAYS: 'We found no plays in this file.',
  missingDetails: (line) => `Line ${line}: this line is missing some details`,
  startTime: (line) => `Line ${line}: the start time should look like 12:30`,
  rating: (line) => `Line ${line}: the rating should be a number from 1 to 5`,
  tags: (line, tags) => `Line ${line}: we don't know the tag ${tags}`,
  playLength: (line) => `Line ${line}: the play length should be a number of seconds, like 12.5`,
};
