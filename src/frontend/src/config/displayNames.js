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
  PLAYS_HEADING: 'Plays',                  // N06 — sidebar list heading
  // N07 — create-an-editable-clip toggle. Positive polarity both states (T9450):
  // ON produces a clip, OFF just saves the play. Never a "Don't …" double negative.
  CREATE_EDITABLE_CLIP: 'Create an editable clip',
  JUST_SAVE_PLAY: 'Just save this play',
  SAVE_PLAY_AND_CLIP: 'Save play and create clip', // N08 — save + produce a clip
  CREATE_CLIP: 'Create clip',              // N09 — manual create-clip action
  CLIP_CREATED: 'Clip created',            // N09 — created indicator (T10410: the clip badge's done label)
  // T10410 (2026-09-18 user request, Option C of the decision artifact): the
  // four play-progress badges beside the play name. Done/undone pairs share one
  // noun each so the badge reads the same either way ("Play rated" / "Rate this
  // play"). "Note" (not "description") is the field's existing label, kept for
  // consistency per the user's ruling.
  PLAY_RATED: 'Play rated',
  // T10690: the rated badge's unset copy — reuses BADGE_STATE.UNDONE's amber
  // dashed treatment (no new badge state; see PlayProgressBadges.RatingBadge).
  // Replaces the old generic RATE_PLAY prompt now that "no rating yet" is a
  // real, persisted state rather than a create-form transient.
  PLAY_NOT_RATED: 'Not rated yet',
  // T10550: the rating popup's own visible heading (+ its accessible name, so
  // they match) — layer-aware like `getRatingCaption`'s existing `mine` split,
  // so a Team play never claims to be "your athlete's".
  RATE_ATHLETES_PLAY: "Rate your athlete's play",
  RATE_TEAMS_PLAY: "Rate your team's play",
  PLAY_NAMED: 'Play named',
  NAME_PLAY: 'Name this play',
  NOTE_ADDED: 'Note added',
  ADD_NOTE: 'Add a note',
  // The clip badge's 5-star nudge (edit mode: creates the clip in place; create
  // mode: saves the play and creates the clip in one gesture) and its dormant
  // hover copy below 5 stars.
  CREATE_CLIP_NUDGE_HINT: '5 stars! Create a clip',
  SAVE_AND_CREATE_CLIP_NUDGE_HINT: '5 stars! Save the play and create a clip',
  CLIP_BADGE_DORMANT_HINT: 'Rate the play 5 stars to create a clip',
  DELETE_CLIP: 'Delete clip',              // N14 — delete a play that has a clip
  DELETE_PLAY: 'Delete play',              // N14 — delete a bare play marker
  RENAME_CLIP: 'Rename clip',              // N15 — rename action
  CLIP_NAME: 'Clip name',                  // N15 — name field
  // T10610: the play editor's sole close affordance now that there is no
  // Save/Update button — commits any dirty text field first (closeWithCommit),
  // then closes. Nothing is ever discarded.
  DONE: 'Done',
  PREVIEW_PLAYS: 'Review plays',           // N26 — playback-all button (was "Playback Annotations"/"Preview plays")
  PREVIEW_CLIP: 'Preview clip',            // N26 — per-clip preview (unchanged)
  LAYER_LABEL: 'Play category',            // N28 — the control formerly "Clip layer"/"Layer"
  LAYER_MINE: 'My athlete',                // N28, reversed by T9860 (2026-09-14)
  LAYER_TEAM: 'Team',                      // N28 — unchanged
  // N41 (T9580) — the first-clip invitation after a saved play. FRAME_THIS_CLIP
  // is the FOCUS-stage primary CTA (single-sourced into clipStage.getClipStage,
  // so the desktop strip and the sidebar share it); KEEP_MARKING_PLAYS is its
  // dismiss secondary (closes the editor, playhead preserved). Later stages keep
  // their T9320/T9330 labels (Apply Spotlight / View Final / View Published).
  // 2026-09-18 (user request): shortened from "Frame this clip" to "Frame" —
  // the timeline strip's Edit play/Frame pairing already frames it as an
  // action on the currently-selected clip; no need to repeat "this clip".
  FRAME_THIS_CLIP: 'Frame',                // N41 — FOCUS-stage primary CTA
  // 2026-09-18 (user request): rollover on the Frame this clip button, using
  // ALREADY-APPROVED copy -- the Clips-tab guidance body (T10280, the user's
  // own words, 2026-09-17) is the one place the app explains what Framing
  // does; this reuses its "what Framing does" sentence verbatim.
  FRAME_THIS_CLIP_HINT: 'Framing focuses the camera on your player and lets you trim and add slo-mo to key moments.',
  KEEP_MARKING_PLAYS: 'Keep marking plays', // N41 — invitation dismiss secondary
  // T10240 (N42): the Framing-entry action. "Frame" is the VERB form of the
  // Framing mode (MODE_NAMES.FRAMING = 'Framing', T9860) — deliberately NOT
  // the old "Focus" mode name, and NOT the noun "Framing" (which would read
  // "Framing clip"). FRAME_CLIP pairs with CREATE_CLIP as the two NO_PROJECT
  // stage actions (create-only vs create-and-open-Framing, T10240).
  // T10610: SAVE_AND_FRAME (the editor's create-then-open-Framing outcome)
  // is retired — there is no save gesture left to attach it to.
  FRAME_CLIP: 'Frame clip',                // N42 — NO_PROJECT create + open Framing
  // T10450 (2026-09-18 user request): the T10310 main-screen row's NO_PROJECT
  // case splits FRAME_CLIP into two explicit outcomes instead of one button
  // that always both creates and navigates. "Frame Now" is FRAME_CLIP's old
  // behavior (create the project, then open Framing); "Frame Later" creates
  // the project WITHOUT navigating — the play becomes an editable clip, left
  // for a later Framing pass (same create call as clipStage's NO_PROJECT
  // "create" action, `navigate: false`). A play that already has a project
  // keeps the single existing stage-CTA button (Frame/Apply Spotlight/View
  // Final/View Published) — this split applies ONLY before a clip exists.
  FRAME_NOW: 'Frame Now',              // N43 — NO_PROJECT create + open Framing immediately
  FRAME_LATER: 'Frame Later',          // N43 — NO_PROJECT create only, stays in Annotate
  FRAME_LATER_HINT: 'Save this play as an editable clip. Frame it whenever you are ready.',
  // T10290: the details disclosure label (was the inline literal "Add details",
  // then just "Details", then "Rate and Tag", then "Notes and Tags"). T10620:
  // back to "Details" — the portrait strip moved category/teammates/Delete play
  // behind this same disclosure, so "Notes and Tags" undersold what it holds
  // (and produced the redundant "Notes and Tags (note)" suffix below).
  // The count suffix (e.g. "Details (2 tags, note)") is composed at the call
  // site when content exists.
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
// as the reason. T9860 aliased FOCUS_PUBLISH.SPOTLIGHT_CAPTION to SPOTLIGHT;
// T10670 broke that alias (the Focus completion tile now has its own short caption)
// so SPOTLIGHT stands alone as the Spotlight-mode reason line. Declared here (near
// MODE_NAMES) rather than at the file's end because FOCUS_PUBLISH and OVERLAY_PUBLISH
// below both read PUBLISH as part of their publish captions.
// T10310 (2026-09-18 user request): MARK_PLAY ("You are bookmarking, not
// editing...") was dropped -- the Annotate primary CTA area no longer shows a
// stage-reason line, only the capture-window mechanic sentence.
export const STAGE_REASONS = {
  FRAMING: 'Focus the action on your player, crop out everything else.',
  SPOTLIGHT: 'Twenty-two kids in the same kit: this is how anyone watching knows which one is yours.',
  PUBLISH: 'Nobody else can see this until you share a link.',
};

