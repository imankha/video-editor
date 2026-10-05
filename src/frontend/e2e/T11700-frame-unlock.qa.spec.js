/**
 * T11700/T11710/T11720 QA — Frame Highlight unlock, live-driven against a GENUINELY
 * UNFRAMED draft that this spec CREATES itself (so it does not depend on the shared
 * fixture happening to have a "Not started" draft, which it does not).
 *
 * How the unframed draft is made: saving a new raw clip in Annotate runs
 * `_create_auto_project_for_clip` (clips.py POST /raw/save), producing a Focus draft
 * with ZERO crop keyframes — exactly the 0-focus-point state the epic targets. The
 * created clip is deleted in afterEach (loud failure if cleanup fails) so no stray
 * data lingers in the shared dev account.
 *
 * Local-only (needs the Annotate upload/clip pipeline). On a deployed target that
 * pipeline may be unavailable, so this spec is NOT part of the staging gate; the
 * fixture-gated T8510/T4880 specs cover the deployed path and skip loudly.
 *
 * Run: bash scripts/dev-verify.sh e2e/T11700-frame-unlock.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { createUnframedDraft, deleteClip } from './helpers/annotateClips.js';
import { saveEvidence } from './helpers/qa.js';

// House standard for real-account QA specs that need seeded game/clip fixture
// data (T10780/T10810/T10820): the reference_dev_fixture_account, whose dev DB
// carries the 9 seeded games (incl. game 6, annotateClips' default) that
// imankh@gmail.com's dev profile does not. dev-login is dev-only (this spec is
// local-only anyway — it needs the Annotate upload/clip pipeline).
const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh+devfixture@gmail.com';
const REAL_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';
const GAME_ID = Number(process.env.E2E_GAME_ID || 11);

const COMPACT = '[data-testid="action-band-compact"]';
const LOCKED_PILL = '[data-testid="generate-locked-pill"]';
const SET_BTN = '[data-testid="set-focus-point-button"]';
const CHIP = '[data-testid="focus-coach-chip"]';
const CTA = 'button:has-text("Generate Highlight")';
const CAPTION = '[data-testid="export-unframed-caption"]';
const MINE = ['set-focus-point-button', 'action-band-compact', 'generate-locked-pill', 'focus-coach-chip'];

/** Offending elements whose right edge exceeds the viewport (true overflow causes). */
async function overflowOffenders(page) {
  return page.evaluate(() => {
    const W = window.innerWidth;
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.right > W + 1 && r.width > 0 && r.width <= W + 500 && el.children.length <= 3) {
        out.push({ tid: el.getAttribute('data-testid') || '', tag: el.tagName, cls: String(el.className).slice(0, 50), right: Math.round(r.right) });
      }
    }
    return out;
  });
}

/**
 * T11720 AC4 at 320/360/375/390: assert NO Epic-A element (the compact band, the
 * locked pill, the Set focus point button, the coach chip) overflows the viewport;
 * the pre-existing mode-tab row (T11740) may and is only logged. Run in BOTH the
 * LOCKED state (compact band + pill present) and the UNLOCKED state, since the
 * elements that exist differ between them.
 */
async function auditEpicAOverflow(page, stateLabel) {
  for (const w of [320, 360, 375, 390]) {
    await page.setViewportSize({ width: w, height: 844 });
    await page.waitForTimeout(250);
    const offenders = await overflowOffenders(page);
    const mine = offenders.filter((o) => MINE.includes(o.tid));
    expect(mine, `no Epic-A element overflows @${w} (${stateLabel}): ${JSON.stringify(mine)}`).toHaveLength(0);
    const others = offenders.filter((o) => !MINE.includes(o.tid));
    if (others.length) console.log(`OVERFLOW @${w} (${stateLabel}, pre-existing / T11740): ${JSON.stringify(others)}`);
  }
}

/**
 * T11720 AC1 (the core promise): with the LOCKED compact band present at 390, the
 * control at `sel` must be REACHABLE above the sticky band — scrollable into the
 * viewport AND not covered/intercepted by the band. Proven two ways:
 *   (1) a DOM hit-test at a point inside the element (clamped to the viewport):
 *       document.elementFromPoint there must resolve to the element (or a
 *       descendant), NOT the compact band — so the band is not painted over it;
 *   (2) a real trial click (all Playwright actionability checks, including
 *       "receives pointer events") — fails if the band intercepts the pointer.
 * If the sticky wrapper were made `position: fixed` (the T10820 landmine) it would
 * float over this bottom content and BOTH checks fail — see the mutation note in
 * the task's STATUS file.
 */
