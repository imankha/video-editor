/**
 * T5290 — Recap player mobile redesign (portrait was a crushed desktop layout).
 *
 * Before: on a 390x844 phone the RecapPlayerModal rendered its desktop two-pane
 * layout — a fixed 256px clip sidebar beside the video — so the 16:9 recap was
 * crushed into a ~116x65px sliver in the top-right corner (measured, task file).
 *
 * After: on phones (< sm) the modal is full-bleed h-dvh and stacks vertically —
 * the video is full-width on top, the clip list drops below as a collapsible
 * pull-up (collapsed by default => immersive, video maximized). Landscape (>= sm)
 * and desktop keep the original side-by-side layout.
 *
 * This drives the REAL app as a real user (dev-login) and asserts geometry with
 * getBoundingClientRect at portrait / landscape / desktop, saving per-state
 * evidence.
 *
 * HONESTY CAVEAT: Playwright device emulation reproduces the layout math but not
 * iOS Safari's dynamic-toolbar (100vh vs 100dvh) chrome — the h-dvh shell can
 * only be fully confirmed on a real iPhone once this branch is on staging.
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, assertNoHorizontalOverflow } from './helpers/qa.js';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';
const PORTRAIT = { width: 390, height: 844 };   // iPhone 14 portrait
const LANDSCAPE = { width: 844, height: 390 };   // iPhone 14 landscape
const NARROW_DESKTOP = { width: 800, height: 700 }; // in the 640-1023px band
const DESKTOP = { width: 1280, height: 800 };

/** Read the NotesOverlay game-clock's computed `position` — 'absolute' means the
 *  original desktop pill layout is rendering; 'static' means the < sm inline row. */
async function clockPosition(page) {
  return page.evaluate(() => {
    // Anchor on the NotesOverlay pill by its distinctive white background so we
    // don't pick up the sidebar clip-list timestamps (same `8'58"` format) or the
    // playback-control markers. Return the pill clock's computed position.
    const overlay = [...document.querySelectorAll('.shadow-2xl div')]
      .find((d) => getComputedStyle(d).backgroundColor === 'rgba(255, 255, 255, 0.95)');
    if (!overlay) return null;
    const clock = [...overlay.querySelectorAll('span')]
      .find((s) => /^\d+['’]/.test(s.textContent.trim()));
    return clock ? getComputedStyle(clock).position : null;
  });
}

/** Open the recap player for the first annotated game (home defaults to Reel
 *  Drafts, so switch to the Games tab first). Resolves once the <video> is up. */
async function openRecap(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  // Home opens on Reel Drafts; the recap lives on the Games tab.
  await page.getByRole('button', { name: /^Games/ }).first().click();
  const recapBtn = page.getByRole('button', { name: 'Recap' }).first();
  await recapBtn.waitFor({ timeout: 30000 });
  await recapBtn.click();
  await page.locator('video').first().waitFor({ timeout: 30000 });
  // Best-effort: let the recap video report its intrinsic 16:9 dimensions so the
  // measured element width reflects the real layout (tolerated if R2 is slow).
  await page.locator('video').first().evaluate(
    (v) => new Promise((res) => {
      if (v.videoWidth > 0) return res();
      const done = () => res();
      v.addEventListener('loadedmetadata', done, { once: true });
      setTimeout(done, 8000);
    }),
  );
}

/** Measure the recap modal: shell + video element + the video's black area, and
 *  flag any visible element inside the modal spilling past the viewport edges. */
async function measure(page) {
  return page.evaluate(() => {
    const video = document.querySelector('video');
    const modal = video.closest('.shadow-2xl');
    const videoArea = video.parentElement; // the black flex-1 video column area
    const r = (el) => el.getBoundingClientRect();
    const iw = window.innerWidth, ih = window.innerHeight;

    // An element that lives inside a scroll/clip container legitimately extends
    // past the viewport (the container scrolls/clips it) — that is NOT a layout
    // spill. Only flag elements that are actually visible past the viewport edge.
    const clippedByAncestor = (el) => {
      for (let p = el.parentElement; p && p !== modal; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll|hidden)/.test(cs.overflowY + cs.overflowX)) return true;
      }
      return false;
    };
    const TOL = 3; // ignore sub-pixel / decorative (e.g. the 0-position playhead marker)
    const overflowers = [];
    for (const el of modal.querySelectorAll('*')) {
      const b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) continue; // skip collapsed/hidden
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (clippedByAncestor(el)) continue;
      if (b.right > iw + TOL || b.bottom > ih + TOL || b.left < -TOL) {
        overflowers.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 60),
          right: Math.round(b.right), bottom: Math.round(b.bottom), left: Math.round(b.left),
        });
      }
    }

    const mr = r(modal), vr = r(video), ar = r(videoArea);
    return {
      innerWidth: iw, innerHeight: ih,
      modal: { w: Math.round(mr.width), h: Math.round(mr.height), left: Math.round(mr.left), right: Math.round(mr.right) },
      video: { w: Math.round(vr.width), h: Math.round(vr.height), left: Math.round(vr.left), right: Math.round(vr.right), loaded: video.videoWidth > 0 },
      videoArea: { w: Math.round(ar.width), h: Math.round(ar.height) },
      overflowers,
    };
  });
}

