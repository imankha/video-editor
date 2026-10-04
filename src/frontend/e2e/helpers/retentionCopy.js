// Single source for the retention-note copy the e2e specs assert against.
//
// Why these are literals and not imported from src/config/displayNames.js:
// displayNames transitively imports src/backend/app/pricing.json (via
// utils/storageCost -> config/pricing), and Playwright's ESM loader rejects a
// bare JSON import ("needs an import attribute of type json"), so a spec that
// imports displayNames fails to load. Vitest runs under Vite and CAN import it,
// so src/config/retentionCopy.contract.test.jsx pins each literal below equal to
// the live UPLOAD.*_RETENTION_NOTE constant. That contract runs in the frontend
// unit CI job, so a production copy change fails CI loudly (Branch CI does NOT
// run Playwright -- see CLAUDE.md T11210) and this file is the one place to fix.
export const GAME_RETENTION_NOTE = 'Your game video is kept for 30 days.';
export const ATTACH_RETENTION_NOTE = 'This video is kept for 30 days.';
export const FOOTAGE_RETENTION_NOTE = 'This footage is kept for 30 days.';
