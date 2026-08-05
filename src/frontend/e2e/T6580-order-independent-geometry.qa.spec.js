/**
 * T6580 — the intro card must render IDENTICALLY regardless of the ORDER the user
 * clicks. Regression test for the reported bug: "the card looks different
 * depending on the order I click the aspect ratio and the 'on the card' buttons."
 *
 * Two independent order axes are pinned here, both in a REAL browser inside the
 * REAL modal box (jsdom cannot measure geometry — T5205/T5380 lesson):
 *
 *   1. FACT TICK ORDER (the actual root cause). Geometry slots are ORDINAL
 *      (fact{N} = the Nth entry of shown_fields), and shown_fields used to be
 *      built in CLICK order, so ticking the same facts in a different sequence
 *      laid them out on different lines. The fix rebuilds shown_fields in the
 *      canonical FACT_SLOTS order (IntroCardEditorContainer.toggleFact), so tick
 *      order no longer matters. Asserted with a fully-filled profile so every
 *      fact renders text.
 *
 *   2. ASPECT-vs-FACT ORDER (the supervisor's two leads: a ResizeObserver width
 *      feedback loop, and measureText font-timing). Both were disproven — the
 *      settled geometry is a pure function of (aspect, facts, viewport) — but the
 *      invariant is pinned here so a future regression (e.g. a box size that
 *      latches on first aspect) fails loudly.
 *
 * Driven through the dev-only /introcarddiag.html harness (real
 * IntroCardEditorContainer + Stage + Rail on real Zustand stores, network
 * stubbed), with the real webfonts routed from the backend assets so font-timing
 * is exercised, not stubbed away. Verified at desktop (1280) and 375px.
 *
 * Run: cd src/frontend && npx playwright test e2e/T6580-order-independent-geometry.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveEvidence } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

const HARNESS = '/introcarddiag.html';
const PREVIEW = '[data-composition]';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.resolve(__dirname, '../../backend/app/assets/fonts');

/** Serve the real webfonts (Anton / Oswald variable) so measureText runs against
 *  the same @font-face the production preview uses — the no-backend harness would
 *  otherwise fall back to system-ui and never exercise the font-timing lead. */
async function routeFonts(page) {
  await page.route(/\/api\/fonts\/fonts\.json(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: fs.readFileSync(path.join(FONT_DIR, 'fonts.json')) }));
  await page.route(/\/api\/fonts\/([A-Za-z0-9-]+\.ttf)(\?.*)?$/, (route) => {
    const m = route.request().url().match(/\/api\/fonts\/([A-Za-z0-9-]+\.ttf)/);
    route.fulfill({ status: 200, contentType: 'font/ttf',
      body: fs.readFileSync(path.join(FONT_DIR, m[1])) });
  });
}

/** Fill every fact on the mock profile so all three fact lines render text. */
async function fillProfile(page) {
  await page.evaluate(async () => {
    const { useProfileStore } = await import('/src/stores/index.js');
    useProfileStore.setState((s) => ({
      profiles: s.profiles.map((p) => ({
        ...p, position: 'Midfielder', class: 'Class of 2027', team: 'Riverside FC',
      })),
    }));
  });
}

/** Full rendered geometry, relative to the preview box (page-absolute position is
 *  irrelevant — the box is centred, so only internal geometry is compared). */
async function measure(page) {
  return page.evaluate(() => {
    const preview = document.querySelector('[data-composition]');
    const pr = preview.getBoundingClientRect();
    const img = preview.querySelector('img');
    const imgr = img ? img.getBoundingClientRect() : null;
    const spans = [...preview.querySelectorAll('span')].map((s) => {
      const r = s.getBoundingClientRect();
      const cs = getComputedStyle(s);
      return {
        text: (s.textContent || '').trim(),
        x: +(r.x - pr.x).toFixed(1), y: +(r.y - pr.y).toFixed(1),
        w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        fontSize: cs.fontSize, lineHeight: cs.lineHeight,
      };
    });
    return {
      composition: preview.getAttribute('data-composition'),
      box: { w: +pr.width.toFixed(1), h: +pr.height.toFixed(1) },
      img: imgr ? {
        x: +(imgr.x - pr.x).toFixed(1), y: +(imgr.y - pr.y).toFixed(1),
        w: +imgr.width.toFixed(1), h: +imgr.height.toFixed(1),
      } : null,
      spans,
    };
  });
}

const cb = (page, label) => page.locator('label', { hasText: label }).locator('input[type=checkbox]');
const setAspect = (page, label) => page.getByRole('button', { name: label, exact: true }).click();

async function open(page, width) {
  await page.setViewportSize({ width, height: 820 });
  await page.goto(HARNESS);
  await page.waitForSelector(PREVIEW);
  await fillProfile(page);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

test.describe('T6580 order-independent card geometry', () => {
  skipOnDeployedTarget(test, 'harness imports Vite-dev source; local only');
  test.beforeEach(async ({ page }) => { await routeFonts(page); });

  for (const width of [1280, 375]) {
    test(`@${width}: fact tick order does not change the layout`, async ({ page }) => {
      // Order A: Team then Class.
      await open(page, width);
      await cb(page, 'Team').check();
      await cb(page, 'Class').check();
      await page.waitForTimeout(400);
      const a = await measure(page);
      await saveEvidence(page, `tick-order-A-team-then-class-${width}`);

      // Order B (fresh): Class then Team — same set, different sequence.
      await open(page, width);
      await cb(page, 'Class').check();
      await cb(page, 'Team').check();
      await page.waitForTimeout(400);
      const b = await measure(page);
      await saveEvidence(page, `tick-order-B-class-then-team-${width}`);

      // Same three facts must land on the same lines regardless of click order.
      expect(a.composition).toBe('recruiting');
      expect(a.spans.map((s) => s.text)).toEqual(
        expect.arrayContaining(['Midfielder', 'Class of 2027', 'Riverside FC']),
      );
      expect(a).toEqual(b);
    });

    test(`@${width}: aspect-first vs facts-first render identically`, async ({ page }) => {
      // Facts first, then aspect.
      await open(page, width);
      await cb(page, 'Team').check();
      await cb(page, 'Class').check();
      await setAspect(page, '16:9');
      await page.waitForTimeout(400);
      const a = await measure(page);

      // Aspect first, then facts (fresh page).
      await open(page, width);
      await setAspect(page, '16:9');
      await cb(page, 'Team').check();
      await cb(page, 'Class').check();
      await page.waitForTimeout(400);
      const b = await measure(page);

      expect(a.composition).toBe('recruiting');
      expect(a.box).toEqual(b.box);      // no ResizeObserver width latch
      expect(a).toEqual(b);              // full geometry incl. font-driven metrics
    });
  }
});