test.describe('T5290 recap player mobile redesign', () => {
  test('portrait: full-width video, no overflow, immersive collapse', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: PORTRAIT, hasTouch: true, isMobile: true });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    await openRecap(page);
    const m = await measure(page);
    console.log('[T5290][portrait]', JSON.stringify(m));

    // The modal is full-bleed on a phone (owns the viewport width).
    expect(m.modal.w).toBeGreaterThanOrEqual(m.innerWidth - 2);

    // Core fix: the video AREA is full-width (>= 90% of the modal), NOT the old
    // ~116px corner sliver. When the media reports dimensions, the rendered
    // <video> element itself is full-width too.
    expect(m.videoArea.w).toBeGreaterThanOrEqual(m.modal.w * 0.9);
    if (m.video.loaded) {
      expect(m.video.w).toBeGreaterThanOrEqual(m.modal.w * 0.9);
    }

    // Nothing inside the modal spills off-screen (the fullscreen control used to).
    expect(m.overflowers, `overflowing elements: ${JSON.stringify(m.overflowers)}`).toEqual([]);
    await assertNoHorizontalOverflow(page);

    // Polish: the pill uses the < sm inline row (clock NOT absolute-positioned),
    // so the timestamp + name don't collide (`8'56" ! Good Control`).
    const pos = await clockPosition(page);
    if (pos) expect(pos).not.toBe('absolute');

    // Immersive default: the clip list opens collapsed (pull-up shows "Show").
    await expect(page.getByLabel('Show clip list')).toBeVisible();

    await saveEvidence(page, 'T5290-portrait-full-width-video');

    // Pull-up expands the clip list into its own scroll region; still no overflow.
    await page.getByLabel('Show clip list').click();
    await expect(page.getByLabel('Hide clip list')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'T5290-portrait-cliplist-expanded');

    await context.close();
  });

  test('landscape: side-by-side layout unchanged, no overflow', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: LANDSCAPE, hasTouch: true, isMobile: true });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    await openRecap(page);
    const m = await measure(page);
    console.log('[T5290][landscape]', JSON.stringify(m));

    // >= sm keeps the row layout: a 256px sidebar beside a flex-1 video, so the
    // video area is clearly narrower than the modal (sidebar takes ~256px).
    expect(m.videoArea.w).toBeLessThan(m.modal.w - 200);
    // The pull-up handle is a phones-only control (sm:hidden) — present in the
    // DOM but not visible at >= sm.
    await expect(page.getByLabel(/clip list/)).toBeHidden();
    expect(m.overflowers, `overflowing elements: ${JSON.stringify(m.overflowers)}`).toEqual([]);
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'T5290-landscape-sidebyside');

    await context.close();
  });

  test('narrow desktop band (640-1023px): desktop card + desktop pill layout', async ({ browser }) => {
    test.setTimeout(180_000);
    // useIsMobile() is true here (<=1023px), but the redesign switches at sm=640px.
    // Regression guard: the modal must show the DESKTOP card AND the NotesOverlay
    // must use the desktop (absolute-clock) pill — not the < sm inline row.
    const context = await browser.newContext({ viewport: NARROW_DESKTOP });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    await openRecap(page);
    const m = await measure(page);
    console.log('[T5290][narrow-desktop]', JSON.stringify(m));

    // Side-by-side card (sidebar ~256px), not the full-bleed phone stack.
    expect(m.videoArea.w).toBeLessThan(m.modal.w - 200);
    await expect(page.getByLabel(/clip list/)).toBeHidden();
    // The pill renders the desktop absolute-clock layout at >= sm (byte-identical).
    const pos = await clockPosition(page);
    if (pos) expect(pos).toBe('absolute');
    expect(m.overflowers, `overflowing elements: ${JSON.stringify(m.overflowers)}`).toEqual([]);
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'T5290-narrow-desktop-band');

    await context.close();
  });

  test('desktop: side-by-side card unchanged, no overflow', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: DESKTOP });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    await openRecap(page);
    const m = await measure(page);
    console.log('[T5290][desktop]', JSON.stringify(m));

    // Desktop card: 256px sidebar + flex-1 video, modal capped at max-w-6xl.
    expect(m.videoArea.w).toBeLessThan(m.modal.w - 200);
    expect(m.modal.w).toBeLessThan(m.innerWidth); // mx-4 card, not full-bleed
    await expect(page.getByLabel(/clip list/)).toBeHidden();
    expect(m.overflowers, `overflowing elements: ${JSON.stringify(m.overflowers)}`).toEqual([]);
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'T5290-desktop-sidebyside');

    await context.close();
  });
});
