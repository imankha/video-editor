/* global console, process, document */
// T14230 real-browser verification (standalone, not CI). Drives e2e/T14230-harness with a real
// layout engine and proves the acceptance criteria jsdom cannot measure:
//   C1 at 390x844 in Frame and Spotlight during generation, the "Highlight Generating" card's
//      box intersects NO button in the action band
//   C2 the card's title and percent line stay fully inside the viewport (readable)
//   C3 desktop (1440x900): the card keeps its bottom-4/right-4 slot (16px from bottom/right)
// Exit 0 = all PASS, 1 = any FAIL. Requires the Vite dev server on :5173.
import { chromium } from '@playwright/test';

const HARNESS = 'http://localhost:5173/e2e/T14230-harness/index.html';
let failed = 0;
const record = (ok, label, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

function measure() {
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
  const card = document.querySelector('[data-testid="global-export-indicator"]');
  const band = document.querySelector('[data-testid="action-band"]');
  const title = [...card.querySelectorAll('div')].find((d) => /Generating$/.test(d.textContent.trim()) && d.children.length === 0);
  const percent = [...card.querySelectorAll('div')].find((d) => /42%/.test(d.textContent) && d.children.length === 0);
  return {
    vw: document.documentElement.clientWidth,
    vh: document.documentElement.clientHeight,
    card: box(card),
    title: title ? box(title) : null,
    percent: percent ? box(percent) : null,
    buttons: [...band.querySelectorAll('button')].map((b) => ({ name: (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 40), ...box(b) })),
  };
}

const intersects = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const inside = (r, vw, vh) => r && r.left >= 0 && r.top >= 0 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5;

const browser = await chromium.launch();
try {
  for (const screen of ['frame', 'spotlight']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await page.goto(`${HARNESS}?screen=${screen}`, { timeout: 120000 });
    await page.waitForSelector('[data-testid="global-export-indicator"]');
    await page.waitForSelector('[data-testid="action-band"] button');
    await page.waitForTimeout(300);
    const m = await page.evaluate(measure);
    record(m.buttons.length > 0, `C1 ${screen} 390x844: band has buttons`, `${m.buttons.length}`);
    for (const b of m.buttons) {
      record(!intersects(m.card, b), `C1 ${screen} 390x844: card clear of "${b.name}"`,
        `card=${JSON.stringify(m.card)} button=${JSON.stringify({ left: b.left, top: b.top, right: b.right, bottom: b.bottom })}`);
    }
    record(inside(m.title, m.vw, m.vh), `C2 ${screen} 390x844: title in viewport`, JSON.stringify(m.title));
    record(inside(m.percent, m.vw, m.vh), `C2 ${screen} 390x844: percent in viewport`, JSON.stringify(m.percent));
    await page.close();
  }
  for (const screen of ['frame', 'spotlight']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${HARNESS}?screen=${screen}`, { timeout: 120000 });
    await page.waitForSelector('[data-testid="global-export-indicator"]');
    await page.waitForTimeout(300);
    const m = await page.evaluate(measure);
    const fromBottom = m.vh - m.card.bottom;
    const fromRight = m.vw - m.card.right;
    record(Math.abs(fromBottom - 16) <= 0.5 && Math.abs(fromRight - 16) <= 0.5,
      `C3 ${screen} 1440x900: card stays at bottom-4/right-4`, `fromBottom=${fromBottom} fromRight=${fromRight}`);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
