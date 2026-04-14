/**
 * T1490 E2E: no clip /stream request may return 401 during project load.
 *
 * Before the fix, extractVideoMetadataFromUrl creates a detached <video>
 * without crossOrigin, so the browser issues a no-cors probe that strips
 * the session cookie → backend 401 → silent browser retry → 206. This test
 * listens for all /stream responses during project load and asserts none
 * of them are 401.
 *
 * NOTE: This test requires a logged-in user with at least one project that
 * has clips. The existing E2E suite does not yet expose a reusable fixture
 * for "logged-in + project with clips" (see game-loading.spec.js for the
 * closest pattern — it uploads+ingests TSV each run). Until such a fixture
 * lands (or we wire this into full-workflow.spec.js), this test is marked
 * test.skip with a reason. The assertions are written and ready to run.
 */
import { test, expect } from '@playwright/test';

const API_PORT = 8000;
const API_BASE = `http://localhost:${API_PORT}/api`;

// TODO(T1490): replace skip with real fixture — upload a test video, ingest
// TSV to create a project + clips, then navigate to annotate/framing mode.
test.describe('T1490 stream 401 regression', () => {
  test.skip(
    true,
    'Requires logged-in user with project+clips fixture; enable once E2E '
    + 'helper for authenticated project state exists (see game-loading.spec.js pattern).',
  );

  test('no /stream request returns 401 during project load', async ({ page }) => {
    const streamResponses = [];
    page.on('response', (resp) => {
      const url = resp.url();
      if (/\/stream(\?|$)/.test(url)) {
        streamResponses.push({ url, status: resp.status() });
      }
    });

    // Fixture setup would go here — login + navigate to a project that has
    // clips. For now the skip above prevents this from running.
    await page.goto('/');
    // Placeholder: wait for the clip list to render + videoMetadata probes
    // to fire. Actual selector depends on the fixture.
    await page.waitForTimeout(5000);

    const four01s = streamResponses.filter((r) => r.status === 401);
    expect(
      four01s,
      `Expected zero 401s on /stream, got ${four01s.length}: ${JSON.stringify(four01s)}`,
    ).toEqual([]);

    // Sanity: we should have observed at least one /stream response during
    // project load (otherwise the test is not actually exercising the path).
    expect(streamResponses.length, 'no /stream responses observed').toBeGreaterThan(0);
  });
});
