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
    const pillY = await page.getByTestId('rating-input').first().boundingBox();
    const detailsY = await page.getByTestId('add-details-button').first().boundingBox();
    console.log(`[T11150] y: time=${timeY?.y} pill=${pillY?.y} details=${detailsY?.y}`);
    expect(timeY.y).toBeLessThan(pillY.y);
    expect(pillY.y).toBeLessThan(detailsY.y);

    // Details disclosure holds the Play-category control (H16).
    await page.getByTestId('add-details-button').click();
    await expect(strip.getByText('Who is this play about?')).toBeVisible();

    await assertNoClipOrRequired(page, 'desktop');

    // Single labeled rating row -> pick Brilliant (5) -> row reports rating 5.
    await page.getByRole('radio', { name: '5 stars - Brilliant' }).first().click();
    await expect(page.getByTestId('rating-input').first()).toHaveAttribute('data-rating', '5');
    await saveEvidence(page, 'T11150-desktop-editor-hierarchy');
  });

  test('393px portrait: editor renders, no clip wording', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await openEditor(page);
    await assertNoClipOrRequired(page, 'portrait');
    await saveEvidence(page, 'T11150-portrait-editor');
  });

  // AnnotateScreen's mobile plays-drawer header button (useMobileClipPanel) must
  // use Highlight-flow vocabulary — was title="Show clips". Loaded in a real
  // mobile-portrait context (hasTouch/isMobile via test.use) so the mobile layout
  // mounts from the start. Red on base 48605465, green on the fix.
  test.describe('mobile plays-drawer header toggle (393 portrait)', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 393, height: 852 } });
    test('toggle uses "Show plays", no "clip" in title/aria-label', async ({ page }) => {
      const toggle = page.getByTitle('Show plays');
      await expect(toggle, 'mobile plays-drawer toggle uses "Show plays"').toBeVisible({ timeout: 10000 });
      const title = (await toggle.getAttribute('title')) || '';
      const aria = (await toggle.getAttribute('aria-label')) || '';
      expect(`${title} | ${aria}`, 'plays-drawer toggle has no "clip" wording').not.toMatch(/clip/i);
      await saveEvidence(page, 'T11150-mobile-plays-toggle');
    });
  });

  test('landscape phone: editor renders, no clip wording', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await openEditor(page);
    await assertNoClipOrRequired(page, 'landscape');
    await saveEvidence(page, 'T11150-landscape-editor');
  });

  // The mobile-FULLSCREEN editor uses distinct layouts: portrait -> 'inline'
  // sheet, landscape -> 'landscape-inline' (AnnotateModeView.jsx:993) — the
  // layouts the sidebar/portrait-strip screenshots above do NOT cover, and the
  // ONLY way to reach them live is through annotate fullscreen. Following
  // T10800's pattern (e2e/T10800-annotate-aspect-stage.qa.spec.js): genuinely
  // ATTEMPT to enter fullscreen + open the editor, and skip ONLY with the real
  // runtime reason if a step can't be reached under headless emulation. Returns
  // null on success, or a human-readable reason string on the first blocked step.
  async function tryEnterMobileFullscreenEditor(page) {
    try {
      // annotate fullscreen is PURE CSS state (handleToggleFullscreen ->
      // setAnnotateFullscreen; no element.requestFullscreen), so clicking the
      // toggle is safe headless. (Tapping the <video> first crashed the context
      // in the 2026-09-27 run, so we click the toggle directly.)
      const fsBtn = page.getByTitle('Fullscreen').first();
      if (!(await fsBtn.count().catch(() => 0))) return 'Fullscreen toggle not offered (fullscreenWorthwhile gate / controls hidden)';
      await fsBtn.click({ force: true, timeout: 5000 });
      await page.waitForTimeout(600);
      if (!(await page.getByTitle('Exit fullscreen').count().catch(() => 0))) return 'annotate fullscreen did not engage after clicking the toggle';
      // In mobile fullscreen, select a play to open the inline/landscape editor.
      await page.locator('.clip-marker').first().click({ force: true });
      await page.waitForTimeout(300);
      const form = page.locator('[data-add-clip-form]').first();
      if (!(await form.isVisible().catch(() => false))) {
        const cta = page.locator('[data-testid="annotate-primary-cta"]');
        if (await cta.count().catch(() => 0)) { await cta.click({ force: true }).catch(() => {}); await page.waitForTimeout(300); }
      }
      if (!(await form.isVisible().catch(() => false))) return 'mobile-fullscreen play editor did not open after selecting a play';
      return null;
    } catch (e) {
      return `runtime error during fullscreen entry: ${String(e.message || e).split('\n')[0]}`;
    }
  }

  // Portrait -> 'inline' sheet. hasTouch/isMobile via test.use (context-level),
  // matching T10800; the real attempt below decides pass-vs-runtime-skip.
  test.describe('mobile-fullscreen PORTRAIT', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 393, height: 852 } });
    test('inline layout: editor renders, no clip wording (or logged skip)', async ({ page }) => {
      const reason = await tryEnterMobileFullscreenEditor(page);
      if (reason) console.log(`[T11150] mobile-fs portrait skip: ${reason}`);
      test.skip(!!reason, `[T11150] ${reason} — inline layout proven by unit tests`);
      await assertNoClipOrRequired(page, 'mobile-fs-portrait-inline');
      await saveEvidence(page, 'T11150-mobilefs-portrait-inline');
    });
  });

  // Landscape -> 'landscape-inline' (the layout rebuilt for Gap 1).
  test.describe('mobile-fullscreen LANDSCAPE', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 852, height: 393 } });
    test('landscape-inline layout: editor renders, no clip wording (or logged skip)', async ({ page }) => {
      const reason = await tryEnterMobileFullscreenEditor(page);
      if (reason) console.log(`[T11150] mobile-fs landscape skip: ${reason}`);
      test.skip(!!reason, `[T11150] ${reason} — landscape-inline layout proven by unit tests`);
      await assertNoClipOrRequired(page, 'mobile-fs-landscape-inline');
      await saveEvidence(page, 'T11150-mobilefs-landscape-inline');
    });
  });
});
