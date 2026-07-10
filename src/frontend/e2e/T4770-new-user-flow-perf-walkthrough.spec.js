import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { loginAsRealUser } from './helpers/realAuth';

/**
 * T4770 Stage A — New-user-flow perf walkthrough (MEASUREMENT INSTRUMENT).
 *
 * Drives the app AS A REAL USER (imankh@gmail.com via dev-login) through the full
 * new-user journey with FULL network capture (recordHar) while emitting
 * user-perceived milestone marks — both on ONE clock (epoch ms) so a perceived
 * wait can be laid directly onto the HAR timeline.
 *
 *   Journey: Home (games list) -> Annotate (video first paint) -> Framing
 *   (video + crop) -> Overlay (highlights) -> My Reels (list + thumbs +
 *   downloads/count) -> Play a reel/recap (video playing).
 *
 * This spec writes NO application source and mutates NO account data — every leg
 * is a READ path (it opens EXISTING games/drafts/reels, never extracts a clip).
 *
 * HAR content mode: we record `{ content: 'omit', mode: 'full' }` — NOT 'embed'.
 * 'embed' base64-inlines every response BODY, and the journey streams several
 * real videos, so the flush balloons to hundreds of MB and hangs context.close()
 * (the HAR never lands). 'omit' keeps every entry's full `timings`
 * (blocked/dns/connect/ssl/send/wait/receive), status, headers, and content.size
 * / _transferSize — everything the delay ledger and har-analysis.py need. Bodies
 * are irrelevant to a perf attribution.
 *
 * Clock alignment (the crux): milestones are stamped with `Date.now()` (epoch ms)
 * IN THE PAGE — the same wall-clock epoch as HAR `startedDateTime` and
 * `performance.timeOrigin`. The Node console handler also stamps `Date.now()` so
 * the two epochs can be asserted to agree (see the sanity check below).
 *
 * Artifacts (NOT committed — under /tmp): cold.har, warm.har, marks-*.json,
 * restiming-*.json. Run in-container:
 *   bash scripts/dev-verify.sh e2e/T4770-new-user-flow-perf-walkthrough.spec.js
 *
 * Then attribute: python3 scripts/har-analysis.py /tmp/t4770/cold.har -o /tmp/t4770/cold-analysis.json
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE_ID = process.env.E2E_PROFILE_ID || '9fa7378c';
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const OUT_DIR = process.env.T4770_OUT || '/tmp/t4770';

// Real IDs on imankh's profile (probed from the API; game 6 "Legends" is active
// with a real source video, so it exercises the annotate video-first-paint path).
const ANNOTATE_GAME_ID = Number(process.env.T4770_GAME_ID || 6);

fs.mkdirSync(OUT_DIR, { recursive: true });

/** Install a global media-event tracer BEFORE any page script runs, so we catch
 *  the FIRST loadstart/loadedmetadata/loadeddata/canplay/playing on every <video>
 *  the app mounts — these ARE the user-perceived "video started" moments, stamped
 *  in epoch ms (same clock as the HAR). Media events don't bubble, so we attach
 *  per-element via a MutationObserver. */
async function installMediaTracer(context) {
  await context.addInitScript(() => {
    const seen = new WeakSet();
    const EVENTS = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'playing'];
    const shortSrc = (el) => {
      const s = el.currentSrc || el.src || '';
      return s.split('/').slice(-2).join('/').split('?')[0];
    };
    const attach = (el) => {
      if (seen.has(el)) return;
      seen.add(el);
      EVENTS.forEach((ev) =>
        el.addEventListener(
          ev,
          () => console.warn(`[PERF] media:${ev} ${Date.now()} rs=${el.readyState} src=${shortSrc(el)}`),
          { once: true, capture: true },
        ),
      );
    };
    const scan = (root) => {
      if (!root || !root.querySelectorAll) return;
      if (root.nodeName === 'VIDEO') attach(root);
      root.querySelectorAll && root.querySelectorAll('video').forEach(attach);
    };
    const obs = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) scan(n);
    });
    const boot = () => {
      scan(document);
      obs.observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) boot();
    else document.addEventListener('DOMContentLoaded', boot);
  });
}

/** Collect every [PERF] console line, recording BOTH the in-page epoch (parsed
 *  from the text) and the Node epoch at receive time — the clock-agreement check. */