// T10180 (design doc §3.1): the private-result-surface publish -> visibility-
// review -> link-ready vocabulary, single source. Policy-checked against the
// T9670 audience contract: publishing alone grants no audience; a link is
// CREATED, never sent/emailed/watched. "Update shared version" (item 4) is
// deliberately absent -- split to its own follow-up task (T10860).
export const RESULT_PUBLISH = {
  // Idle primary action -- starts the review flow, does NOT publish yet.
  PUBLISH_GET_LINK: 'Publish and get link',
  // Visibility-review confirm card.
  REVIEW_TITLE: (name) => `Publish "${name}"?`,
  REVIEW_BODY: 'Anyone with the link can watch. Publishing creates a link; it does not send it.',
  REVIEW_CANCEL: 'Cancel',
  REVIEW_CONFIRM: 'Publish and create link',
  // Busy + failure (reuse existing amber copy for the retry banner; this is the actionBar label).
  PUBLISHING: 'Publishing...',
  // Link-ready success state.
  LINK_READY: 'Link ready',
  COPY_LINK: 'Copy link',
  SHARE_LINK: 'Share link...',   // coarse-pointer native share entry
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
// the single source the tab bar and EmptyTabGuide's partial-variant aria-label
// read from (T10280 deleted the flow strip that also read it); "Published"
// sitting next to "Reels" is what reads the middle two as in-progress, so status
// lives per item, never in the tab name.
export const SECTION_NAMES_SHORT = {
  GAMES: 'Games',
  CLIPS: 'Clips',
  REELS: 'Reels',
  PUBLISHED: 'Published',
};

// T10280 (2026-09-17): UPLOAD_ENTRY_HINT (the T9640 one-line game-vs-clip
// distinction shown beneath each populated Games/Clips upload entry) was DELETED.
// The populated Games/Clips tabs now render the same centered EMPTY_TAB_GUIDE
// headline + body block (via TabGuideHeader) above their CTA, so the standalone
// hint caption is redundant. The game-vs-clip distinction now lives in the Clips
// tab's body copy ("A short clip can also skip straight to Framing, no game
// needed.") in config/emptyStates.js.

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
  // T10310 (2026-09-18 user request): the SAME over-cap refusal, but caught only
  // AFTER an upload attempt (the pre-flight gate above is skipped while
  // maxClipUploadBytes hasn't hydrated yet — see ProjectManager's null guard), so
  // there is no File left in hand to auto-carry into Add Game. Surfaced as its own
  // popup (not just the inert rail row, which is easy to miss) with the concrete
  // click-path instead of an auto-action button.
  POST_UPLOAD_TOO_LARGE_TITLE: 'This clip is too large for Clips',
  postUploadTooLargeBody: (mb) =>
    `Clip uploads are limited to ${mb}MB. Click Games, then click ${LIBRARY_ACTIONS.UPLOAD_GAME} to add this as a full game instead.`,
  POST_UPLOAD_TOO_LARGE_DISMISS: 'Got it',
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
    action: 'Apply Overlay',                   // render CTA (T10970, 2026-09-21); was "Export", before that "Export clip with effects" (N20) and "Add Spotlight"
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
  TITLE: 'This export is too big to finish in time',
  WHY:
    'Every frame is upscaled on our video processor, and this batch needs more GPU time '
    + 'than one job can finish before it times out. Rather than run for the full limit and '
    + 'then fail, we stopped it now so you can trim it down.',
  WHAT_TO_DO_HEADING: 'To get it through, try one of these:',
  SUGGESTION_CROP: 'Crop in tighter on the clip(s) below, a smaller crop is much faster to process.',
  // Shown only for a multi-clip rejection (>1 contributing clip); it isn't actionable for a
  // single clip (the /render path also hits this guard with a one-element list, T11330 minor 2).
  SUGGESTION_SPLIT: 'Export fewer clips at once, or split this batch into two smaller exports.',
  CONTRIBUTORS_HEADING: 'Biggest contributors',
  // A single worst-offender row: "Clip 3, 1920x1080 crop, about 6 min".
  contributorLine: (c) => {
    const label = c.clip_name || `Clip ${(c.clip_index ?? 0) + 1}`;
    const crop = c.crop_width && c.crop_height ? `${c.crop_width}x${c.crop_height} crop, ` : '';
    return `${label}, ${crop}${formatApproxMinutes(c.estimated_gpu_seconds)}`;
  },
  CREDIT_NOTE: 'Credits reserved for this export have been refunded. This attempt cost you nothing.',
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
// row with a one-word "Saved" chip (RESULT_RETENTION below) in place of the green
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
// ("Framing ready") stays the toast/job-row string. No em dashes anywhere.
export const FOCUS_PUBLISH = {
  HEADLINE: 'Your clip is ready',
  ADD_SPOTLIGHT_LABEL: 'Add spotlight',
  SPOTLIGHT_CAPTION: 'Point out your athlete to everyone watching.',
  PUBLISH_LABEL: 'Publish without spotlight',
  PUBLISH_CAPTION: `Goes to Published. ${STAGE_REASONS.PUBLISH}`,
  EDIT_FRAMING_LABEL: 'Edit framing',
  EDIT_FRAMING_CAPTION: 'Reframe and export again. Uses credits.',
  SAVE_DRAFT_LABEL: 'Done for now',
};

// T10650: Focus's "Back to Preview" affordance. When the current framing is
// already rendered, the primary CTA reopens that render instead of paying to
// re-render byte-identical framing (mode 'preview'); once framing changes, the
// same label survives as a secondary ghost link beside "Generate Framing" so the
// previous render stays reachable. No em dashes in this copy.
export const FOCUS_PREVIEW = {
  BACK_TO_PREVIEW_LABEL: 'Back to Preview',
  NO_CREDITS_NOTE: 'No credits needed',
  // Prefixes a rendered-at timestamp in the left status cell, e.g. "Rendered 3:14 PM".
  RENDERED_PREFIX: 'Rendered',
  // Shown (loud, never a silent re-render) when the working-video URL cannot resolve.
  LOAD_FAILED: 'Could not load your preview. Please try again.',
};

// T10840: the landscape-phone "cockpit" layout — edge-rail labels, sheet titles,
// and the two rotation hints (D14). Kept here so the parent-facing copy is
// single-sourced, matching the rest of the editor vocabulary.
export const FOCUS_COCKPIT = {
  // Zone A / D rail button labels (10px, under a Lucide icon).
  BACK: 'Back',
  CLIPS: 'Clips',
  SETUP: 'Setup',
  UNDO: 'Undo',
  PREVIEW: 'Preview',
  // Compact CTA, two 10px lines (D9 / D13).
  GENERATE_LINE_1: 'Generate',
  GENERATE_LINE_2: 'Framing',
  BACK_TO_PREVIEW_LINE_1: 'Back to',
  BACK_TO_PREVIEW_LINE_2: 'Preview',
  // Zone E sheet titles.
  SHEET_CLIPS: 'Clips',
  SHEET_SETUP: 'Setup',
  SHEET_TRIM: 'Trim and slo-mo',
  CLOSE_SHEET: 'Close',
  // Timeline strip caps (D10).
  ADD_FOCUS_POINT: 'Add focus point',
  OPEN_TRIM: 'Trim and slo-mo',
};

// T10850 (design D14): the two discovery hints that bracket the landscape flip.
// Copy lives here (T9550 single-source rule), parent-facing vocabulary — "focus
// point", never "keyframe". The icons are Lucide, inline, aria-hidden.
export const FOCUS_HINTS = {
  // Portrait nudge — a slim bar directly under the stage, shown while the clip
  // still has no focus points. Dismissed by its 44px X (a named gesture).
  ROTATE_TITLE: 'Turn sideways for a bigger frame',
  ROTATE_SUBTITLE: 'Twice the crop area, and nothing scrolls',
  ROTATE_DISMISS: 'Dismiss',
  // Landscape first-entry card — shown once, over the stage, on the first
  // cockpit entry. Dismissed by "Got it" or the first touch on the stage.
  COCKPIT_INTRO_TITLE: 'More room in landscape',
  COCKPIT_INTRO_BODY: 'Playback is on the left now, Generate on the right.',
  COCKPIT_INTRO_CONFIRM: 'Got it',
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
  HEADLINE: 'Your clip is ready',
  PUBLISH_LABEL: 'Publish',
  PUBLISH_CAPTION: `Goes to Published. ${STAGE_REASONS.PUBLISH}`,
  REAPPLY_OVERLAY_LABEL: 'Reapply spotlight',
  REAPPLY_OVERLAY_CAPTION: 'Go back and redo the spotlight.',
  REAPPLY_FOCUS_LABEL: `Reapply ${MODE_NAMES.FRAMING}`,
  REAPPLY_FOCUS_CAPTION: 'Reframe and export again. Uses credits.',
  SAVE_DRAFT_LABEL: 'Done for now',
};

// T9870 / T10670: the post-export retention reassurance, now rendered as a one-word
// CHIP beside the completion HEADLINE (T10670 replaced the green sentence above the
// grid -- the "your work is safe" reassurance is carried by the "Saved" chip plus the
// absence of any "Save" verb on the screen). AC1 still holds (leaving with zero extra
// clicks is fine); the AC4 guard still lives in the deriver (resultRetentionNote.js):
// an already-published reel gets the PUBLISHED chip and is never told "only you can
// see it". Composed from shipped draftStage vocabulary, never new product wording.
export const RESULT_RETENTION = {
  // Overlay completion: a FINAL video exists -> saved and ready to watch.
  PRIVATE_READY: 'Saved',
  // Focus completion: a framing WORKING video exists -> saved, still a draft.
  PRIVATE_DRAFT: 'Saved',
  // Either completion, when the reel is already published (re-export of a shared
  // reel): never imply a visibility change; the existing link is unchanged.
  PUBLISHED: 'Saved. Link unchanged',
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
  // T11020 -- full-spectrum custom picker + eyedropper, alongside the 5 presets.
  SPOTLIGHT_CUSTOM_COLOR: 'Custom color',
  SPOTLIGHT_MATCH_UNIFORM: 'Match color from uniform',
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
  // T9950 -- the timeline disclosure (segment/speed/trim track) and the
  // settings-rail heading (straighten/dim/zoom) USED to share one word
  // ("Advanced editing"); split 2026-09-18 per user request so the timeline
  // disclosure's label matches what it actually reveals.
  TRIM_AND_SLOWMO: 'Trim and Slo-mo',
  // 2026-09-18 (user request: rollover hints on every Framing-screen button).
  TRIM_AND_SLOWMO_HINT: 'Split this clip into segments, adjust playback speed, or trim the start and end.',
  // The settings-rail heading (straighten/dim/zoom) keeps this word --
  // unrelated to trim/slo-mo, so it was NOT renamed alongside the disclosure.
  ADVANCED_EDITING: 'Advanced editing',
  UNDO: 'Undo',
  UNDO_NOTHING: 'Nothing to undo',
  // T9950 Slice 3 -- preview approximation disclosure (design doc §4). Exact for
  // crop/timing/format/audio; approximate for image quality and multi-clip
  // concatenation. Never a sharpness claim in either direction.
  PREVIEW_HIGHLIGHT: 'Preview highlight',
  PREVIEW_BACK_TO_FRAMING: 'Back to framing',
  PREVIEW_DISCLOSURE: 'Preview shows your framing, timing and format. Final image quality is produced at export.',
  PREVIEW_MULTI_CLIP_DISCLOSURE: 'Previewing this clip. Your clips are joined at export.',
  // T10970 -- the Overlay timeline's Text lane sits behind a disclosure, the
  // same shape as TRIM_AND_SLOWMO above (user request 2026-09-21).
  TEXT_LANE: 'Text',
  TEXT_LANE_HINT: 'Add a title, name, or caption over the clip.',
  // T10980 -- the Focus clip rail's framing badge. Undone reuses ANNOTATE.FRAME_CLIP
  // as its name; these are the done label and the undone hover copy.
  CLIP_FRAMED: 'Framed',
  FRAME_CLIP_HINT: 'Not framed yet. Set a focus point on your athlete.',
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
  BACK_TO_GAME: 'Back to game plays',
};
