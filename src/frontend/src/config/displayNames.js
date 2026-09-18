import { formatLength, PRECISION } from '../utils/timeFormat';

// T9520 (Shared Vocabulary epic — naming groups N04-N35): the canonical
// Annotate-surface vocabulary, single source. One object model across every
// Annotate label: a GAME holds PLAYS (marked time ranges with rating/tags/notes);
// a PLAY can produce a CLIP (an editable video). Reels are multi-clip objects and
// live OFF this surface (Library), so "reel" never appears in Annotate copy — a
// play produces a CLIP, never a reel. Internal names (the `my_athlete` field,
// `autoProjectId`, EDITOR_MODES, routes, analytics events) are deliberately NOT
// renamed to match — deep links and greppability beat cosmetic consistency.
// Editor mode names live in MODE_NAMES below (T9860 moved them off the per-mode
// editorStore.SCREENS[].label and out of this comment).
export const ANNOTATE = {
  MODE_DESCRIPTION: 'Mark plays',          // N04 — mode-switcher description
  MARK_PLAY: 'Mark play',                  // N05 — primary create CTA
  EDIT_PLAY: 'Edit play',                  // N05 — edit CTA
  // N05 helper: the default capture window is 6s before + 2s after the tap = 8s
  // (DEFAULT_CLIP_BEFORE + DEFAULT_CLIP_AFTER, single-sourced in clipConstants.js — T9840).
  MARK_PLAY_HELPER: 'Captures 6 seconds before and 2 after',
  MARKING_PLAY_TITLE: 'Marking a play',    // N05 — create-editor header title
  PLAYS_HEADING: 'Plays',                  // N06 — sidebar list heading
  // N07 — create-an-editable-clip toggle. Positive polarity both states (T9450):
  // ON produces a clip, OFF just saves the play. Never a "Don't …" double negative.
  CREATE_EDITABLE_CLIP: 'Create an editable clip',
  JUST_SAVE_PLAY: 'Just save this play',
  SAVE_PLAY: 'Save play',                  // N08 — save a play only
  SAVE_PLAY_AND_CLIP: 'Save play and create clip', // N08 — save + produce a clip
  UPDATE_PLAY: 'Update play',              // N08 — edit-mode save
  CREATE_CLIP: 'Create clip',              // N09 — manual create-clip action
  CLIP_CREATED: 'Clip created',            // N09 — created indicator
  DELETE_CLIP: 'Delete clip',              // N14 — delete a play that has a clip
  DELETE_PLAY: 'Delete play',              // N14 — delete a bare play marker
  RENAME_CLIP: 'Rename clip',              // N15 — rename action
  CLIP_NAME: 'Clip name',                  // N15 — name field
  PREVIEW_PLAYS: 'Preview plays',          // N26 — playback-all button (was "Playback Annotations")
  PREVIEW_CLIP: 'Preview clip',            // N26 — per-clip preview (unchanged)
  LAYER_LABEL: 'Play category',            // N28 — the control formerly "Clip layer"/"Layer"
  LAYER_MINE: 'My athlete',                // N28, reversed by T9860 (2026-09-14)
  LAYER_TEAM: 'Team',                      // N28 — unchanged
  // N41 (T9580) — the first-clip invitation after a saved play. FRAME_THIS_CLIP
  // is the FOCUS-stage primary CTA (single-sourced into clipStage.getClipStage,
  // so the desktop strip and the sidebar share it); KEEP_MARKING_PLAYS is its
  // dismiss secondary (closes the editor, playhead preserved). Later stages keep
  // their T9320/T9330 labels (Apply Spotlight / View Final / View Published).
  FRAME_THIS_CLIP: 'Frame this clip',      // N41 — FOCUS-stage primary CTA
  KEEP_MARKING_PLAYS: 'Keep marking plays', // N41 — invitation dismiss secondary
  // T10240/T10290 (N42): the two Framing-entry actions. "Frame"/"Save and Frame"
  // is the VERB form of the Framing mode (MODE_NAMES.FRAMING = 'Framing', T9860) —
  // deliberately NOT the old "Focus" mode name, and NOT the noun "Framing" (which
  // would read "Framing clip"). FRAME_CLIP pairs with CREATE_CLIP as the two
  // NO_PROJECT stage actions (create-only vs create-and-open-Framing, T10240);
  // SAVE_AND_FRAME is the editor's create-then-open-Framing outcome (T10290 —
  // replaces the old CREATE_EDITABLE_CLIP second button). Same verb-vs-noun split
  // as FRAME_THIS_CLIP above, which is likewise a literal (not MODE_NAMES-derived).
  FRAME_CLIP: 'Frame clip',                // N42 — NO_PROJECT create + open Framing
  SAVE_AND_FRAME: 'Save and Frame',        // N42 — editor save + open Framing
  // T10290: the details disclosure label (was the inline literal "Add details").
  // Renamed to just "Details" — the count suffix (e.g. "Details (2 tags, note)")
  // is composed at the call site when content exists.
  DETAILS: 'Details',
  // T9900: caption under the create-in-flight DISABLED "Frame this clip" button, so a
  // briefly-disabled onward action explains its temporary preparation state instead of
  // reading as broken (evidence E09). Clears itself when the project id lands.
  PREPARING_CLIP: 'Preparing your clip...',
};