function collectMarks(page) {
  const marks = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (!text.startsWith('[PERF]')) return;
    const nodeEpoch = Date.now();
    // "[PERF] <label> <epoch> [extra...]"
    const m = text.match(/^\[PERF\]\s+(\S+)\s+(\d{13})(.*)$/);
    if (m) {
      marks.push({ label: m[1], browserEpoch: Number(m[2]), nodeEpoch, extra: m[3].trim() });
    } else {
      marks.push({ raw: text, nodeEpoch });
    }
  });
  page.on('pageerror', (e) => marks.push({ label: 'pageerror', nodeEpoch: Date.now(), extra: String(e).slice(0, 200) }));
  return marks;
}

/** Stamp a perceived milestone IN THE PAGE (epoch ms — same clock as the HAR). */
async function stamp(page, label, extra = '') {
  await page.evaluate(
    ([l, e]) => console.warn(`[PERF] ${l} ${Date.now()}${e ? ' ' + e : ''}`),
    [label, extra],
  );
}

/** Pull PerformanceResourceTiming + NavigationTiming, converted to epoch via
 *  performance.timeOrigin (cross-check for the HAR overlap step). */
async function dumpResourceTiming(page, tag) {
  try {
  const data = await page.evaluate(() => {
    const origin = performance.timeOrigin;
    const nav = performance.getEntriesByType('navigation').map((n) => ({
      name: n.name,
      startEpoch: origin + n.startTime,
      responseEnd: origin + n.responseEnd,
      domContentLoaded: origin + n.domContentLoadedEventEnd,
      loadEvent: origin + n.loadEventEnd,
      transferSize: n.transferSize,
    }));
    const res = performance.getEntriesByType('resource').map((r) => ({
      name: r.name,
      initiatorType: r.initiatorType,
      startEpoch: origin + r.startTime,
      responseEnd: origin + r.responseEnd,
      duration: Math.round(r.duration),
      transferSize: r.transferSize,
      encodedBodySize: r.encodedBodySize,
    }));
    return { timeOrigin: origin, navigation: nav, resources: res };
  });
  fs.writeFileSync(path.join(OUT_DIR, `restiming-${tag}.json`), JSON.stringify(data, null, 2));
  return data;
  } catch {
    console.warn(`[PERF] restiming-skipped:${tag} ${Date.now()}`);
    return null;
  }
}

function writeMarks(marks, tag) {
  fs.writeFileSync(path.join(OUT_DIR, `marks-${tag}.json`), JSON.stringify(marks, null, 2));
  // Human-readable relative timeline for quick eyeballing.
  const withEpoch = marks.filter((m) => m.browserEpoch);
  if (withEpoch.length) {
    const t0 = withEpoch[0].browserEpoch;
    const lines = withEpoch.map((m) => `+${String(m.browserEpoch - t0).padStart(6)}ms  ${m.label}  ${m.extra || ''}`);
    fs.writeFileSync(path.join(OUT_DIR, `marks-${tag}.txt`), lines.join('\n') + '\n');
  }
}

/** Best-effort leg wrapper with a HARD time budget — a fragile navigation (a
 *  click that auto-waits forever, a video that never readies) must not consume
 *  the whole test budget or abort the walk. The HAR still captured its requests
 *  around whatever marks fired. */
async function leg(name, fn, budgetMs = 45000) {
  try {
    await Promise.race([
      Promise.resolve().then(fn).catch((e) => {
        console.warn(`[PERF] leg-err:${name} ${Date.now()} err=${String(e).slice(0, 120)}`);
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('leg-budget-exceeded')), budgetMs)),
    ]);
  } catch (e) {
    console.warn(`[PERF] leg-skipped:${name} ${Date.now()} err=${String(e).slice(0, 120)}`);
  }
}

