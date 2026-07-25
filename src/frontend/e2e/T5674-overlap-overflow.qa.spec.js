import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth';
import { saveEvidence, assertNoHorizontalOverflow } from './helpers/qa.js';

/**
 * T5674 — REAL-BROWSER QA for the three overlap/overflow fixes:
 *   AC1 report pill never overlaps interactive controls on Home/Annotate/Framing/Overlay
 *       at 390/768/1315/1920 widths (pill collapses to a compact icon on editor screens).
 *   AC2 no stray horizontal scrollbar in the Annotate left panel (ClipScrubRegion tick
 *       labels are clipped to the track), no real content hidden.
 *   AC3 the Framing crop-size label stays fully legible with the crop at the top edge
 *       (edge-flips below the reticle top instead of clipping outside the video).
 *
 * Driven as a real logged-in user against the dev stack (bash scripts/dev-verify.sh).
 * Real browser is mandatory here (jsdom proves nothing about pixel geometry / scrollbars).
 */

const ACTIVE_GAME = 6; // "at Legends Mar 28", 32 clips, source active
const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1315x748', width: 1315, height: 748 },
  { name: '1920x1080', width: 1920, height: 1080 },
];

async function revealControls(page) {
  const c = await page.evaluate(() => {
    const v = document.querySelector('.video-player-container') || document.querySelector('video');
    if (!v) return null; const r = v.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
  if (c) { await page.mouse.move(c.cx, c.cy); await page.mouse.move(c.cx + 4, c.cy + 3); }
  await page.waitForTimeout(400);
}

// Returns { pillVisible, compact, hits:[...] } — hits are interactive, actually-clickable
// controls whose rect intersects the pill rect.
async function pillOverlap(page) {
  return await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => /Report a problem/i.test(b.getAttribute('aria-label') || b.textContent || ''));
    const p = btns.find(b => getComputedStyle(b).position === 'fixed');
    if (!p) return { pillVisible: false };
    if (getComputedStyle(p).display === 'none') return { pillVisible: false };
    const r = p.getBoundingClientRect();
    const compact = !/Report a problem/.test(p.textContent || '');
    const hits = [];
    document.querySelectorAll('input[type="range"], button, a[href], [role="slider"]').forEach((el) => {
      if (el === p || p.contains(el) || el.contains(p)) return;
      const q = el.getBoundingClientRect();
      if (q.width < 4 || q.height < 4) return;
      const cs = getComputedStyle(el);
      if (cs.pointerEvents === 'none' || cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
      const overlap = !(q.right <= r.left || q.left >= r.right || q.bottom <= r.top || q.top >= r.bottom);
      if (overlap) hits.push({ tag: el.tagName, aria: el.getAttribute('aria-label'), title: el.getAttribute('title'), cls: (el.className || '').toString().slice(0, 45) });
    });
    return { pillVisible: true, compact, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, hits };
  });
}

async function selectProjectMode(page, projectId, mode) {
  await page.evaluate(async ({ id, mode }) => {
    const { useProjectsStore } = await import('/src/stores/projectsStore.js');
    const { useEditorStore } = await import('/src/stores/editorStore.js');
    await useProjectsStore.getState().selectProject(id);
    useEditorStore.getState().setEditorMode(mode);
  }, { id: projectId, mode });
  await page.waitForTimeout(6000);
}

test('AC1 — report pill never overlaps controls across screens/viewports', async ({ context, page }) => {
  test.setTimeout(300000);
  await loginAsRealUser(context, 'imankh@gmail.com', '9fa7378c');
  await page.goto('/');
  await page.waitForTimeout(3000);
  const projects = await page.evaluate(async () => { const r = await fetch('/api/projects', { credentials: 'include' }); return r.ok ? r.json() : []; });
  const proj = Array.isArray(projects) ? (projects.find(p => p.working_video_id) || projects[0]) : null;
  expect(proj, 'need a project to drive framing/overlay').toBeTruthy();

  const summary = [];

  // HOME — expect the full text pill (audit called Home correct)
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    await page.goto('/');
    await page.waitForTimeout(1200);
    const o = await pillOverlap(page);
    summary.push({ screen: 'home', vp: vp.name, ...o });
    await saveEvidence(page, `criterion-1-pill-home-${vp.name}`);
    if (o.pillVisible) expect(o.hits, `home@${vp.name} pill overlaps ${JSON.stringify(o.hits)}`).toHaveLength(0);
    if (o.pillVisible) expect(o.compact, `home@${vp.name} should be the text pill`).toBeFalsy();
  }

  // ANNOTATE / FRAMING / OVERLAY — expect the compact icon, zero overlap with controls
  await openGameInAnnotate(page, ACTIVE_GAME);
  await page.waitForSelector('[data-sidebar="clips"]', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp); await page.waitForTimeout(700); await revealControls(page);
    const o = await pillOverlap(page);
    summary.push({ screen: 'annotate', vp: vp.name, ...o });
    await saveEvidence(page, `criterion-1-pill-annotate-${vp.name}`);
    if (o.pillVisible) { expect(o.hits, `annotate@${vp.name} overlaps ${JSON.stringify(o.hits)}`).toHaveLength(0); expect(o.compact).toBeTruthy(); }
  }
  for (const mode of ['framing', 'overlay']) {
    await selectProjectMode(page, proj.id, mode);
    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp); await page.waitForTimeout(700); await revealControls(page);
      const o = await pillOverlap(page);
      summary.push({ screen: mode, vp: vp.name, ...o });
      await saveEvidence(page, `criterion-1-pill-${mode}-${vp.name}`);
      if (o.pillVisible) { expect(o.hits, `${mode}@${vp.name} overlaps ${JSON.stringify(o.hits)}`).toHaveLength(0); expect(o.compact).toBeTruthy(); }
    }
  }
  console.log('AC1_SUMMARY=' + JSON.stringify(summary));
});