// T9560 (Shared Vocabulary epic, N34): the Annotate share controls, single source.
// The old copy ("Share Annotations" / "Shared w/ Tagged Teammates") both said
// "Annotations" (off the play/clip object model) and, worse, the "Shared …" state
// label read as a claim that sharing had already happened when it may not have.
// Split cleanly: SHARE_PLAYS is the ACTION (open the share flow); SETTINGS is the
// state-neutral label for managing an existing share (opens the same dialog without
// re-implying a fresh share). Never imply sharing that has not occurred.
export const SHARING = {
  SHARE_PLAYS: 'Share plays',       // the action — open the game-invitation flow
  SHARE_PLAYS_SHORT: 'Share',       // narrow-viewport action label
  SETTINGS: 'Sharing settings',     // state-neutral: manage/adjust an existing share
  SETTINGS_SHORT: 'Sharing',        // narrow-viewport state label
  // T9810: the "Share plays" buttons (fullscreen bar + normal-view promoted/compact)
  // all open the game-scoped SharePlaybackDialog now. Tagged-player sharing (T2820,
  // ShareWithTeammatesModal) keeps its OWN honest affordance, rendered only when
  // tagged clips exist so it can never silently no-op.
  TAGGED_SHARE: 'Share with tagged players',       // T2820 tagged-player sharing entry
  TAGGED_SHARE_SHORT: 'Tagged players',            // narrow-viewport label
  // T9810: scope disclosure for the game-invitation dialog. VERIFIED against
  // POST /api/games/{id}/share-playback -> materialize_game_share/_copy_game +
  // _materialize_clips: a recipient receives the FULL game recording (blake3_hash +
  // all game_videos) PLUS every marked play (all raw_clips for the game), not a
  // subset. Do NOT narrow this to "only invited plays" without re-checking that grant.
  SCOPE_DISCLOSURE: "Anyone you invite can watch this entire game recording and every play you've marked in it.",
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
export const MODE_NAMES = {
  ANNOTATE: 'Annotate',
  FRAMING: 'Framing',
  SPOTLIGHT: 'Spotlight',
};

// T9860 (Shared Vocabulary epic, copy and concept sweep, design doc section 2.3
// Section 5): one reason sentence per stage, none using the feature's own name
// as the reason. Mark play replaces the mechanics-only helper line; Framing and
// Publish are new; Spotlight replaces FOCUS_PUBLISH.SPOTLIGHT_CAPTION. Declared
// here (near MODE_NAMES) rather than at the file's end because FOCUS_PUBLISH and
// OVERLAY_PUBLISH below both read PUBLISH as part of their publish captions.
export const STAGE_REASONS = {
  MARK_PLAY: 'You are bookmarking, not editing, so tap through the whole game and come back to edit later.',
  FRAMING: 'You filmed wide from the stands and the video you are sending is phone shaped, so framing is you choosing what survives the crop.',
  SPOTLIGHT: 'Twenty-two kids in the same kit: this is how anyone watching knows which one is yours.',
  PUBLISH: 'Nobody else can see this until you share a link.',
};

export const SECTION_NAMES = {
  // Single-clip auto-draft tab (Home). Tab id stays `projects` / URL
  // `/home/reels` (frozen for deep-link compat). T9530 (Shared Vocabulary epic,
  // N10, 2026-09-10) dropped the "In Progress" prefix — status is shown per item,
  // not baked into the object name — so the label is now just "Clips" (was
  // "In Progress Clips" T8555, "Clips" T8360, "Reel Drafts" before). This makes
  // the full label match SECTION_NAMES_SHORT.CLIPS universally.
  CLIPS: 'Clips',
  CLIPS_LOWER: 'clips',

  // Multi-clip assemblies (T8360). T8555 promoted this to its own top-level tab;
  // T9530 (N11) dropped the "In Progress" prefix so the label is now "Reels"
  // (was "In Progress Reels" T8555, "Highlights" before). In-progress-drafts
  // surface only -- published reels live under PUBLISHED.
  // T9860: key renamed to REELS to match its own value (was HIGHLIGHTS, which
  // grepped as a lie -- the value has said "Reels" since T9530).
  REELS: 'Reels',

  // Published reels tab (T8555) -- every published reel regardless of single-
  // or multi-clip origin (the old gallery/DownloadsPanel published list,
  // relocated to its own top-level tab).
  PUBLISHED: 'Published',
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
  ADD_FOOTAGE: 'Add footage to game',      // N03 — was "Add footage"/"Add footage to this game"
  CREATE_REEL: 'Create reel',              // N13 — was "Build New Reel"/"Create Reel from Clips"
  // N13 — assembly submit, shows the selected count; button is disabled at zero.
  CREATE_REEL_WITH_COUNT: (n) => `Create reel (${n} clip${n === 1 ? '' : 's'})`,
  DELETE_CLIP: ANNOTATE.DELETE_CLIP,       // N14 — 'Delete clip'
  DELETE_REEL: 'Delete reel',              // N14
  RENAME_CLIP: ANNOTATE.RENAME_CLIP,       // N15 — 'Rename clip'
  RENAME_REEL: 'Rename reel',              // N15
  PUBLISH_CLIP: 'Publish clip',            // N12
  PUBLISH_REEL: 'Publish reel',            // N12
};

// T8980: one-line short tab labels shown BELOW `sm`. T9530 (N10/N11) collapsed
// SECTION_NAMES onto these exact words at every breakpoint — the full labels no
// longer carry an "In Progress" prefix, so SECTION_NAMES and SECTION_NAMES_SHORT
// now render the SAME set (Games / Clips / Reels / Published). This constant is
// kept as the single source the EmptyTabGuide flow-strip step labels
// (emptyStates.js FLOW_STEPS) read from; "Published" sitting next to "Reels" is
// what reads the middle two as in-progress, so status lives per item, never in
// the tab name.
export const SECTION_NAMES_SHORT = {
  GAMES: 'Games',
  CLIPS: 'Clips',
  REELS: 'Reels',
  PUBLISHED: 'Published',
};

// T8380: direct clip upload on the Clips tab. A separate group from
// SECTION_NAMES (tab labels) -- this is the upload GESTURE plus its one-time
// consequence notice. T9530 (N02, 2026-09-10) renamed the CTA "Add Video" ->
// "Upload clip" (object-model verb: you UPLOAD a clip), and renamed the key
// ADD_VIDEO -> UPLOAD_CLIP to keep the constant greppable by its new label. The
// notice copy was user-approved 2026-09-05 (softened from an absolute "can't"
// claim; the "add to a Game instead" pointer was dropped for a terser notice).
// T9640: one-line game-vs-clip distinction shown BENEATH each upload entry on the
// populated Games/Clips tabs (the empty-state EmptyTabGuide already pairs its
// buttons with captions; these give the same plain-language distinction at the
// non-empty entry points, where the CTA otherwise stands alone). Parallel phrasing
// states the choice: a full game must have plays marked to yield clips; a short
// clip skips that and goes straight to Framing. No em dashes (project-wide rule);
// "Framing" (MODE_NAMES.FRAMING) is the current mode name, used as a noun, never a verb.
export const UPLOAD_ENTRY_HINT = {
  GAME: 'A full game needs plays marked before it becomes clips.',
  CLIP: `A short clip skips straight to ${MODE_NAMES.FRAMING}, no game needed.`,
};

// Division of work shown near the start action (Upload game), so a first-time
// parent can tell their job (marking plays, framing the crop, picking their
// player from the AI's boxes) from the app's job (upscale, spotlight, share
// link). Do NOT claim autonomous framing/tracking here - Focus mode's crop is
// user-placed (FramingInstructions.jsx), and player "tracking" is the user
// clicking their kid on AI-proposed per-frame boxes (PlayerDetectionOverlay),
// not identity tracking. No em dashes (project-wide rule).
export const DIVISION_OF_WORK =
  'You mark the plays, frame your athlete, and pick them from the AI\'s player boxes. ReelBallers connects the dots for smooth motion, upscales your video, and builds a reel to share.';

export const CLIP_UPLOAD = {
  UPLOAD_CLIP: 'Upload clip',
  // T10300: uploads no longer come with a permanent "not linkable" consequence —
  // a directly-uploaded clip STARTS unlinked but can be linked to a game later
  // from the Clips tab (POST /api/clips/raw/{id}/link). The notice now states the
  // starting state and the recovery path instead of the old "won't be part of a
  // game" absolute. "Framing" is MODE_NAMES.FRAMING (a noun, never a verb); curly
  // apostrophes match this file's existing convention; no em dashes.
  NOTICE_TITLE: 'Heads up: these clips start out unlinked from a game',
  NOTICE_BODY:
    `Uploading here adds videos straight to your clips, ready for ${MODE_NAMES.FRAMING} and publish. `
    + 'You can link a clip to a game at any time from the Clips tab so it shows up '
    + 'with that game’s highlights.',
  NOTICE_CONTINUE: 'Continue',
  NOTICE_CANCEL: 'Cancel',
  // T10250: over-cap pre-flight dialog. The MB number is DERIVED from the
  // server-provided cap (configStore.maxClipUploadBytes) — there is no `500`
  // literal here; this sentence mirrors the backend refusal in
  // games_upload.py so the two never drift.
  SIZE_LIMIT_TITLE: 'This clip is too large to upload',
  sizeLimitBody: (mb) =>
    `Clip uploads are limited to ${mb}MB. For longer footage, use Add Game instead.`,
  SIZE_LIMIT_ADD_GAME: 'Add Game instead',
  SIZE_LIMIT_CANCEL: 'Cancel',
  // T10250: non-retryable server refusals surfaced verbatim on the rail (no
  // Retry). Keyed on the clip-batch error codes (clips.py upload_clips_batch);
  // `duration_exceeds_cap` is parameterized by the server duration cap
  // (configStore.maxClipDurationS) so, again, no minutes literal is hardcoded.
  refusalMessage: (code, { durationMinutes } = {}) => {
    switch (code) {
      case 'duration_exceeds_cap':
        return durationMinutes
          ? `This clip is longer than the ${durationMinutes}-minute limit. For longer footage, use Add Game instead.`
          : 'This clip is longer than the allowed limit. For longer footage, use Add Game instead.';
      case 'probe_failed':
        return "We couldn't read this video. Make sure it's a valid MP4, MOV, or WebM file.";
      case 'source_missing':
        return "We couldn't find the uploaded video. Please pick the file and add it again.";
      case 'insufficient_credits':
        return "You don't have enough credits to add this clip.";
      default:
        return 'This clip could not be added.';
    }
  },
};

// T10300: link/unlink an uploaded clip to a game (the recovery path promised by
// CLIP_UPLOAD.NOTICE_BODY). Only surfaced on tiles whose clip.source === 'upload'
// (a game-cut clip can never be relinked; the backend 409s it). Single source for
// the tile action labels + the game-picker modal copy. No em dashes; curly
// apostrophes match this file's convention.
export const CLIP_LINK = {
  LINK_TO_GAME: 'Link to game',       // tile action + picker title, unlinked clip
  unlinkFrom: (name) => (name ? `Unlink from ${name}` : 'Unlink from game'),
  PICKER_TITLE: 'Link this clip to a game',
  PICKER_SUBTITLE: 'The clip shows up with that game’s highlights.',
  PICKER_SEARCH_PLACEHOLDER: 'Search games',
  PICKER_EMPTY: 'You don’t have any games yet. Upload a game first, then link this clip to it.',
  PICKER_NO_MATCH: 'No games match your search.',
  CANCEL: 'Cancel',
  // Success toasts confirm the re-grouping the user just triggered.
  linkedToast: (name) => (name ? `Clip linked to ${name}` : 'Clip linked to game'),
  UNLINKED_TOAST: 'Clip unlinked from game',
  // 409: a non-upload clip somehow reached the link endpoint. Should never happen
  // (the affordance is upload-gated), but surface it instead of swallowing it.
  ERROR_NOT_UPLOAD: 'Only uploaded clips can be linked to a game.',
  ERROR_GENERIC: "Couldn't update this clip's game. Please try again.",
  clipCount: (n) => `${n} clip${n === 1 ? '' : 's'}`,
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
  SAVED: 'Saved',
  FAILED: 'Upload failed',
  LOCAL_PREVIEW_NOTICE: 'Local preview - not saved online yet',
  RETRY_UPLOAD: 'Retry upload',
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
// Focus stage NOUN is MODE_NAMES.FRAMING (T9860 renamed the mode noun off the render
// engine to "Framing"); the render VERB is "Generate", deliberately NOT "Apply": "Apply Framing"
// (T9330) is a DIFFERENT gesture that NAVIGATES INTO the mode, so reusing it here would
// confuse entering the mode with paying to render inside it. Completion is exactly
// "Framing ready".
export const EXPORT_JOBS = {
  framing: {
    action: `Generate ${MODE_NAMES.FRAMING}`,          // N19 — render CTA, was "Export Focused Video"
    inProgress: `Generating ${MODE_NAMES.FRAMING}...`, // N19 — progress/job label, was "Creating reel..."
    completed: `${MODE_NAMES.FRAMING} ready`,          // N21 — names the stage that finished, was "Export Complete"
    jobNoun: MODE_NAMES.FRAMING,                       // job-list row noun, was "Framing Export"
  },
  overlay: {
    action: 'Export clip with effects',       // N20 — render CTA, was "Add Spotlight"
    inProgress: 'Exporting clip...',          // N20
    completed: 'Clip ready',                  // N21
    jobNoun: 'Effects',                        // job-list row noun, was "Overlay Export"
    // Q1 (approved): the effects render charges ZERO credits (backend-confirmed: no
    // reserve_credits in overlay.py). Surface that honestly instead of staying silent.
    costNote: 'No credits · effects are free',
  },
};

// N37 — export PROGRESS vocabulary. Honest user copy that replaces engineering strings
// ("Detecting players", "frame 150/180", "Processing frames..."). Mapped from the backend
// `phase` (see utils/exportProgressPresentation.js); counters stay as OPTIONAL detail.
export const EXPORT_PROGRESS = {
  PREPARING: 'Preparing video',                // init/queued/validating/downloading
  UPLOADING: 'Uploading',                      // upload
  RENDERING: 'Rendering',                      // processing/modal_processing/rendering/analyzing
  ENHANCING: 'Enhancing video',                // upscaling/ai_upscale (T9860 3.3: put the AI claim where the AI runs)
  FINDING_PLAYERS: 'Finding players for spotlight', // detecting_players
  // T9900: honest "unavailable estimate" fallback — shown instead of a blank slot or a
  // frozen/fabricated countdown when no live ETA is trustworthy (too little data yet, or
  // the estimate broke its own promise). The real stage line still shows alongside it.
  ETA_VARIES: 'Time remaining varies.',
};

// T8390 / re-hierarchized T9590: Focus's post-export publish-exit action bar
// (FocusPublishActionBar). T9590 (2026-09-10) DELIBERATELY REVERSES T8390's flat
// four-equal-weight layout (and the 2026-09-08 "Publish Now"/"Add Spotlight Now"
// pairing that supported it) into a three-level hierarchy + a quiet Save-draft --
// product owner decision, recorded with the conflict at filing:
//   PRIMARY   Add spotlight             (dominant; opens the Spotlight editor, no export)
//   SECONDARY Publish without spotlight (publishes the framed reel as-is)
//   TERTIARY  Edit framing              (back into Framing; the paid re-export path)
//   QUIET     Save draft                (defer; replaces the old "Add Spotlight Later",
//                                        whose spotlight-framed destination is gone)
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
export const FOCUS_PUBLISH = {
  ADD_SPOTLIGHT_LABEL: 'Add spotlight',
  SPOTLIGHT_CAPTION: STAGE_REASONS.SPOTLIGHT,
  PUBLISH_LABEL: 'Publish without spotlight',
  PUBLISH_CAPTION: `Files it under Published as is. ${STAGE_REASONS.PUBLISH}`,
  EDIT_FRAMING_LABEL: 'Edit framing',
  EDIT_FRAMING_CAPTION: 'Reframe and export again, uses credits.',
  SAVE_DRAFT_LABEL: 'Save draft',
  // T9870: retention honesty. The framing render already saved this as a private
  // draft (see RESULT_RETENTION note above the grid) -- this link only leaves the
  // flow, it is NOT what keeps the work. Say "it's already yours", not "save it now".
  SAVE_DRAFT_CAPTION: 'It is already saved to your drafts. Pick it up whenever you want.',
};

// T8390: "Add Spotlight Later" toast copy, routed by is_auto_created (T8360 split).
export const FOCUS_PUBLISH_LATER_TOAST = {
  SINGLE_CLIP: {
    title: 'Saved to Clips',
    message: 'Clips are single plays. A highlight reel joins several clips into one video. '
      + 'Yours is still a draft, so add a spotlight or publish it from here whenever you want.',
  },
  MULTI_CLIP: {
    title: `Saved to ${SECTION_NAMES.REELS}`,
    message: 'A highlight reel joins several clips into one video. Single plays stay in Clips. '
      + 'Yours is still a draft, so add a spotlight or publish it from here whenever you want.',
  },
};

// 2026-09-08: "Add Spotlight Now" confirmation toast (product owner: every
// FocusPublishActionBar choice should confirm what happened + what's next,
// same as the existing Add Spotlight Later toast above). Short, since the
// user isn't leaving the flow -- they land straight in Overlay right after.
export const FOCUS_ADD_SPOTLIGHT_TOAST = {
  title: 'Framing saved',
  message: 'Now add a spotlight to your reel -- you can still publish it whenever you\'re ready.',
};

// T9110 / re-hierarchized T9590: Overlay's post-export publish-exit action bar
// (OverlayPublishActionBar). T9590 re-hierarchizes IN LOCKSTEP with FOCUS_PUBLISH
// above (REVERSES T9110's flat four-equal-weight mirror). On THIS screen the
// spotlight is already applied, so the promoted forward action is Publish (Focus
// promotes "Add spotlight" instead -- the hierarchy tracks pipeline position, not
// a fixed action):
//   PRIMARY   Publish           (dominant; the reel is finished)
//   SECONDARY Reapply spotlight (back into Spotlight editing)
//   TERTIARY  Reapply Framing   (reframe; the paid re-export path)
//   QUIET     Save draft        (defer; replaces the old "Publish Later")
// PUBLISH_CAPTION states the destination + the honest precondition BEFORE the tap.
// T9670 §4, live-verified by T9710 (2026-09-13): publishing moves the reel to
// Published and creates no link and grants no audience by itself -- sharing a
// link is a second, separate gesture (T9860 D5). REAPPLY_FOCUS_CAPTION keeps the
// honest "uses credits" warning, verbatim with Focus's so the two read as one
// system.
export const OVERLAY_PUBLISH = {
  PUBLISH_LABEL: 'Publish',
  PUBLISH_CAPTION: `Files it under Published. ${STAGE_REASONS.PUBLISH}`,
  REAPPLY_OVERLAY_LABEL: 'Reapply spotlight',
  REAPPLY_OVERLAY_CAPTION: 'Go back and redo the spotlight on your reel.',
  REAPPLY_FOCUS_LABEL: `Reapply ${MODE_NAMES.FRAMING}`,
  REAPPLY_FOCUS_CAPTION: 'Reframe and export again, uses credits.',
  SAVE_DRAFT_LABEL: 'Save draft',
  // T9870: retention honesty. The finished highlight is ALREADY saved and watchable
  // (see RESULT_RETENTION note above the grid) -- this link only leaves the flow, it
  // is not what keeps the reel. Publish stays a separate, deliberate choice.
  SAVE_DRAFT_CAPTION: 'It is already saved and only you can see it. Publish whenever you are ready.',
};

// T9870: the post-export retention reassurance shown ABOVE each completion action
// grid. AC1 ("completion is durably retrievable without a redundant Save-draft
// step"): the backend finalizer already persisted the result at export completion,
// so the completion surface must SAY the work is safe -- leaving with zero extra
// clicks is fine. Composed entirely from shipped T9860 vocabulary (draftStage.js
// DRAFT_STATUS / DRAFT_STAGE_LABELS), never new product wording. The AC4 guard
// lives in the deriver (resultRetentionNote.js): an already-published reel gets the
// PUBLISHED line and is never told "only you can see it".
export const RESULT_RETENTION = {
  // Overlay completion: a FINAL video exists -> private and ready to watch.
  PRIVATE_READY: 'Saved. Private and ready to watch, only you can see it.',
  // Focus completion: a framing WORKING video exists -> saved, still a draft.
  PRIVATE_DRAFT: 'Saved to your drafts. Only you can see it.',
  // Either completion, when the reel is already published (re-export of a shared
  // reel): never claim "only you can see it", never imply a visibility change.
  PUBLISHED: 'Saved. This reel is already published, its link is unchanged.',
};

// T9110: "Reapply Framing" confirmation toast. Mirrors FOCUS_ADD_SPOTLIGHT_TOAST's
// reasoning (product owner, 2026-09-08): a choice that moves the user into
// ANOTHER edit mode has no other confirmation their prior work was saved, so it
// gets a toast. Honest that the spotlight carries over the Framing re-export
// (highlight carry-forward, T4350/T4355) and that a fresh export follows.
export const OVERLAY_REAPPLY_FOCUS_TOAST = {
  title: 'Spotlight saved',
  message: `Reframe your clip in ${MODE_NAMES.FRAMING}, then export again, your spotlight carries over to the new reel.`,
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
export const EDITOR_PANELS = {
  // N17 -- the crop primitive is a "focus point"; its timeline track is the
  // "Framing timeline". "crop keyframe" stays only in advanced help/tooltips.
  FOCUS_POINT: 'Focus point',
  FRAMING_TIMELINE: 'Framing timeline',
  // N29 -- spotlight styling. "Highlight Color" mixed brand + generic for one thing:
  // the spotlight. The shape options say WHERE the spotlight sits vs the player.
  SPOTLIGHT_COLOR: 'Spotlight color',
  SPOTLIGHT_AROUND_PLAYER: 'Around athlete', // was "Body" / "Body ellipse"
  SPOTLIGHT_UNDER_PLAYER: 'Under athlete',   // was "Ground" / "Ground spotlight"
  // N30 -- styling sliders in plain words; the component keeps the live px/% readout.
  OUTLINE_THICKNESS: 'Outline thickness',   // was "Stroke Width"
  SPOTLIGHT_FILL: 'Spotlight fill',         // was "Fill"
  DIM_BACKGROUND: 'Dim background',          // was "Outside Dim"
  // N31 -- the share still is a "Cover image"; the timeline marker CHOOSES its frame.
  COVER_IMAGE: 'Cover image',                // was "Thumbnail"
  CHOOSE_COVER_FRAME: 'Choose cover frame',  // was "Thumbnail marker"
  COVER_IMAGE_HELPER: 'The still people see before playing.',
  // T9620 (UX-10) -- the spotlight editor leads with PICKING YOUR PLAYER, not the
  // styling controls. These name that primary task (stated on screen, never a
  // tooltip) and gate the styling copy behind it. The word "player" keeps the
  // detection COUNTS unmistakable as counts, not jersey identities.
  SELECT_PLAYER_TITLE: 'Pick your athlete',
  SELECT_PLAYER_CLICK: 'Click your athlete to add a spotlight',
  SELECT_PLAYER_TAP: 'Tap your athlete to add a spotlight',
  SELECT_PLAYER_FIND: 'Tap a green marker on the timeline to find your athlete',
  SELECT_PLAYER_STYLING_HINT: 'Spotlight color, shape, and dimming appear once you pick a player.',
  // T9960 (EP05) -- one athlete SATISFIES the step; picking more is optional, never
  // implied as required. Replaces the old "N of M players selected -- click the
  // remaining players to spotlight each too" progress line, which read as an
  // all-player instruction. SELECT_PLAYER_OPTIONAL reassures (pre-selection) that
  // Spotlight never blocks reaching the framed result.
  SELECT_PLAYER_DONE: 'Your player is selected.',
  SELECT_PLAYER_ADD_MORE: 'Add another only if you want to highlight more than one.',
  SELECT_PLAYER_OPTIONAL: 'Spotlight is optional -- you can publish the framed result without it.',
  // T9960 -- surface the (already adjustable) effect interval as its own primary
  // readout, with the advanced styling controls kept secondary below it. The
  // interval is adjusted by dragging the region ends on the timeline and previewed
  // with Play spotlight -- this names it, it does not add a new default timing.
  SPOTLIGHT_DURATION: 'Spotlight duration',
  SPOTLIGHT_DURATION_HINT: 'Drag the ends on the timeline to adjust, or press Play spotlight to preview.',
  // T9950 -- segment/speed/trim + straighten/dim/zoom collapse behind one
  // disclosure; the timeline row and the settings-rail heading share this word
  // so the collapse reads as one concept (design doc §5 Slice 1).
  ADVANCED_EDITING: 'Advanced editing',
  // T9950 Slice 2 -- the widen button is an EDIT to the focus points, not a view
  // toggle (design doc §3). Copy names what the control DOES, never a quality
  // claim (design doc §3.5: "Do not promise crispness from resolution alone").
  WIDER_FRAME: 'Use a wider frame',
  WIDER_FRAME_ON: 'Back to default frame',
  WIDER_FRAME_HELPER: 'Shows more of the field around your focus points.',
  UNDO: 'Undo',
  UNDO_NOTHING: 'Nothing to undo',
  // T9950 Slice 3 -- preview approximation disclosure (design doc §4). Exact for
  // crop/timing/format/audio; approximate for image quality and multi-clip
  // concatenation. Never a sharpness claim in either direction.
  PREVIEW_HIGHLIGHT: 'Preview highlight',
  PREVIEW_BACK_TO_FRAMING: 'Back to framing',
  PREVIEW_DISCLOSURE: 'Preview shows your framing, timing and format. Final image quality is produced at export.',
  PREVIEW_MULTI_CLIP_DISCLOSURE: 'Previewing this clip. Your clips are joined at export.',
};

// T9480 -- single source for the billing-rule copy, verbatim from
// BuyCreditsModal's shipped T9750 wording (round-HALF-UP, NOT ceil). Every
// disclosure surface reads from here so the copy cannot drift from what's
// actually charged (creditStore.roundCreditsHalfUp / getRequiredCredits).
export const CREDITS = {
  PER_SECOND_RULE: '1 credit per second, rounded to the nearest second',
  MIN_CHARGE: 'Any render costs at least 1 credit.',
  billableLine: (exactSeconds, credits) =>
    `${formatLength(exactSeconds, PRECISION.TENTH)} of video · ${credits} credit${credits === 1 ? '' : 's'} · ${CREDITS.PER_SECOND_RULE}.`,
};

// Retention, stated as the three distinct outcomes confirmed in the T9680
// decision record (never "everything survives" or "everything is lost"). The
// public landing site states the same three facts. No em dashes.
// - SOURCE: game_storage row + raw R2 object, kept 30 days, extendable.
// - EXPORTED: final_videos survive source expiry, no cascade, free to store.
// - DRAFT: an un-exported draft has no independent source copy (T4130), so it
//   stays visible but becomes un-editable / un-exportable once its source is gone.
export const RETENTION = {
  SOURCE: 'Your uploaded game is kept for 30 days, and you can extend it anytime.',
  EXPORTED: 'Reels you export are kept for good and are free to store.',
  DRAFT: 'An unexported draft stays viewable, but you need its source to re-edit or export it, so finish the ones you want to keep before the 30 days are up.',
};
