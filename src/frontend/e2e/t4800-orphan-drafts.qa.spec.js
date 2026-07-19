/**
 * T4800 live-drive QA — deleting a clip drops its dead auto-reel draft (root cause).
 *
 * T4800 is fixed at the ROOT: `_delete_auto_project` removes an auto-reel draft when
 * its LAST source clip is deleted (unless the reel is published). There is deliberately
 * NO read-time `clip_count == 0` filter and NO client guard — a 0-clip draft appearing
 * would be a visible signal that a producer was missed, not something to hide.
 *
 * Drives the REAL app (real backend, pure DB) against a fixed test-login user whose
 * profile SQLite was seeded out-of-band (see the task's QA notes) with:
 *   A "Exported Draft A" — auto-reel draft + source clip (id 1) + UNPUBLISHED final video
 *   C "Published Reel C" — auto-reel + source clip (id 2) + PUBLISHED final video
 *
 * Asserts on the RENDERED Reel Drafts UI + downloads API:
 *   criterion-a: deleting A's clip DELETES its exported draft (not orphaned) — gone from feed.
 *   criterion-2: deleting C's clip PRESERVES the published reel in My Reels (downloads).
 */
import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';
import { IS_DEPLOYED_TARGET } from './helpers/targetEnv.js';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
const API = process.env.E2E_API_BASE || 'http://localhost:8000/api';
const USER = 't4800_livedrive';
const HEADERS = { 'X-User-ID': USER, 'X-Test-Mode': 'true' };

async function authenticate(page) {
  // Header-only test-mode auth (NO test-login cookie): every request carries
  // X-User-ID, so the backend resolves this user's own seeded profile. Calling
  // test-login would mint a session cookie for the SHARED e2e user and route the
  // app to a different (polluted) profile — so we only bypass the frontend gate.
  await page.setExtraHTTPHeaders(HEADERS);
  await page.goto(BASE);
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 't4800_livedrive@test.local', showAuthModal: false });
  });
  await page.reload();
  // The caller waits on the concrete `[data-testid="project-card"]` locator next,
  // so committing the navigation is enough here (T5400: no networkidle).
  await page.waitForLoadState('domcontentloaded');
}

/** Names of the project cards currently rendered in Reel Drafts. */
async function renderedDraftNames(page) {
  await page.waitForTimeout(500); // let the drafts feed settle after (re)fetch
  const cards = page.locator('[data-testid="project-card"]');
  const n = await cards.count();
  const names = [];
  for (let i = 0; i < n; i++) names.push((await cards.nth(i).innerText()).replace(/\s+/g, ' ').trim());
  return names;
}

function hasCard(names, label) {
  return names.some((t) => t.includes(label));
}

test('clip-delete drops the exported auto-reel draft (root cause) and keeps published reels', async ({ page }) => {
  test.setTimeout(120_000);
  await authenticate(page);

  // Ensure we are on the Reel Drafts tab (defaults there when projects exist).
  await page.locator('[data-testid="project-card"]').first().waitFor({ timeout: 15000 });

  // The exported draft A renders before we touch anything.
  let names = await renderedDraftNames(page);
  console.log('[qa] rendered drafts (initial):', JSON.stringify(names));
  expect(hasCard(names, 'Exported Draft A'), 'exported draft A should render initially').toBe(true);
  await saveEvidence(page, 'criterion-a-before-delete');

  // --- criterion-a: delete A's clip -> its exported reel is DELETED, not orphaned ---
  const delA = await page.request.delete(`${API}/clips/raw/1`, { headers: HEADERS });
  expect(delA.ok(), `delete clip A: ${delA.status()}`).toBe(true);
  await page.reload();
  // LOCAL-only QA spec: renderedDraftNames reads the drafts feed straight from the
  // DOM with no per-card wait, so it genuinely needs the feed fetch to settle after
  // reload to avoid a false "card gone" read. networkidle never settles on a deployed
  // CDN (T5400) — but this spec's seeded profile data only exists locally, so it never
  // runs deployed. Gate the settle to local so we never leave a bare networkidle.
  if (!IS_DEPLOYED_TARGET) await page.waitForLoadState('networkidle');
  names = await renderedDraftNames(page);
  console.log('[qa] rendered drafts (after deleting A clip):', JSON.stringify(names));
  expect(hasCard(names, 'Exported Draft A'), 'exported draft A must be gone (deleted, not left as a 0-clip orphan)').toBe(false);
  await saveEvidence(page, 'criterion-a-exported-reel-deleted-no-orphan');

  // --- criterion-2: delete C's clip -> published reel preserved -------------
  const delC = await page.request.delete(`${API}/clips/raw/2`, { headers: HEADERS });
  expect(delC.ok(), `delete clip C: ${delC.status()}`).toBe(true);

  // Published reel survives in My Reels (downloads), independent of its source clip.
  const dl = await page.request.get(`${API}/downloads`, { headers: HEADERS });
  expect(dl.ok(), `downloads: ${dl.status()}`).toBe(true);
  const downloads = await dl.json();
  const filenames = (downloads.downloads || []).map((d) => d.filename);
  console.log('[qa] downloads after deleting C clip:', JSON.stringify(filenames));
  expect(filenames.includes('fvC.mp4'), 'published reel fvC.mp4 must survive clip delete').toBe(true);
  await saveEvidence(page, 'criterion-2-published-reel-preserved');
});
