import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { loginAsRealUser } from './helpers/realAuth';

/**
 * T4774 — Main-thread gap PROFILER (attribution, not the walkthrough).
 *
 * The T4770 walkthrough measures `videoReady -> settled` as a hardcoded
 * waitForTimeout(1500), so that number CANNOT show whether real main-thread work
 * shrank. This spec measures the REAL post-videoReady main-thread cost two ways:
 *
 *  1. PerformanceObserver('longtask') installed before navigation — every long
 *     task (>50ms) on the timeline, filtered to the window AFTER videoReady
 *     (performance.now() timebase, same as longtask.startTime). The sum of these
 *     is the actual main-thread BUSY time; `lastLongtaskEnd - videoReady` is the
 *     TRUE settle time (when the main thread finally goes idle).
 *
 *  2. CDP JS CPU profiler wrapped around each editor leg -> top self-time
 *     functions, dumped to /tmp/t4774-prof/*.json for before/after diffing.
 *
 * Read/observe only; mutates no account data (opens existing drafts).
 * Run in-container:  bash scripts/dev-verify.sh e2e/T4774-mainthread-profile.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE_ID = process.env.E2E_PROFILE_ID || '9fa7378c';
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const OUT_DIR = process.env.T4774_PROF_OUT || '/tmp/t4774-prof';
const SETTLE_MS = Number(process.env.T4774_SETTLE_MS || 2600); // > the 1500 the walkthrough waits

fs.mkdirSync(OUT_DIR, { recursive: true });

/** Install a longtask recorder into every page of the context, before any app JS. */
async function installLongtaskRecorder(context) {
  await context.addInitScript(() => {
    window.__longtasks = [];
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__longtasks.push({
            start: e.startTime,
            duration: e.duration,
            name: e.name,
            attribution: (e.attribution || []).map((a) => a.name || a.containerType || ''),
          });
        }
      });
      obs.observe({ entryTypes: ['longtask'] });
    } catch { /* longtask unsupported */ }
  });
}

/** Wait until <video> is ready (readyState>=2), then stamp perf.now() as t0. */
async function waitVideoReady(page) {
  await page.locator('video').first().waitFor({ state: 'attached', timeout: 30000 });
  await page
    .waitForFunction(() => {
      const v = document.querySelector('video');
      return v && v.readyState >= 2;
    }, { timeout: 40000 })
    .catch(() => {});
  return page.evaluate(() => performance.now());
}

/** After settling, pull the longtasks that started at/after videoReady. */
async function collectAfter(page, t0) {
  return page.evaluate((videoReady) => {
    const all = window.__longtasks || [];
    const after = all.filter((t) => t.start >= videoReady - 5);
    const totalBusy = after.reduce((s, t) => s + t.duration, 0);
    const lastEnd = after.length ? Math.max(...after.map((t) => t.start + t.duration)) : videoReady;
    return {
      videoReady,
      // Sanity: total long tasks seen this leg (proves the observer is live even
      // when 0 fire after videoReady).
      allLongtasksThisLeg: all.length,
      allLongtaskMs: Math.round(all.reduce((s, t) => s + t.duration, 0)),
      count: after.length,
      totalBusyMs: Math.round(totalBusy),
      trueSettleMs: Math.round(lastEnd - videoReady),
      tasks: after
        .map((t) => ({ offset: Math.round(t.start - videoReady), dur: Math.round(t.duration), attribution: t.attribution }))
        .sort((a, b) => b.dur - a.dur),
    };
  }, t0);
}

/** Aggregate a CDP CPU profile into top self-time functions. */
function topFunctions(profile, limit = 25) {
  const { nodes, samples, timeDeltas } = profile;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const selfUs = new Map(); // nodeId -> microseconds
  for (let i = 0; i < samples.length; i++) {
    const id = samples[i];
    const dt = timeDeltas[i] || 0;
    selfUs.set(id, (selfUs.get(id) || 0) + dt);
  }
  const agg = new Map(); // "fn @ url:line" -> us
  for (const [id, us] of selfUs) {
    const n = byId.get(id);
    if (!n) continue;
    const cf = n.callFrame;
    const name = cf.functionName || '(anonymous)';
    const url = (cf.url || '').split('/').slice(-1)[0] || cf.url || 'native';
    const key = `${name} @ ${url}:${cf.lineNumber + 1}`;
    agg.set(key, (agg.get(key) || 0) + us);
  }
  const total = [...selfUs.values()].reduce((s, v) => s + v, 0);
  const top = [...agg.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, us]) => ({ fn: k, selfMs: +(us / 1000).toFixed(1), pct: +((us / total) * 100).toFixed(1) }));
  return { totalMs: +(total / 1000).toFixed(1), top };
}

