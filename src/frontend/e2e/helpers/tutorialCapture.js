/**
 * tutorialCapture — shared kit for recording narrated tutorial footage with Playwright.
 * SOURCE OF TRUTH lives in ReelBallersTutroials/workflow/capture_specs/ — copy into
 * video-editor/src/frontend/e2e/helpers/ before running (untracked files in the app
 * repo have been observed to get cleaned).
 *
 * Provides:
 *  - OVERLAY_INIT: page-injected viewer guidance — rendered cursor (Playwright records
 *    none), click ripples on every mousedown, and a pulsing highlight ring.
 *  - makeKit(page): { marks, mark, ring, clearRing, act, drag, typeInto, dwell, step,
 *    videosReady } — mark() flashes a beacon square into the recording so
 *    workflow/from_capture.py can read frame-accurate anchor times out of the pixels
 *    (the recorder's wall clock drifts; never trust it).
 *  - finishCapture(context, page, kit, questDir, dims): finalizes the recording and
 *    writes capture.webm + capture_actions.json into the quest folder.
 */
import fs from 'fs';
import path from 'path';

export const OVERLAY_INIT = `(() => {
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
      (document.fullscreenElement || document.documentElement).appendChild(cursor);
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
      (document.fullscreenElement || document.documentElement).appendChild(r);
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
      (document.fullscreenElement || document.documentElement).appendChild(ring);
    },
    clearRing() { if (ring) { ring.remove(); ring = null; } },
  };
})();`;

export function makeKit(page) {
  const marks = [];
  const kit = {
    marks,
    async mark(line, word = null) {
      marks.push({ line, word, tMs: Date.now() });
      await page.evaluate(() => {
        const d = document.createElement('div');
        d.style.cssText = 'position:fixed;left:2px;bottom:2px;width:26px;height:26px;' +
          'background:#f0f;z-index:2147483647;pointer-events:none;';
        (document.fullscreenElement || document.body).appendChild(d);
        setTimeout(() => d.remove(), 380);
      });
    },
    async ring(locator, pad = 10) {
      const b = await locator.boundingBox();
      if (b) await page.evaluate(({ x, y, w, h }) => window.__tut.ringAt(x, y, w, h),
        { x: b.x - pad, y: b.y - pad, w: b.width + 2 * pad, h: b.height + 2 * pad });
    },
    clearRing: () => page.evaluate(() => window.__tut.clearRing()),
    async act(locator) {
      const b = await locator.boundingBox();
      if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 22 });
      await locator.click();
    },
    async drag(x1, y1, x2, y2, steps = 25) {
      await page.mouse.move(x1, y1, { steps: 15 });
      await page.mouse.down();
      await page.mouse.move(x2, y2, { steps });
      await page.mouse.up();
    },
    async typeInto(locator, text) {
      await kit.act(locator);
      await locator.pressSequentially(text, { delay: 55 });
    },
    dwell: (s) => page.waitForTimeout(s * 1000),
    step: (s) => console.log(`[capture] ${s}`),
    async videosReady(min = 1, timeout = 12000) {
      try {
        await page.waitForFunction((n) => {
          const vs = [...document.querySelectorAll('video')];
          return vs.length >= n && vs.slice(0, n).every(v => v.readyState >= 2);
        }, min, { timeout });
        await page.evaluate(() => document.querySelectorAll('video').forEach(v => {
          v.muted = true; if (v.paused) v.play().catch(() => {});
        }));
      } catch {}
    },
  };
  return kit;
}

export async function finishCapture(context, page, kit, questDir, { width, height }) {
  const wallEndMs = Date.now();
  const video = page.video();
  await context.close();
  const vPath = await video.path();
  const webmOut = path.join(questDir, 'capture.webm');
  fs.copyFileSync(vPath, webmOut);
  fs.rmSync(vPath, { force: true });
  fs.writeFileSync(path.join(questDir, 'capture_actions.json'),
    JSON.stringify({ wallEndMs, marks: kit.marks, video: 'capture.webm', width, height }, null, 2));
  console.log(`captured ${kit.marks.length} marks -> ${webmOut}`);
}