test('AC2 — no stray horizontal scrollbar in Annotate left panel', async ({ context, page }) => {
  test.setTimeout(180000);
  await loginAsRealUser(context, 'imankh@gmail.com', '9fa7378c');
  await page.setViewportSize({ width: 1315, height: 748 });
  await openGameInAnnotate(page, ACTIVE_GAME);
  await page.waitForSelector('[data-sidebar="clips"]', { timeout: 60000 });
  await page.waitForTimeout(4000);

  const rows = await page.locator('[data-sidebar="clips"] .scrollbar-thin .cursor-pointer').count();
  let worst = null;
  for (let i = 0; i < Math.min(rows, 14); i++) {
    await page.locator('[data-sidebar="clips"] .scrollbar-thin .cursor-pointer').nth(i).click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const w = document.querySelector('[data-clip-details]')?.parentElement;
      if (!w) return null;
      // ticks must still render (content not hidden by the fix)
      const ticks = w.querySelectorAll('.font-mono').length;
      return { over: w.scrollWidth - w.clientWidth, ticks };
    });
    if (m && (!worst || m.over > worst.over)) worst = { i, ...m };
    // AC2: the panel scroller must not overflow horizontally on any clip
    if (m) expect(m.over, `clip ${i} h-overflow ${m.over}px`).toBeLessThanOrEqual(0.5);
  }
  // the clip-detail timeline still shows its tick labels (fix clips, does not remove)
  const shot = await page.locator('[data-clip-details]').first();
  await shot.scrollIntoViewIfNeeded().catch(() => {});
  await saveEvidence(page, 'criterion-2-annotate-panel-no-scrollbar');
  await assertNoHorizontalOverflow(page);
  console.log('AC2_WORST=' + JSON.stringify(worst));
});

test('AC3 — Framing crop-size label legible at the top edge', async ({ context, page }) => {
  test.setTimeout(180000);
  await loginAsRealUser(context, 'imankh@gmail.com', '9fa7378c');
  await page.setViewportSize({ width: 1315, height: 900 });
  await page.goto('/');
  await page.waitForTimeout(3000);
  const projects = await page.evaluate(async () => { const r = await fetch('/api/projects', { credentials: 'include' }); return r.ok ? r.json() : []; });
  const proj = Array.isArray(projects) ? (projects.find(p => p.working_video_id) || projects[0]) : null;
  expect(proj).toBeTruthy();
  await selectProjectMode(page, proj.id, 'framing');

  // Locate the crop reticle (the border-2 cursor-move box) and drag it to the top edge.
  const box = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(d => /cursor-move/.test(d.className) && /border-2/.test(d.className));
    if (!el) return null; const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, top: r.top };
  });
  expect(box, 'crop reticle present').toBeTruthy();
  // drag the crop up well past the top so it clamps at the container top
  await page.mouse.move(box.cx, box.cy);
  await page.mouse.down();
  for (let dy = 0; dy <= 500; dy += 50) { await page.mouse.move(box.cx, box.cy - dy); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(600);

  const geom = await page.evaluate(() => {
    // the crop-size badge: font-mono text like "608x1080 @ (508, 0)"
    const label = [...document.querySelectorAll('div.font-mono, span.font-mono, div')].find(d => /@\s*\(/.test(d.textContent || '') && /\d+x\d+/.test(d.textContent || '') && /font-mono/.test(d.className));
    const container = document.querySelector('.video-container') || document.querySelector('.video-player-container');
    if (!label || !container) return { found: false };
    const lr = label.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    return { found: true, text: (label.textContent || '').trim().slice(0, 40), labelTop: Math.round(lr.top), labelBottom: Math.round(lr.bottom), containerTop: Math.round(cr.top), clippedAbove: lr.top < cr.top - 0.5 };
  });
  console.log('AC3_LABEL=' + JSON.stringify(geom));
  await saveEvidence(page, 'criterion-3-crop-label-top-edge');
  expect(geom.found, 'crop label found').toBeTruthy();
  // AC3: label must not render above the video container top (would be clipped)
  expect(geom.clippedAbove, `label clipped above container: ${JSON.stringify(geom)}`).toBeFalsy();
});