async function profileLeg(page, client, label, enterFn) {
  await client.send('Profiler.enable');
  await client.send('Profiler.setSamplingInterval', { interval: 200 }); // 200us = fine-grained
  await client.send('Profiler.start');
  await enterFn();
  const t0 = await waitVideoReady(page);
  await page.waitForTimeout(SETTLE_MS);
  const { profile } = await client.send('Profiler.stop');
  // Visual proof the screen is fully rendered when the video is ready (crop
  // reticule / highlight regions painted — no frozen-frame "settle" beat).
  await page.screenshot({ path: path.join(OUT_DIR, `screenshot-${label}.png`) }).catch(() => {});
  const longtasks = await collectAfter(page, t0);
  const fns = topFunctions(profile);
  const out = { label, longtasks, cpuProfileTopFns: fns };
  fs.writeFileSync(path.join(OUT_DIR, `prof-${label}.json`), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, `cpuprofile-${label}.cpuprofile`), JSON.stringify(profile));
  // human summary
  const lines = [];
  lines.push(`=== ${label} ===`);
  lines.push(`longtask observer sanity: ${longtasks.allLongtasksThisLeg} long tasks this leg (${longtasks.allLongtaskMs}ms total)`);
  lines.push(`videoReady -> main-thread idle (TRUE settle): ${longtasks.trueSettleMs}ms`);
  lines.push(`main-thread BUSY after videoReady: ${longtasks.totalBusyMs}ms across ${longtasks.count} long tasks`);
  lines.push(`longest tasks (offset ms after videoReady / dur ms / attribution):`);
  longtasks.tasks.slice(0, 12).forEach((t) => lines.push(`  +${t.offset}ms  ${t.dur}ms  ${t.attribution.join(',')}`));
  lines.push(`top CPU self-time functions in the leg (total sampled ${fns.totalMs}ms):`);
  fns.top.forEach((f) => lines.push(`  ${f.selfMs}ms  ${f.pct}%  ${f.fn}`));
  const txt = lines.join('\n') + '\n';
  fs.writeFileSync(path.join(OUT_DIR, `prof-${label}.txt`), txt);
  console.log('\n' + txt);
  return out;
}

test.describe('T4774 main-thread gap profiler', () => {
  test('profile framing + overlay post-videoReady main-thread work', async ({ browser }) => {
    test.setTimeout(240000);
    const context = await browser.newContext({ baseURL: BASE_URL });
    await installLongtaskRecorder(context);
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
    const page = await context.newPage();
    const client = await context.newCDPSession(page);

    // Prime: land on home so bootstrap/games are loaded once (not part of a leg).
    await page.goto('/', { waitUntil: 'commit' });
    await page.locator('button:has-text("Games")').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1500);

    // ---- FRAMING leg ----
    const framing = await profileLeg(page, client, 'framing', async () => {
      await page.goto('/', { waitUntil: 'commit' });
      await page.getByRole('button', { name: 'Reel Drafts' }).first().waitFor({ state: 'visible', timeout: 15000 });
      await page.getByRole('button', { name: 'Reel Drafts' }).first().click({ timeout: 8000 });
      const card = page.locator('[data-testid="project-card"]').first();
      await card.waitFor({ state: 'visible', timeout: 20000 });
      const framingChip = page.getByTitle(/\[.+\]: .*\(click to open\)/).first();
      await framingChip.waitFor({ state: 'visible', timeout: 12000 });
      await framingChip.click({ timeout: 8000 });
    });

    // ---- OVERLAY leg ----
    const overlay = await profileLeg(page, client, 'overlay', async () => {
      await page.goto('/', { waitUntil: 'commit' });
      await page.getByRole('button', { name: 'Reel Drafts' }).first().waitFor({ state: 'visible', timeout: 15000 });
      await page.getByRole('button', { name: 'Reel Drafts' }).first().click({ timeout: 8000 });
      const overlayBtn = page.getByTitle('Open in Overlay').first();
      await overlayBtn.waitFor({ state: 'visible', timeout: 12000 });
      await overlayBtn.click({ timeout: 8000 });
    });

    await context.close();

    // Sanity: we actually captured a video-ready and some timeline.
    expect(framing.longtasks.videoReady, 'framing videoReady captured').toBeGreaterThan(0);
    expect(overlay.longtasks.videoReady, 'overlay videoReady captured').toBeGreaterThan(0);
    console.log(`[T4774-prof] framing trueSettle=${framing.longtasks.trueSettleMs}ms busy=${framing.longtasks.totalBusyMs}ms | overlay trueSettle=${overlay.longtasks.trueSettleMs}ms busy=${overlay.longtasks.totalBusyMs}ms`);
  });
});
