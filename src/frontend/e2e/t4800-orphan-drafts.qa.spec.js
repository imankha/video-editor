/**
 * T4800 live-drive QA — Reel Drafts must not show 0-clip orphan drafts.
 *
 * Drives the REAL app (real backend, local FFmpeg disabled — pure DB) against a
 * fixed test-login user whose profile SQLite was seeded out-of-band (see the
 * task's QA notes) with three scenarios:
 *   A "Exported Draft A"   — auto-reel draft + source clip + UNPUBLISHED final video
 *   B "Zero Clip Orphan B" — a project with a final video but NO source clips (orphan)
 *   C "Published Reel C"   — auto-reel + source clip + PUBLISHED final video
 *
 * Asserts on the RENDERED Reel Drafts UI (not just API):
 *   criterion-b: the 0-clip orphan B never renders; A and C do.
 *   criterion-a: deleting A's clip removes its exported reel — no 0-clip orphan lingers.
 *   criterion-2: deleting C's clip preserves the PUBLISHED reel (stays in My Reels).
 */
import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';

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
  await page.waitForLoadState('networkidle');
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

test('Reel Drafts hides 0-clip orphans; clip-delete drops exported draft but keeps published reel', async ({ page }) => {
  test.setTimeout(120_000);
  await authenticate(page);

  // Ensure we are on the Reel Drafts tab (defaults there when projects exist).
  await page.locator('[data-testid="project-card"]').first().waitFor({ timeout: 15000 });

  // --- criterion-b: 0-clip orphan never renders; A and C do -----------------
  let names = await renderedDraftNames(page);
  console.log('[qa] rendered drafts (initial):', JSON.stringify(names));
  expect(hasCard(names, 'Exported Draft A'), 'exported draft A should render').toBe(true);
  expect(hasCard(names, 'Published Reel C'), 'published-reel draft C should render').toBe(true);
  expect(hasCard(names, 'Zero Clip Orphan B'), '0-clip orphan B must NOT render').toBe(false);
  await saveEvidence(page, 'criterion-b-feed-hides-0clip-orphan');

  // --- criterion-a: delete A's clip -> exported reel gone, no orphan --------
  const delA = await page.request.delete(`${API}/clips/raw/1`, { headers: HEADERS });
  expect(delA.ok(), `delete clip A: ${delA.status()}`).toBe(true);
  await page.reload();
  await page.waitForLoadState('networkidle');
  names = await renderedDraftNames(page);
  console.log('[qa] rendered drafts (after deleting A clip):', JSON.stringify(names));
  expect(hasCard(names, 'Exported Draft A'), 'exported draft A must be gone (deleted, not orphaned)').toBe(false);
  expect(hasCard(names, 'Zero Clip Orphan B'), 'no 0-clip orphan may appear').toBe(false);
  expect(hasCard(names, 'Published Reel C'), 'published draft C still present pre-delete').toBe(true);
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

  // Reel Drafts is now empty (A deleted, C published+clipless -> filtered out).
  await page.reload();
  await page.waitForLoadState('networkidle');
  names = await renderedDraftNames(page);
  console.log('[qa] rendered drafts (final):', JSON.stringify(names));
  expect(hasCard(names, 'Published Reel C'), 'clipless published reel must not render as a draft').toBe(false);
  await saveEvidence(page, 'criterion-2-published-reel-preserved');
});
