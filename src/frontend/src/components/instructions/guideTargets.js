/**
 * T12730: the names a guide rule uses for the ONE control its sentence tells the user to press.
 * Pure (no React): resolveGuide.js imports it, and so do the controls that opt in to pulsing,
 * so grepping GUIDE_PULSE.X finds both the sentence and the control. Value = the control's
 * data-testid where it has one. TRIM_* keep their pre-T12730 values because index.css still
 * keys `trim-guide-pulse` off them (that mechanism is replaced later in Epic F).
 */
export const GUIDE_PULSE = {
  MARK_PLAY: 'annotate-mark-play-button',
  PORTRAIT_SLOT: 'annotate-highlight-slot-portrait',
  UPLOAD_GAME: 'home-upload-game',
  FIRST_GAME: 'home-first-game',
  TAB_PUBLISHED: 'home-tab-published',
  CROP_BOX: 'focus-crop-box',
  PLAY: 'play-button',
  PREVIEW: 'framing-preview-toggle',
  EXPORT: 'primary-cta',
  TRIM_TRACK: 'split',
  TRIM_ADJUST: 'adjust',
  PICK_BOX: 'pick-box-pulse',
  CHOICE_NOW: 'highlight-choice-now',
  PLAY_EDITOR_DONE: 'play-editor-done',
  SHARE_PLAYS: 'annotate-share-plays',
  HIGHLIGHT_SLOT: 'annotate-highlight-slots',
  FIRST_PLAY: 'annotate-first-play',
  UPLOAD_SUBMIT: 'upload-submit',
  UPLOAD_RETRY: 'upload-retry',
  FIRST_CLIP: 'home-first-clip',
  FIRST_FINISHED: 'home-first-finished',
  FOCUS_ADD_SPOTLIGHT: 'focus-choice-primary',
  OVERLAY_FINISH: 'overlay-choice-primary',
  GET_LINK: 'finished-get-link',
  SHARE_SUBMIT: 'share-modal-submit',
};

export const GUIDE_PULSE_CLASS = 'coach-target-pulse';
