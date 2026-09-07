import { defineConfig } from 'vitest/config';

// Own config, deliberately not pointed at by the app's vite.config.js (Q6): this
// tool must never couple the app's test config to a folder it never imports from.
// jsdom has no WebCodecs/OPFS, so only pure modules (presets, cropScale geometry,
// checkpoint reducer) are unit-tested here; the rest is proven by qa/t8840-smoke.mjs
// against a real (headless) browser.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['pipeline/**/*.test.js'],
  },
});