async function assertReachableAboveLockedBand(page, sel, label) {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  await expect(el, `${label} scrolled into the viewport`).toBeInViewport();
  const probe = await page.evaluate(({ sel, bandSel }) => {
    const el = document.querySelector(sel);
    const band = document.querySelector(bandSel);
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    // A point inside the element AND inside the viewport (near its top edge, which
    // is the part that stays clear of a bottom-anchored band).
    const x = Math.min(Math.max(r.left + r.width / 2, 1), vw - 1);
    const y = Math.min(Math.max(r.top + 6, 1), vh - 1);
    const hit = document.elementFromPoint(x, y);
    const bandCovers = !!band && (hit === band || band.contains(hit));
    const reachesEl = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    return { x: Math.round(x), y: Math.round(y), hitTid: hit?.getAttribute?.('data-testid') || '', hitTag: hit?.tagName || '', bandCovers, reachesEl };
  }, { sel, bandSel: COMPACT });
  expect(probe.bandCovers, `${label}: compact band must NOT cover it at (${probe.x},${probe.y}) [hit=${probe.hitTid || probe.hitTag}]`).toBe(false);
  expect(probe.reachesEl, `${label}: its own point is topmost at (${probe.x},${probe.y}) [hit=${probe.hitTid || probe.hitTag}]`).toBe(true);
  // Belt-and-suspenders: a real actionability pass (not intercepted by the band).
  await el.click({ trial: true, timeout: 5000 });
}

let createdClipId = null;

test.afterEach(async ({ context }) => {
  if (createdClipId) {
    await deleteClip(context, createdClipId);
    createdClipId = null;
  }
});

