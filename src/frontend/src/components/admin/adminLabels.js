import { MODE_NAMES } from '../../config/displayNames';

// T17270: the admin panel speaks the parent's vocabulary. Logged screen slugs
// (BREADCRUMB_SCREENS in app/analytics.py) and analytics step labels are
// internal names; these maps turn them into the step names parents see.

const SCREEN_NAMES = {
  'project-manager': 'Home',
  annotate: MODE_NAMES.ANNOTATE,
  framing: MODE_NAMES.FRAMING,
  overlay: MODE_NAMES.SPOTLIGHT,
  admin: 'Admin',
};

/** Parent-facing name of a logged screen slug; an unknown slug shows as logged. */
export function screenName(slug) {
  return SCREEN_NAMES[slug] || slug;
}

// Backend last-step labels (FLOW_EVENTS in app/analytics.py) are funnel keys and
// stay as stored; only their display changes here.
const STEP_NAMES = {
  'Focus Opened': `Opened ${MODE_NAMES.FRAMING}`,
  'Focus Exported': 'Sharpened',
  'Overlay Exported': 'Spotlighted',
};

export function stepName(label) {
  return STEP_NAMES[label] || label;
}

const DATE_TIME = { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' };

/** One admin date format, in the viewer's local time: "Nov 17, 2026, 5:25 PM". */
export function formatAdminDateTime(iso) {
  return new Date(iso).toLocaleString('en-US', DATE_TIME);
}

export const TEST_SIGN_IN_NOTE = 'Test sign-in, sessions not tracked';
