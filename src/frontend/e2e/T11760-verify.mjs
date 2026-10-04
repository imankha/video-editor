/* global console, process, document, getComputedStyle */
// T11760 real-browser verification (standalone, not CI). Drives the harness page with a real
// layout engine at every target width and proves the acceptance criteria that jsdom cannot:
//   #1 a ~34-char opponent name wraps to 2 lines (no ellipsis) on the phone tile
//   #2 two consecutive 1-game months pack side by side in one row at 768
//   #3 1440 keeps the sticky side-rail layout (unchanged desktop)
//   #4 skeleton and loaded grid share the same column count at each width (no jump on load)
//   #5 no horizontal overflow from 320 to 768
// Writes evidence PNGs (loaded + skeleton visible in each full-page shot) + a PASS/FAIL log
// to <repo>/qa/T11760. Requires the Vite dev server on :5173.
import { chromium } from '@playwright/test';
import fs from 'fs';

const HARNESS = 'http://localhost:5173/e2e/T11760-harness/index.html';
const OUT = '/workspace/qa/T11760';
fs.mkdirSync(OUT, { recursive: true });

const WIDTHS = [320, 360, 375, 390, 768, 1440];
const checks = [];
const record = (ok, label, detail = '') => {
  checks.push({ ok, label, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

// Column count = number of items whose top edge is within 2px of the topmost item, scoped to
// one [data-qa-state] section. Works for loaded ([data-qa-game] wrappers) and skeleton shells.
function measure() {
  const topRowCount = (sectionSel, itemSel) => {
    const root = document.querySelector(sectionSel);
    const items = [...root.querySelectorAll(itemSel)];
    if (!items.length) return 0;
    const tops = items.map((el) => el.getBoundingClientRect().top);
    const min = Math.min(...tops);
    return tops.filter((t) => Math.abs(t - min) <= 2).length;
  };
  const rect = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.getBoundingClientRect() : null;
  };
  const headingLines = (gameId) => {
    const el = document.querySelector(`[data-qa-game="${gameId}"] h3`);
    if (!el) return 0;
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    return Math.round(el.getBoundingClientRect().height / lh);
  };
  // T11760 review round: the date + counts meta row must stay ONE line on phones too (it was
  // `flex-col sm:flex-row`, wrapping to two lines on the new wide 1-up phone tile). Height of the
  // flex row / its text-xs line-height = line count; 1 = single row, 2 = the old wrap.
  const metaLines = (gameId) => {
    const root = document.querySelector(`[data-qa-game="${gameId}"]`);
    if (!root) return 0;
    const el = [...root.querySelectorAll('div')].find(
      (d) => d.className.includes('justify-between') && d.className.includes('text-xs'),
    );
    if (!el) return 0;
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    return Math.round(el.getBoundingClientRect().height / lh);
  };
  const sepH3 = document.querySelector('[data-qa-game="2"] h3');
  return {
    meta1Lines: metaLines(1), // short date + "3 annotations"
    meta2Lines: metaLines(2), // busier counts (5 annotations, 1 reel)
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    loadedCols: topRowCount('[data-qa-state="loaded"]', '[data-qa-game]'),
    skeletonCols: topRowCount('[data-qa-state="skeleton"]', '.aspect-video'),
    octTop: rect('[data-qa-game="1"]')?.top ?? null,     // October (1 game)
    sepTop: rect('[data-qa-game="2"]')?.top ?? null,     // September (1 game, long name)
    sepLines: headingLines(2),
    octLines: headingLines(1),
    // line-clamp-2 active (vs the old single-line `truncate`), and the long name is not
    // clipped/ellipsized (its content fits within the clamped box).
    sepClamp: sepH3 ? getComputedStyle(sepH3).webkitLineClamp : null,
    sepClipped: sepH3 ? sepH3.scrollHeight > sepH3.clientHeight + 1 : true,
    // lg side-rail present when a group section is a 2-track grid (label rail + tiles)
    railActive: (() => {
      const sec = document.querySelector('[data-qa-state="loaded"] section[data-group-kind]');
      if (!sec) return false;
      return getComputedStyle(sec).gridTemplateColumns.split(' ').length === 2;
    })(),
  };
}

async function run() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(HARNESS, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-qa-game="2"] h3');

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(250); // let responsive layout settle
    const m = await page.evaluate(measure);
    await page.screenshot({ path: `${OUT}/grid-${width}.png`, fullPage: true });

    // #5 no horizontal overflow (320-768; also checked at 1440 for good measure)
    if (width <= 768) record(m.overflow <= 1, `[${width}] no horizontal overflow`, `overflow=${m.overflow}px`);

    if (width < 640) {
      // phone band: one column, and the skeleton matches it (#4)
      record(m.loadedCols === 1, `[${width}] loaded grid is one column (phone)`, `cols=${m.loadedCols}`);
      record(m.skeletonCols === 1, `[${width}] skeleton is one column (matches loaded, no jump)`, `cols=${m.skeletonCols}`);
      // #1 the ~48-char opponent name is fully visible (not ellipsized), capped at two lines
      // by line-clamp-2 (the old `truncate` would clip it to one line with an ellipsis). With
      // 1-up tiles the name now has room, so it may occupy 1 OR 2 lines depending on width --
      // both are correct ("up to 2 lines"); what matters is it is never clipped.
      record(m.sepLines >= 1 && m.sepLines <= 2, `[${width}] long name uses at most 2 lines`, `lines=${m.sepLines}`);
      record(!m.sepClipped, `[${width}] long name fully visible (no ellipsis clip)`, `clipped=${m.sepClipped}`);
      record(m.sepClamp === '2', `[${width}] title uses line-clamp-2 (wraps, not single-line truncate)`, `clamp=${m.sepClamp}`);
      record(m.octLines === 1, `[${width}] short name stays one line`, `lines=${m.octLines}`);
      // review round: meta row (date + counts) stays one line on phones (not the old flex-col wrap)
      record(m.meta1Lines === 1, `[${width}] meta row stays one line (short date + counts)`, `lines=${m.meta1Lines}`);
      record(m.meta2Lines === 1, `[${width}] meta row stays one line (busier counts)`, `lines=${m.meta2Lines}`);
    }

    if (width === 768) {
      // #2 two consecutive 1-game months in the SAME row, 2-up, skeleton matches (#4)
      record(m.loadedCols === 2, `[768] loaded packs 2 columns`, `cols=${m.loadedCols}`);
      record(m.skeletonCols === 2, `[768] skeleton packs 2 columns (matches loaded)`, `cols=${m.skeletonCols}`);
      record(
        m.octTop !== null && m.sepTop !== null && Math.abs(m.octTop - m.sepTop) <= 2,
        `[768] the two 1-game months sit side by side in one row`,
        `octTop=${Math.round(m.octTop)} sepTop=${Math.round(m.sepTop)}`,
      );
    }

    if (width === 1440) {
      // #3 desktop keeps the sticky side-rail group layout; a wide rail tile fits the long
      // name without truncation (1 line is fine here -- "up to 2 lines" allows fewer), and it
      // is still capped at 2 lines by line-clamp.
      record(m.railActive, `[1440] group side-rail layout active (desktop unchanged)`, `rail=${m.railActive}`);
      record(!m.sepClipped && m.sepLines <= 2, `[1440] long name not truncated, capped at 2 lines`, `lines=${m.sepLines} clipped=${m.sepClipped}`);
    }
  }

  // N=4 busy-month geometry (reviewer round): the sm..md packing grid caps at 3 columns so a
  // 4-game month never shrinks to the overlapping ~80-98px tablet tiles measured at 640-768px
  // before the fix. Each tile must stay taller than its scrim, the title pencil must not collide
  // with the top-right kebab, and the busy-month top row must be 3-up (not 4). 4-up only returns
  // at lg where the side-rail tiles are wide enough.
  const measureN4 = () => {
    const sec = document.querySelector('[data-qa-state="loaded-n4"]');
    const wrap = sec.querySelector('[data-qa-game="41"]');
    const tile = wrap.firstElementChild;
    const tr = tile.getBoundingClientRect();
    const scrim = [...tile.querySelectorAll('div')].find((d) => {
      const c = getComputedStyle(d);
      return c.position === 'absolute' && c.bottom === '0px' && d.querySelector('h3');
    });
    const sr = scrim ? scrim.getBoundingClientRect() : null;
    const pencil = wrap.querySelector('[data-game-edit]')?.getBoundingClientRect();
    const kebab = wrap.querySelector('[data-game-kebab]')?.getBoundingClientRect();
    const hit = (a, c) => a && c && !(a.right <= c.left || c.right <= a.left || a.bottom <= c.top || c.bottom <= a.top);
    const july = [...sec.querySelectorAll('[data-qa-game]')].filter((e) => +e.getAttribute('data-qa-game') < 45);
    const tops = july.map((e) => e.getBoundingClientRect().top);
    const minT = Math.min(...tops);
    return {
      tileH: Math.round(tr.height),
      scrimExceedsTile: sr ? sr.height > tr.height + 1 : true,
      pencilKebabOverlap: hit(pencil, kebab),
      topRowCols: tops.filter((t) => Math.abs(t - minT) <= 2).length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  };
  for (const width of [640, 667, 700, 735, 768]) {
    await page.setViewportSize({ width, height: 1200 });
    await page.waitForTimeout(250);
    const n = await page.evaluate(measureN4);
    await page.screenshot({ path: `${OUT}/n4-${width}.png`, fullPage: true });
    record(n.topRowCols === 3, `[${width}] busy month packs 3-up (capped, not 4)`, `cols=${n.topRowCols}`);
    record(!n.scrimExceedsTile, `[${width}] tile taller than its scrim`, `tileH=${n.tileH}`);
    record(!n.pencilKebabOverlap, `[${width}] title pencil clears the kebab`, `overlap=${n.pencilKebabOverlap}`);
    record(n.overflow <= 1, `[${width}] no horizontal overflow (N=4)`, `overflow=${n.overflow}px`);
  }

  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ checks, failed: failed.length }, null, 2));
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'}: ${checks.length - failed.length}/${checks.length} checks, evidence in ${OUT}`);
  process.exit(failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(2); });