test('fresh unframed draft: locked compact band, coach cues, and one-tap unlock across viewports', async ({ context, page }) => {
  test.setTimeout(240_000);
  await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);

  // --- Create a genuinely unframed draft via the clip-save write path ---
  // (createUnframedDraft hits POST /clips/raw/save with create_project, the
  // backend of the Annotate "Save clip" gesture -> a Focus draft with ZERO crop
  // keyframes; deterministic in-container, unlike the video-buffer-dependent
  // gap-scan UI.) The UNFRAMED state is then proven through the real Focus UI.
  const { rawClipId, name } = await createUnframedDraft(context, { profileId: REAL_PROFILE, gameId: GAME_ID });
  createdClipId = rawClipId;

  // Open the fresh draft in Focus by its unique name. Its home tile reads the
  // bare "Draft" label (T8470 NOT_STARTED wording); the IN_FRAMING variant would
  // read "Draft, in Focus", so assert this one carries NO pipeline qualifier.
  await page.goto('/');
  const card = page.locator('[data-testid="project-card"]', { hasText: name }).first();
  await card.waitFor({ timeout: 20000 });
  await expect(card, 'the fresh draft is an unframed (NOT_STARTED) "Draft"').toContainText('Draft');
  await expect(card, 'not yet in framing/overlay').not.toContainText(/Draft, in|Ready to watch/);
  await card.click();
  await page.locator('.crop-handle').first().waitFor({ timeout: 90000 });

  // ================= 390 portrait: LOCKED state =================
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);

  // T11720 AC1: compact locked band <=56px, with the unlock caption + disabled pill.
  const compact = page.locator(COMPACT);
  await expect(compact, 'compact locked band visible @390').toBeVisible();
  await expect(compact).toContainText(/Set a focus point to unlock Generate/);
  const box = await compact.boundingBox();
  expect(box.height, `compact band height <=56px (measured ${box.height})`).toBeLessThanOrEqual(56);
  await expect(page.locator(LOCKED_PILL)).toHaveAttribute('aria-disabled', 'true');
  // The full band (real CTA + caption) stays in the DOM below sm (`hidden sm:flex`)
  // so the real CTA is never unmounted; it is just not visible — assert HIDDEN,
  // not absent (MAJOR-1: asserting the full CTA VISIBLE at 390 was the bug).
  await expect(page.locator(CTA).first(), 'full-band CTA present but hidden below sm').toBeHidden();
  await expect(page.locator(CAPTION), 'full-band caption hidden below sm').toBeHidden();
  // T11710 AC1: coach chip + empty-timeline hint at 0 focus points.
  await expect(page.locator(CHIP), 'coach chip @390 at 0 points').toBeVisible();
  await expect(page.getByText(/No focus points yet/), 'empty timeline hint @390').toBeVisible();
  await saveEvidence(page, 'T11700-live-390-locked');

  // T11720 AC1 (the whole point of the compact band): with the locked band on
  // screen, the timeline and the "Trim and slo-mo" control must stay REACHABLE
  // above it (the full-height band used to bury them). Scroll to each and prove it
  // is in the viewport and NOT covered/intercepted by the sticky compact band.
  await assertReachableAboveLockedBand(page, '[data-testid="focus-timeline-block"]', 'timeline (locked @390)');
  await assertReachableAboveLockedBand(page, '[data-testid="advanced-editing-disclosure"]', 'Trim and slo-mo (locked @390)');
  await saveEvidence(page, 'T11700-live-390-locked-timeline-reachable');

  // T11720 AC3: the mobile settings panel still opens ABOVE the band in the LOCKED
  // state. On mobile the panel is the drawer (settings-rail is the desktop-only
  // lg:flex rail); it is anchored inside the sticky band wrapper and slides up
  // ABOVE the band (T10820), so the compact locked band stays mounted beneath it.
  await page.getByTestId('mobile-settings-row').click();
  await expect(page.getByTestId('mobile-settings-row')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('settings-drawer'), 'settings drawer opens over the locked band').toBeVisible();
  await expect(compact, 'locked band still present under the open settings panel').toBeVisible();
  await saveEvidence(page, 'T11700-live-390-locked-settings-open');
  // Close it (the entry row only opens) so the drawer can't cover the Set focus
  // point tap later in this same test.
  await page.getByTestId('drawer-close').click();
  await expect(page.getByTestId('settings-drawer'), 'drawer closed').toBeHidden();

  // T11720 AC4 in the LOCKED state: the compact band + locked pill are present
  // here (they are gone after unlock), so audit overflow with them on screen.
  await auditEpicAOverflow(page, 'locked');

  // ================= 768 + 1440: LOCKED state (full band, no compact) =================
  for (const w of [768, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(400);
    // compactLocked is viewport-independent (derived from clipIsFramed), so the
    // compact row stays in the DOM at sm+ but is `sm:hidden` — assert HIDDEN, not
    // absent. It is removed from the DOM only once framed (asserted after unlock).
    await expect(page.locator(COMPACT), `compact row hidden at ${w}`).toBeHidden();
    await expect(page.locator(CTA).first(), `disabled CTA @${w}`).toBeDisabled();
    await expect(page.locator(CAPTION), `reason caption @${w}`).toContainText(/Move the box onto your player/);
    await expect(page.locator(CHIP), `coach chip @${w} at 0 points`).toBeVisible();
    await saveEvidence(page, `T11700-live-${w}-locked`);
  }

  // ================= one-tap unlock @390 (the compactLocked interaction) =================
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const setBtn = page.locator(`${SET_BTN}:visible`).first();
  await setBtn.scrollIntoViewIfNeeded();
  await expect(setBtn).toContainText(/Set focus point/i);
  await setBtn.click();

  // T11700 AC1 + T11720 AC2: locked affordances gone, real CTA enabled.
  await expect(page.locator(COMPACT), 'compact band gone after first point').toHaveCount(0);
  await expect(page.locator(CTA).first(), 'real CTA now visible+enabled').toBeEnabled();
  // T11710 AC1: ring/chip/hint gone after the first point, no reload.
  await expect(page.locator(CHIP), 'coach chip gone after first point').toHaveCount(0);
  await expect(page.getByText(/No focus points yet/), 'empty hint gone after first point').toHaveCount(0);
  await saveEvidence(page, 'T11700-live-390-unlocked');

  // ================= T11720 AC4: overflow audit at 320/360/375/390 (UNLOCKED) =====
  // After the first point the compact band/pill are gone; the Set focus point
  // button + (now-enabled) CTA are on screen. Same guarantee: no Epic-A overflow.
  await auditEpicAOverflow(page, 'unlocked');
});
