/**
 * Tutorial capture: PUBLISH quest — drives the publish flow as a real user while
 * recording 1920x1080 video, with viewer-guidance overlays injected into the page:
 *   - a rendered cursor that glides to each target (Playwright recordings have none)
 *   - a pulsing highlight ring around the UI element being narrated
 *   - a ripple burst on every click/press
 * plus a beacon flash (bottom-left) at every narrated action so from_capture.py can
 * read frame-accurate anchor times back out of the pixels (the recorder's wall clock
 * drifts). Marks map to talk-track line numbers in
 * C:/Users/imank/Videos/Captures/ReelBallersTutroials/publish/talk_track.txt.
 *
 * Run:
 *   cd src/frontend && E2E_BASE_URL=http://localhost:5173 \
 *     npx playwright test e2e/tutorial-capture-publish.spec.js --reporter=line
 */
import { test } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import fs from 'fs';
import path from 'path';

const QUEST_DIR = 'C:/Users/imank/Videos/Captures/ReelBallersTutroials/publish';
const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
const W = 1920, H = 1080;

// Overlay toolkit injected into every page: fake cursor + click ripple are automatic
// (driven by real mousemove/mousedown events); the highlight ring is explicit.
const OVERLAY_INIT = `(() => {
  const CSS = \`
    .__tut-cursor { position: fixed; z-index: 2147483000; pointer-events: none;
      width: 26px; height: 26px; margin: -2px 0 0 -2px; transition: transform .08s; }
    .__tut-cursor.__down { transform: scale(0.82); }
    .__tut-ripple { position: fixed; z-index: 2147482900; pointer-events: none;
      width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
      border: 3px solid #22d3ee; animation: __tutRip .55s ease-out forwards; }
    .__tut-ripple.__two { animation-delay: .12s; opacity: 0; }
    @keyframes __tutRip { 0% { transform: scale(.4); opacity: .95; }
      100% { transform: scale(3.4); opacity: 0; } }
    .__tut-ring { position: fixed; z-index: 2147482800; pointer-events: none;
      border: 3px solid #22d3ee; border-radius: 12px;
      box-shadow: 0 0 0 4px rgba(34,211,238,.25), 0 0 22px 2px rgba(34,211,238,.55);
      animation: __tutPulse 1.2s ease-in-out infinite; }
    @keyframes __tutPulse { 0%,100% { box-shadow: 0 0 0 4px rgba(34,211,238,.25),
        0 0 22px 2px rgba(34,211,238,.55); }
      50% { box-shadow: 0 0 0 7px rgba(34,211,238,.12), 0 0 30px 6px rgba(34,211,238,.8); } }
  \`;
  const ensureStyle = () => {
    if (!document.getElementById('__tut-style')) {
      const s = document.createElement('style');
      s.id = '__tut-style'; s.textContent = CSS;
      document.documentElement.appendChild(s);
    }
  };
  let cursor = null, ring = null;
  const ensureCursor = () => {
    ensureStyle();
    if (!cursor || !cursor.isConnected) {
      cursor = document.createElement('div');
      cursor.className = '__tut-cursor';
      cursor.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26">' +
        '<path d="M5 2 L5 19 L9.5 15.5 L12.5 22 L15.5 20.6 L12.6 14.2 L19 14 Z" ' +
        'fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      document.documentElement.appendChild(cursor);
    }
  };
  document.addEventListener('mousemove', (e) => {
    ensureCursor();
    cursor.style.left = e.clientX + 'px'; cursor.style.top = e.clientY + 'px';
  }, true);
  document.addEventListener('mousedown', (e) => {
    ensureCursor();
    cursor.classList.add('__down');
    for (const cls of ['', '__two']) {
      const r = document.createElement('div');
      r.className = ('__tut-ripple ' + cls).trim();
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 800);
    }
  }, true);
  document.addEventListener('mouseup', () => cursor && cursor.classList.remove('__down'), true);
  window.__tut = {
    ringAt(x, y, w, h) {
      ensureStyle(); this.clearRing();
      ring = document.createElement('div');
      ring.className = '__tut-ring';
      ring.style.cssText += \`left:\${x}px;top:\${y}px;width:\${w}px;height:\${h}px;\`;
      document.documentElement.appendChild(ring);
    },
    clearRing() { if (ring) { ring.remove(); ring = null; } },
  };
})();`;

