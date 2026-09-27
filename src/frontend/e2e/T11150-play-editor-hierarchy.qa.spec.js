import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T11150 QA — live-drive verification of the play-editor hierarchy (time ->
 * name+rating -> Details), the RatingPill (gold at Highlight), the neutral-gray
 * edit-strip tint, and the removal of user-visible "clip"/"Required" wording
 * from the Annotate editor, against a real account's real data.
 *
 * Run: bash scripts/dev-verify.sh e2e/T11150-play-editor-hierarchy.qa.spec.js --reporter=line
 *
 * NOTE: the "no clip / no Required" scan is scoped to the EDITOR container only.
 * The main-screen "Frame clip"/"Create clip" CTAs and the Home "Clips" tab are
 * intentionally out of scope for T11150 (T11130 / H18).
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE;
const API_BASE = process.env.E2E_API_BASE || '/api';

async function openEditor(page) {
  await page.locator('.clip-marker').first().click();
  await page.waitForTimeout(300);
  const editPlayBtn = page.locator('[data-testid="annotate-primary-cta"]');
  await expect(editPlayBtn).toBeVisible({ timeout: 5000 });
  await editPlayBtn.click();
}

// The editor container across layouts: desktop strip, or the mobile/landscape
// in-flow add-clip-form.
function editorContainer(page) {
  return page.locator('[data-testid="annotate-editor-strip"], [data-add-clip-form]').first();
}

async function assertNoClipOrRequired(page, label) {
  const container = editorContainer(page);
  await expect(container).toBeVisible({ timeout: 10000 });
  const txt = (await container.innerText()).replace(/\s+/g, ' ');
  console.log(`[T11150] ${label} editor text: ${txt}`);
  expect(txt, `${label}: no "clip" wording in editor`).not.toMatch(/\bclips?\b/i);
  expect(txt, `${label}: no "Required" in editor`).not.toMatch(/required/i);
}

