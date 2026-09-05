// T8770 synthetic repro config. Runs ONLY the *.fixture.js files in this folder.
// The onUnhandledError filter is applied unless FLAKE_REPRO_NO_FILTER=1, so the
// meta-test can exercise both the with-filter and the control (no-filter) cases
// against the exact handler that ships in vite.config.js.
import { defineConfig } from 'vite';
import { onUnhandledError } from '../../vitest.onUnhandledError.js';

const applyFilter = process.env.FLAKE_REPRO_NO_FILTER !== '1';

export default defineConfig({
  test: {
    // 'node' keeps these fixtures cheap; the product suite uses jsdom, but the
    // fixtures synthesize the flake-shaped unhandled rejection directly, so the
    // environment is immaterial to what the repro proves.
    environment: 'node',
    include: ['**/fixtures/*.fixture.js'],
    ...(applyFilter ? { onUnhandledError } : {}),
  },
});