test.describe('T4770 new-user-flow perf walkthrough', () => {
  test('cold-cache full journey (home -> annotate -> framing -> overlay -> my reels -> play)', async ({ browser }) => {
    test.setTimeout(360000);
    const harPath = path.join(OUT_DIR, 'cold.har');
    const context = await browser.newContext({
      baseURL: BASE_URL,
      recordHar: { path: harPath, content: 'omit', mode: 'full' },
    });
    await installMediaTracer(context);
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
    const page = await context.newPage();
    const marks = collectMarks(page);
    try {

    // ---- 1. HOME: cold landing -> games list -------------------------------
    await stamp(page, 'home:gotoStart');
    await page.goto('/', { waitUntil: 'commit' });
    // app shell / first meaningful paint: the Games tab button exists
    await page.locator('button:has-text("Games")').first().waitFor({ state: 'visible', timeout: 30000 });
    await stamp(page, 'home:appShell');
    await page.locator('button:has-text("Games")').first().click().catch(() => {});
    // games visible: a real game card (opponent name from the API) rendered
    await leg('home-gamesVisible', async () => {
      await page.getByText('Legends', { exact: false }).first().waitFor({ state: 'visible', timeout: 30000 });
      await stamp(page, 'home:gamesVisible');
    });
    await page.waitForTimeout(800); // let thumbnails settle for the HAR
    await stamp(page, 'home:settled');
    await dumpResourceTiming(page, 'cold-home');

    // ---- 2. ANNOTATE: open a game -> video first paint ---------------------
    await leg('annotate', async () => {
      await stamp(page, 'annotate:navStart', `game=${ANNOTATE_GAME_ID}`);
      await page.evaluate((id) => sessionStorage.setItem('pendingGameId', String(id)), ANNOTATE_GAME_ID);
      await page.goto('/annotate', { waitUntil: 'commit' });
      await page.locator('video').first().waitFor({ state: 'attached', timeout: 30000 });
      await stamp(page, 'annotate:videoElementPresent');
      // wait for the media tracer's first-frame event OR readyState>=2
      await page.waitForFunction(() => {
        const v = document.querySelector('video');
        return v && v.readyState >= 2;
      }, { timeout: 40000 }).catch(() => {});
      await stamp(page, 'annotate:videoReady', `rs=${await page.evaluate(() => document.querySelector('video')?.readyState)}`);
      // spinner gone / clips sidebar populated
      await page.waitForTimeout(1500);
      await stamp(page, 'annotate:settled');
    });
    await dumpResourceTiming(page, 'cold-annotate');

    // ---- 3. FRAMING: open an existing draft -> video + crop load -----------
    await leg('framing', async () => {
      await stamp(page, 'framing:navStart');
      // Home -> "Reel Drafts" -> a project card's FRAMING chip opens Framing
      // (onSelectProject). Selectors mirror tutorial-capture-framing.spec.js.
      await page.goto('/', { waitUntil: 'commit' });
      await page.getByRole('button', { name: 'Reel Drafts' }).first().waitFor({ state: 'visible', timeout: 15000 });
      await page.getByRole('button', { name: 'Reel Drafts' }).first().click({ timeout: 8000 });
      const card = page.locator('[data-testid="project-card"]').first();
      await card.waitFor({ state: 'visible', timeout: 20000 });
      await stamp(page, 'framing:draftsVisible');
      // The framing chip title looks like "Name [Pass]: ... (click to open)".
      const framingChip = page.getByTitle(/\[.+\]: .*\(click to open\)/).first();
      await framingChip.waitFor({ state: 'visible', timeout: 12000 });
      await framingChip.click({ timeout: 8000 });
      await page.locator('video').first().waitFor({ state: 'attached', timeout: 30000 });
      await stamp(page, 'framing:videoElementPresent');
      await page.waitForFunction(() => {
        const v = document.querySelector('video');
        return v && v.readyState >= 2;
      }, { timeout: 40000 }).catch(() => {});
      await stamp(page, 'framing:videoReady', `rs=${await page.evaluate(() => document.querySelector('video')?.readyState)}`);
      await page.waitForTimeout(1500);
      await stamp(page, 'framing:settled');
    });
    await dumpResourceTiming(page, 'cold-framing');

    // ---- 4. OVERLAY: highlights load ---------------------------------------
    await leg('overlay', async () => {
      await stamp(page, 'overlay:navStart');
      // Open an overlay-ready draft directly via its card's "Open in Overlay"
      // button (needs has_working_video — projects 50/49/47 qualify).
      await page.goto('/', { waitUntil: 'commit' });
      await page.getByRole('button', { name: 'Reel Drafts' }).first().waitFor({ state: 'visible', timeout: 15000 });
      await page.getByRole('button', { name: 'Reel Drafts' }).first().click({ timeout: 8000 });
      const overlayBtn = page.getByTitle('Open in Overlay').first();
      await overlayBtn.waitFor({ state: 'visible', timeout: 12000 });
      await overlayBtn.click({ timeout: 8000 });
      await stamp(page, 'overlay:clicked');
      await page.locator('video').first().waitFor({ state: 'attached', timeout: 20000 });
      await stamp(page, 'overlay:videoElementPresent');
      await page.waitForFunction(() => {
        const v = document.querySelector('video');
        return v && v.readyState >= 2;
      }, { timeout: 30000 }).catch(() => {});
      await stamp(page, 'overlay:videoReady');
      await page.waitForTimeout(1500);
      await stamp(page, 'overlay:settled');
    }, 55000);
    await dumpResourceTiming(page, 'cold-overlay');

    // ---- 5. MY REELS: reels list + thumbnails + downloads/count ------------
    await leg('myreels', async () => {
      await stamp(page, 'myreels:navStart');
      await page.goto('/', { waitUntil: 'commit' });
      const myReels = page.getByRole('button', { name: /My Reels/i }).first();
      await myReels.waitFor({ state: 'visible', timeout: 15000 });
      await myReels.click({ timeout: 8000 });
      await stamp(page, 'myreels:clicked');
      // reel list rendered (a reel/thumbnail or a collection card)
      await page.waitForTimeout(2500);
      await stamp(page, 'myreels:settled');
    });
    await dumpResourceTiming(page, 'cold-myreels');

    // ---- 6. PLAY a reel / recap: video playing -----------------------------
    await leg('play', async () => {
      await stamp(page, 'play:navStart');
      // In the My Reels panel, click a Play affordance to open the story player.
      const playBtn = page.getByRole('button', { name: /^Play/i }).first();
      if (await playBtn.count()) {
        await playBtn.click({ timeout: 8000 }).catch(() => {});
      } else {
        await page.locator('[data-testid="project-card"], img').first().click({ timeout: 8000 }).catch(() => {});
      }
      await stamp(page, 'play:clicked');
      // Wait for a player video to actually start playing (currentTime advances).
      await page.waitForFunction(() => {
        const vids = [...document.querySelectorAll('video')];
        return vids.some((v) => v.readyState >= 2 && v.currentTime > 0);
      }, { timeout: 15000 }).catch(() => {});
      await stamp(page, 'play:settled');
    });
    await dumpResourceTiming(page, 'cold-play');
    await stamp(page, 'walk:end');

    } finally {
      // Always flush marks + HAR, even if a slow leg tripped the test timeout.
      writeMarks(marks, 'cold');
      await context.close().catch(() => {}); // flushes the HAR to disk
    }

    // ---- clock sanity + coverage assertions --------------------------------
    // Clock-agreement: browser Date.now() and node Date.now() must be the SAME
    // epoch clock (same machine) — proves the marks sit on the HAR's timeline.
    const paired = marks.filter((m) => m.browserEpoch && m.nodeEpoch);
    expect(paired.length, 'PERF marks were captured on both clocks').toBeGreaterThan(3);
    const maxSkew = Math.max(...paired.map((m) => Math.abs(m.browserEpoch - m.nodeEpoch)));
    console.log(`[T4770] cold: ${marks.length} marks, max browser<->node epoch skew = ${maxSkew}ms`);
    expect(maxSkew, 'browser Date.now() and node Date.now() are the same epoch clock').toBeLessThan(2000);

    // Assert we actually reached the headline milestone (games visible).
    expect(marks.some((m) => m.label === 'home:gamesVisible'), 'home games became visible').toBeTruthy();
    expect(fs.existsSync(harPath), 'cold HAR written').toBeTruthy();
    console.log(`[T4770] cold HAR: ${harPath} (${(fs.statSync(harPath).size / 1024 / 1024).toFixed(1)} MB)`);
  });

  test('warm-cache home (second visit — first-impression on a warm cache)', async ({ browser }) => {
    test.setTimeout(120000);
    const harPath = path.join(OUT_DIR, 'warm.har');
    const context = await browser.newContext({
      baseURL: BASE_URL,
      recordHar: { path: harPath, content: 'omit', mode: 'full' },
    });
    await installMediaTracer(context);
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
    const page = await context.newPage();
    const marks = collectMarks(page);

    // Warm-up navigation to populate the module + asset cache.
    await page.goto('/', { waitUntil: 'load' });
    await page.locator('button:has-text("Games")').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.getByText('Legends', { exact: false }).first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // Measured WARM pass: reload with cache warm.
    await stamp(page, 'warm:home:gotoStart');
    await page.reload({ waitUntil: 'commit' });
    await page.locator('button:has-text("Games")').first().waitFor({ state: 'visible', timeout: 30000 });
    await stamp(page, 'warm:home:appShell');
    await page.locator('button:has-text("Games")').first().click().catch(() => {});
    await page.getByText('Legends', { exact: false }).first().waitFor({ state: 'visible', timeout: 30000 });
    await stamp(page, 'warm:home:gamesVisible');
    await page.waitForTimeout(800);
    await stamp(page, 'warm:home:settled');
    await dumpResourceTiming(page, 'warm-home');

    writeMarks(marks, 'warm');
    expect(marks.some((m) => m.label === 'warm:home:gamesVisible'), 'warm home games visible').toBeTruthy();

    await context.close();
    expect(fs.existsSync(harPath), 'warm HAR written').toBeTruthy();
    console.log(`[T4770] warm HAR: ${harPath} (${(fs.statSync(harPath).size / 1024 / 1024).toFixed(1)} MB)`);
  });
});