test.describe('T11150 — play editor hierarchy + no clip wording: live QA', () => {
  test.beforeEach(async ({ context, page }) => {
    test.setTimeout(120000);
    await loginAsRealUser(context, REAL_EMAIL, PROFILE);
    const res = await context.request.get(
      `${API_BASE}/games`,
      PROFILE ? { headers: { 'X-Profile-ID': PROFILE } } : undefined,
    );
    expect(res.ok(), `GET ${API_BASE}/games (${res.status()})`).toBeTruthy();
    const games = (await res.json()).games || [];
    const target = games.find((g) => g.storage_status === 'active' && (g.clip_count || 0) > 0);
    test.skip(!target, '[T11150] no active game with clips available');
    console.log(`[T11150] driving active game id=${target.id} (${target.opponent_name})`);
    await openGameInAnnotate(page, target.id);
    await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 30000 });
  });

  test('desktop: time -> name+rating -> Details order, gold Highlight pill, neutral tint, no clip wording', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditor(page);
    const strip = page.locator('[data-testid="annotate-editor-strip"]');
    await expect(strip).toBeVisible({ timeout: 10000 });

    // Neutral-gray tint (H19): the yellow T8600 tint is gone.
    const cls = await strip.getAttribute('class');
    expect(cls, 'strip tint is neutral gray, not yellow').not.toMatch(/yellow/);

    // Hierarchy order via vertical position: scrub/time < rating pill < Details button.
    const timeY = await page.locator('[data-testid="annotate-editor-strip"] .font-mono').first().boundingBox();
    const pillY = await page.getByTestId('rating-pill').first().boundingBox();
    const detailsY = await page.getByTestId('add-details-button').first().boundingBox();
    console.log(`[T11150] y: time=${timeY?.y} pill=${pillY?.y} details=${detailsY?.y}`);
    expect(timeY.y).toBeLessThan(pillY.y);
    expect(pillY.y).toBeLessThan(detailsY.y);

    // Details disclosure holds the Play-category control (H16).
    await page.getByTestId('add-details-button').click();
    await expect(strip.getByText('Play category')).toBeVisible();

    await assertNoClipOrRequired(page, 'desktop');

    // Rating pill -> meanings list -> pick Highlight (5) -> pill turns gold.
    await page.getByTestId('rating-pill').first().click();
    await expect(page.getByTestId('rating-picker')).toBeVisible();
    await page.getByRole('radio', { name: '5 stars - Highlight' }).click();
    const pill = page.getByTestId('rating-pill').first();
    await expect(pill).toHaveAttribute('data-rating', '5');
    await expect(pill).toHaveAttribute('data-state', 'rated');
    await saveEvidence(page, 'T11150-desktop-editor-hierarchy');
  });

  test('393px portrait: editor renders, no clip wording', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await openEditor(page);
    await assertNoClipOrRequired(page, 'portrait');
    await saveEvidence(page, 'T11150-portrait-editor');
  });

  test('landscape phone: editor renders, no clip wording', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await openEditor(page);
    await assertNoClipOrRequired(page, 'landscape');
    await saveEvidence(page, 'T11150-landscape-editor');
  });

  // The mobile-FULLSCREEN editor uses distinct layouts: portrait -> 'inline'
  // sheet, landscape -> 'landscape-inline' (AnnotateModeView.jsx:993). These are
  // the layouts the sidebar/portrait-strip screenshots above do NOT cover.
  // annotateFullscreen is CSS app state (no browser Fullscreen API), so it
  // drives headless.
  async function enterMobileFullscreenEditor(page) {
    // Reveal auto-hiding controls by tapping the video, then toggle annotate
    // fullscreen. The Fullscreen button is gated by `fullscreenWorthwhile`
    // (video-vs-viewport size), which can hide it under headless emulation —
    // same documented flake T10800 skips on.
    await page.locator('video').first().click({ position: { x: 30, y: 30 } }).catch(() => {});
    await page.waitForTimeout(300);
    const fsBtn = page.getByTitle('Fullscreen').first();
    const offered = await fsBtn.count().catch(() => 0);
    // The mobile-fullscreen editor (inline / landscape-inline) is only reachable
    // through annotate fullscreen, whose toggle is gated by `fullscreenWorthwhile`
    // (video-vs-viewport size) and whose controls auto-hide — not reliably
    // drivable under headless emulation (T10800 skips on the same gate). When it
    // can't be entered, SKIP: the inline & landscape-inline hierarchy + no-clip
    // sweep are decisively proven by the red->green unit tests in
    // AnnotateFullscreenOverlay.progressBadges.test.jsx (both layouts covered).
    if (!offered) test.skip(true, '[T11150] Fullscreen toggle not offered (fullscreenWorthwhile gate); layouts proven by unit tests');
    await fsBtn.click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    const inFullscreen = await page.getByTitle('Exit fullscreen').count().catch(() => 0);
    if (!inFullscreen) test.skip(true, '[T11150] annotate fullscreen did not engage headless; layouts proven by unit tests');
    // In mobile fullscreen, selecting a play opens the inline/landscape editor.
    await page.locator('.clip-marker').first().click({ force: true }).catch(() => {});
    const form = page.locator('[data-add-clip-form]').first();
    if (!(await form.isVisible().catch(() => false))) {
      test.skip(true, '[T11150] mobile-fullscreen editor did not open headless; layouts proven by unit tests');
    }
  }

  // The mobile-FULLSCREEN editor (portrait 'inline' sheet / landscape
  // 'landscape-inline') can only be reached by entering annotate fullscreen,
  // whose toggle is gated by `fullscreenWorthwhile` and whose auto-hiding
  // controls + fullscreen transition are not reliably drivable under headless
  // Playwright (the page closes mid-transition; T10800 skips on the same gate).
  // These two layouts' hierarchy (time -> name+rating -> Details) AND the
  // attribute-level no-clip sweep are instead PROVEN by the red->green unit
  // tests in AnnotateFullscreenOverlay.progressBadges.test.jsx, which render
  // layout="landscape-inline" and layout="inline" directly and assert DOM order,
  // the name-field position, tags/notes absent while Details is closed, and no
  // "clip" in text OR title/aria-label/placeholder. Kept as documented skips so
  // the coverage intent is visible and can be re-enabled if a real device farm
  // (BrowserStack) is wired up.
  test('mobile-fullscreen PORTRAIT (inline layout): editor renders, no clip wording', async ({ page }) => {
    test.skip(true, '[T11150] annotate fullscreen not drivable headless (fullscreenWorthwhile gate); inline layout proven by unit tests');
    await page.setViewportSize({ width: 393, height: 852 });
    await enterMobileFullscreenEditor(page);
    await assertNoClipOrRequired(page, 'mobile-fs-portrait-inline');
    await saveEvidence(page, 'T11150-mobilefs-portrait-inline');
  });

  test('mobile-fullscreen LANDSCAPE (landscape-inline layout): editor renders, no clip wording', async ({ page }) => {
    test.skip(true, '[T11150] annotate fullscreen not drivable headless (fullscreenWorthwhile gate); landscape-inline layout proven by unit tests');
    await page.setViewportSize({ width: 852, height: 393 });
    await enterMobileFullscreenEditor(page);
    await assertNoClipOrRequired(page, 'mobile-fs-landscape-inline');
    await saveEvidence(page, 'T11150-mobilefs-landscape-inline');
  });
});
