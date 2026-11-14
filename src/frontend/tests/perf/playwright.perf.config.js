import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET = process.env.PERF_TARGET || 'prod';
const TARGETS = {
  prod: 'https://app.reelballers.com',
  staging: 'https://reel-ballers-staging.pages.dev',
  dev: 'http://localhost:5173',
};
const baseURL = TARGETS[TARGET] || TARGETS.prod;
const authStatePath = path.join(__dirname, '.auth', 'state.json');

if (!fs.existsSync(authStatePath)) {
  console.warn(`\n  No auth state at ${authStatePath}`);
  console.warn('  Run: node tests/perf/setup-auth.js\n');
}

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  outputDir: path.join(__dirname, 'results', 'artifacts'),
  use: {
    baseURL,
    storageState: fs.existsSync(authStatePath) ? authStatePath : undefined,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 720 },
    actionTimeout: 15_000,
  },
  projects: [{ name: 'perf', use: {} }],
});
