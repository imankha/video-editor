/**
 * Global Teardown for Playwright E2E Tests
 *
 * Cleans up test user data directories older than 24 hours.
 * Test directories are named: user_data/test_YYYYMMDD_HHMMSS_random/
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USER_DATA_DIR = path.resolve(__dirname, '../../../user_data');
const MAX_AGE_HOURS = 24;

export default async function globalTeardown() {
  console.log('\n[Teardown] Cleaning up old test directories...');

  if (!fs.existsSync(USER_DATA_DIR)) {
    console.log('[Teardown] No user_data directory found');
    return;
  }

  const entries = fs.readdirSync(USER_DATA_DIR, { withFileTypes: true });
  const now = Date.now();
  const maxAgeMs = MAX_AGE_HOURS * 60 * 60 * 1000;
  let cleaned = 0;

  for (const entry of entries) {
    // Only clean up test_* directories
    if (!entry.isDirectory() || !entry.name.startsWith('test_')) {
      continue;
    }

    const dirPath = path.join(USER_DATA_DIR, entry.name);
    const stats = fs.statSync(dirPath);
    const ageMs = now - stats.mtimeMs;

    if (ageMs > maxAgeMs) {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        console.log(`[Teardown] Removed old test directory: ${entry.name}`);
        cleaned++;
      } catch (err) {
        console.warn(`[Teardown] Failed to remove ${entry.name}: ${err.message}`);
      }
    }
  }

  if (cleaned > 0) {
    console.log(`[Teardown] Cleaned up ${cleaned} old test directories`);
  } else {
    console.log('[Teardown] No old test directories to clean');
  }
}
