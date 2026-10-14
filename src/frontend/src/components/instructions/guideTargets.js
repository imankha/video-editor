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
};

export const GUIDE_PULSE_CLASS = 'coach-target-pulse';