test('capture publish tutorial footage', async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: QUEST_DIR, size: { width: W, height: H } },
  });
  await context.addInitScript(OVERLAY_INIT);
  await loginAsRealUser(context, 'imankh@gmail.com');
  // Stage in-session: un-publish reel 34 -> Done+unpublished draft (project 53).
  // A fresh session re-syncs the profile DB from R2, reverting out-of-session restores.
  const staged = await context.request.post('/api/downloads/34/restore-project');
  if (!staged.ok() && staged.status() !== 404) {
    throw new Error(`restore-project failed: ${staged.status()} ${await staged.text()}`);
  }
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  const marks = [];
  // line = talk_track line index; word = the spoken word the action lands on.
  // Every mark flashes the beacon (frame-accurate anchor times, erased on convert).
  const mark = async (line, word = null) => {
    marks.push({ line, word, tMs: Date.now() });
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;left:4px;bottom:4px;width:22px;height:22px;' +
        'background:#fff;z-index:2147483647;pointer-events:none;';
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 200);
    });
  };
  const dwell = (s) => page.waitForTimeout(s * 1000);
  const step = (s) => console.log(`[capture] ${s}`);
  const ring = async (locator, pad = 10) => {
    const b = await locator.boundingBox();
    if (b) await page.evaluate(({ x, y, w, h }) => window.__tut.ringAt(x, y, w, h),
      { x: b.x - pad, y: b.y - pad, w: b.width + 2 * pad, h: b.height + 2 * pad });
  };
  const clearRing = () => page.evaluate(() => window.__tut.clearRing());
  const act = async (locator) => {          // glide the cursor there, then click
    const b = await locator.boundingBox();
    if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 22 });
    await locator.click();
  };

  // --- open home on the Reel Drafts tab -------------------------------------
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Reel Drafts' }).click();
  await page.mouse.move(960, 400);           // materialize the cursor on screen
  await mark(0);                             // "Finally, it's time to publish..."
  await dwell(4);

  // --- line 1: the draft is marked Done --------------------------------------
  const moveBtn = page.getByRole('button', { name: 'Move to My Reels' });
  await moveBtn.waitFor({ timeout: 20000 });
  const card = page.locator('[data-testid="project-card"]').filter({ has: moveBtn }).first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await mark(1);                             // "...draft is now marked Done."
  await ring(card.getByText('Done', { exact: true }).first(), 8);
  await dwell(4.5);
  await clearRing();

  // --- line 2: preview it -----------------------------------------------------
  const previewBtn = card.getByRole('button', { name: 'Preview video' });
  await ring(previewBtn, 8);
  await dwell(0.8);
  await mark(2, 'preview');
  await act(previewBtn);
  await clearRing();
  try {                                      // make sure the preview actually plays
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return v && v.readyState >= 2;
    }, null, { timeout: 10000 });
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v && v.paused) { v.muted = true; v.play().catch(() => {}); }
    });
  } catch {}
  await dwell(7);                            // watch framing/slow-mo/spotlight
  await page.keyboard.press('Escape');
  await dwell(1.5);

  // --- line 3: click Move to My Reels -----------------------------------------
  await ring(moveBtn, 8);
  await dwell(1);
  await mark(3, 'Move');
  await act(moveBtn);
  await clearRing();
  await dwell(3.5);                          // publish; drawer auto-opens

  // --- line 4: it's in My Reels under the game name ---------------------------
  await mark(4);
  step('My Reels drawer (auto-opens on publish)');
  const drawerHeading = page.getByRole('heading', { name: 'My Reels', exact: true }).first();
  try {
    await drawerHeading.waitFor({ timeout: 5000 });
  } catch {
    await page.getByRole('button', { name: /^My Reels/ }).first().click();
    await drawerHeading.waitFor();
  }
  await dwell(2);
  step('scroll drawer to reel rows');
  await page.mouse.move(1700, 540);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 900); await dwell(0.3); }
  await dwell(0.5);
  const reelPlay = page.getByRole('button', { name: 'Play video' }).locator('visible=true').last();
  await reelPlay.waitFor();
  await reelPlay.hover();
  const reelTitle = page.getByText('Brilliant Pass', { exact: true }).locator('visible=true').last();
  try { await ring(reelTitle, 14); } catch { await ring(reelPlay, 12); }
  await dwell(2);
  await clearRing();

  // --- line 5: play / download / share ----------------------------------------
  step('open More actions menu');
  const moreBtn = page.getByRole('button', { name: 'More actions' }).locator('visible=true').last();
  await mark(5, 'play');
  await act(moreBtn);
  await dwell(1.2);                          // menu shows Download / Share
  const dl = page.getByText('Download', { exact: true }).locator('visible=true').last();
  try {
    await ring(dl, 6); await dwell(1.2);
    await ring(page.getByText('Share', { exact: true }).locator('visible=true').last(), 6);
    await dwell(1.2);
  } catch {}
  await clearRing();
  await page.keyboard.press('Escape');
  await dwell(1.5);
  await dwell(2);                            // line 6 (mobile) continues this shot

  // --- line 7: collections (Top Plays / game groups) ---------------------------
  step('scroll back to collections');
  await mark(7, 'collections');
  await page.mouse.move(1700, 540);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -900); await dwell(0.25); }
  await dwell(0.5);
  try {
    await ring(page.getByText('Top Plays').first(), 10);
  } catch {}
  await dwell(3);
  await clearRing();

  // --- line 8: click the first entry (Ranking banner) --------------------------
  step('click Rank reels');
  const rankCta = page.getByText('Rank reels').first();
  await rankCta.waitFor();
  await ring(rankCta, 10);
  await dwell(1.2);
  await mark(8, 'clicking');
  await act(rankCta);
  await clearRing();
  try {                                      // wait until both matchup videos render
    await page.waitForFunction(() => {
      const vs = [...document.querySelectorAll('video')];
      return vs.length >= 2 && vs.every(v => v.readyState >= 2);
    }, null, { timeout: 15000 });
    await page.evaluate(() => document.querySelectorAll('video').forEach(v => {
      v.muted = true; if (v.paused) v.play().catch(() => {});
    }));
  } catch {}
  await dwell(3);

  // --- line 9: two reels side by side ------------------------------------------
  await mark(9);
  await dwell(5);

  // --- line 10: each choice sorts ----------------------------------------------
  await mark(10, 'choice');
  const pick = page.getByText('Pick this one').locator('visible=true').first();
  try {
    await act(pick);                          // real click -> ripple shows the press
    await dwell(3);
    await act(page.getByText('Pick this one').locator('visible=true').last());
  } catch {                                   // fallback: keyboard picks
    await page.keyboard.press('ArrowLeft');
    await dwell(3);
    await page.keyboard.press('ArrowRight');
  }
  await dwell(2.5);

  // --- end ---------------------------------------------------------------------
  const wallEndMs = Date.now();
  const video = page.video();
  await context.close();
  const vPath = await video.path();
  const webmOut = path.join(QUEST_DIR, 'capture.webm');
  fs.copyFileSync(vPath, webmOut);
  fs.rmSync(vPath, { force: true });
  fs.writeFileSync(path.join(QUEST_DIR, 'capture_actions.json'),
    JSON.stringify({ wallEndMs, marks, video: 'capture.webm', width: W, height: H }, null, 2));
  console.log(`captured ${marks.length} marks -> ${webmOut}`);
});
