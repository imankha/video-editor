import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T4110 — Edit-a-reel re-export/publish silently lost end to end (STEP 1: LIVE REPRO).
 *
 * Drives the app AS THE REAL USER (imankh@gmail.com, prod-copied into dev) to
 * confirm the exact break point of the prod data-loss bug:
 *   My Reels -> Re-edit a published game-6 reel -> reframe -> export ->
 *   "Move to My Reels" -> reload -> is the edited reel present & no phantom card?
 *
 * This is an INVESTIGATION spec, not a guardrail: every check is soft and the
 * test ends by dumping a structured CAPTURE block (network statuses, [ReExport]/
 * [Publish]/[SYNC]/[Restore]-relevant requests, collections-summary snapshots,
 * and the count of "Game Highlights" cards) so we can read the break point off
 * one run even when a later stage stalls.
 *
 * Known dev-vs-prod limitation (reported, not worked around): the actual prod
 * loss is triggered by the single Fly machine CYCLING before the export
 * finalize's fire-and-forget R2 sync lands. Dev runs one continuous process with
 * no machine cycle, so the locally-committed rows survive a reload here; what dev
 * CAN show is (a) whether the export-finalize path is durable (it is not — see
 * the [SYNC] capture / lack of a durable sync on the render endpoint), (b) the
 * publish status (200 vs 503), and (c) whether a 2nd eligible ratio / phantom
 * "Game Highlights" card materialises from the in-flight edit.
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T4110-reedit-reel-persistence.spec.js --reporter=line
 */

const REAL_EMAIL = 'imankh@gmail.com';
const PROFILE_ID = '9fa7378c';
const GAME6_ID = 6;

// API paths whose status we care about for the durability story.
const WATCH = [
  '/restore-project',
  '/api/downloads/publish/',
  '/api/export/render-overlay',
  '/api/export/render',
  '/api/export/final',
  '/api/export/overlay',
  '/api/collections/summary',
];

test('T4110 live repro: re-edit a game-6 reel, export, move to My Reels, reload', async ({ context, page }) => {
  // T5420: explicitly a DEV INVESTIGATION spec (not a guardrail) — it drives a full
  // re-edit -> reframe -> overlay-export -> publish -> reload pipeline whose overlay-export
  // panel does not mount on staging (see derisk-staging-export + FIXTURE-CONTRACT), and
  // reads a relative /api (CF Pages returns SPA HTML). Its own header documents the
  // dev-vs-prod machine-cycle limitation. Skip loudly on a deployed target.
  skipOnDeployedTarget(test, 'dev investigation spec: full re-edit->overlay-export->publish pipeline (overlay-export does not mount on staging) + relative /api');
  const cap = {
    net: [],        // {method, url, status} for WATCHed paths
    console: [],     // page console messages
    pageErrors: [],
    snapshots: {},   // named collections-summary snapshots
    cards: {},       // named "Game Highlights" card counts (DOM)
    notes: [],
  };
  const note = (m) => { cap.notes.push(m); console.log(`[T4110] ${m}`); };

  page.on('console', (msg) => {
    const t = msg.text();
    if (/\[(useReEditReel|ExportButtonContainer|Publish|ReExport|SYNC|Restore|DBG)\]/.test(t)
        || msg.type() === 'error' || msg.type() === 'warning') {
      cap.console.push(`${msg.type()}: ${t}`.slice(0, 300));
    }
  });
  page.on('pageerror', (e) => cap.pageErrors.push(String(e).slice(0, 300)));
  page.on('response', (res) => {
    const url = res.url();
    if (WATCH.some((p) => url.includes(p))) {
      cap.net.push({ method: res.request().method(), url: url.replace(/https?:\/\/[^/]+/, ''), status: res.status() });
    }
  });

  // --- auth -----------------------------------------------------------------
  await loginAsRealUser(context, REAL_EMAIL);

  // Deterministic snapshot of the game-6 eligible-ratio set (= # of "Game
  // Highlights" cards). Uses the context cookie jar + profile header.
  const summarizeGame6 = async (label) => {
    const res = await context.request.get('/api/collections/summary', {
      headers: { 'X-Profile-ID': PROFILE_ID },
    });
    let eligible = null, reelCount = null, ratioCounts = null;
    if (res.ok()) {
      const j = await res.json();
      const g = (j.games || []).find((b) => b.game_id === GAME6_ID);
      if (g) {
        ratioCounts = g.ratio_counts;
        eligible = Object.entries(g.ratio_eligible || {}).filter(([, v]) => v).map(([k]) => k);
        reelCount = g.reel_count;
      }
    }
    cap.snapshots[label] = { http: res.status(), reelCount, eligibleRatios: eligible, ratioCounts };
    note(`summary[${label}]: game6 reel_count=${reelCount} eligibleRatios=${JSON.stringify(eligible)}`);
    return eligible;
  };

  await summarizeGame6('baseline');

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  // --- open My Reels --------------------------------------------------------
  const myReelsBtn = page.getByRole('button', { name: /My Reels/i }).first();
  await myReelsBtn.click({ timeout: 30000 }).catch(() => note('My Reels button not clickable'));
  // The collections tab / game groups render inside the slide-out panel.
  await page.getByText('Game Highlights').first().waitFor({ timeout: 30000 }).catch(() => note('no Game Highlights card rendered'));

  const countGameHighlightsCards = async (label) => {
    // Each game group renders one "Game Highlights" CollectionCard per eligible
    // ratio. We count headers under the game-6 group's expanded region. The
    // first game group is default-expanded; game 6 is among the groups.
    const n = await page.getByText('Game Highlights', { exact: true }).count();
    cap.cards[label] = n;
    note(`"Game Highlights" cards in DOM [${label}] = ${n}`);
    return n;
  };
  await countGameHighlightsCards('baseline');

  // --- open a game-6 reel into the player and hit Re-edit -------------------
  // Open the collection player via a "Play all" affordance, then Re-edit the
  // active reel (the player carries the per-reel "Re-edit this reel" button).
  const reEditBtn = page.getByTitle('Re-edit this reel');
  let inEditor = false;
  // Try to open the shared player: click the first Game Highlights card's play.
  const playAll = page.getByRole('button', { name: /play all/i }).first();
  if (await playAll.count()) {
    await playAll.click({ timeout: 15000 }).catch(() => note('play-all click failed'));
  } else {
    note('no play-all button found; trying a reel card');
    const card = page.locator('[data-testid="reel-card"], video, [role="button"]').first();
    await card.click({ timeout: 10000 }).catch(() => {});
  }
  await reEditBtn.first().waitFor({ timeout: 20000 }).catch(() => note('Re-edit button not visible (player may not have opened)'));
  if (await reEditBtn.count()) {
    await reEditBtn.first().click({ timeout: 15000 }).catch(() => note('Re-edit click failed'));
    // Restore-project fires; editor navigation follows on 200.
    await page.waitForTimeout(4000);
    inEditor = true;
  }
  await summarizeGame6('after-restore');

  // --- make a reframe edit + export + Move to My Reels (best effort) --------
  // The editor selectors aren't all locked down for headless; this stage is
  // defensive. We record what fires. A reframe to a non-9:16 ratio is what would
  // add a 2nd eligible ratio (the phantom card); we try a ratio toggle if shown.
  if (inEditor) {
    const ratioToggle = page.getByRole('button', { name: /16:9|1:1|4:5|square|landscape/i }).first();
    if (await ratioToggle.count()) {
      await ratioToggle.click({ timeout: 8000 }).catch(() => note('ratio toggle click failed'));
      note('clicked a ratio toggle (reframe attempt)');
    } else {
      note('no aspect-ratio toggle found; reframe-by-ratio not exercised');
    }

    const exportBtn = page.getByRole('button', { name: /Export( Highlight)?|Add Spotlight/i }).first();
    if (await exportBtn.count()) {
      await exportBtn.click({ timeout: 10000 }).catch(() => note('export click failed'));
      note('clicked export; waiting up to 120s for completion / Move-to-My-Reels');
      // Wait for either an export-complete signal or a publish button to appear.
      const moveBtn = page.getByRole('button', { name: /Move to My Reels/i }).first();
      const completeMsg = page.getByText(/Export complete/i).first();
      await Promise.race([
        moveBtn.waitFor({ timeout: 120000 }).catch(() => {}),
        completeMsg.waitFor({ timeout: 120000 }).catch(() => {}),
      ]);
      if (await moveBtn.count()) {
        await moveBtn.click({ timeout: 10000 }).catch(() => note('Move-to-My-Reels click failed'));
        note('clicked "Move to My Reels"');
        await page.waitForTimeout(5000);
      } else {
        note('no "Move to My Reels" button appeared (export likely did not finalize live)');
      }
    } else {
      note('no Export button found in editor view');
    }
  }

  await summarizeGame6('after-export-publish');

  // --- reload and re-check --------------------------------------------------
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.getByRole('button', { name: /My Reels/i }).first().click({ timeout: 30000 }).catch(() => {});
  await page.getByText('Game Highlights').first().waitFor({ timeout: 30000 }).catch(() => note('post-reload: no Game Highlights card'));
  await countGameHighlightsCards('after-reload');
  await summarizeGame6('after-reload');

  // --- dump capture ---------------------------------------------------------
  console.log('\n========== T4110 CAPTURE ==========');
  console.log(JSON.stringify(cap, null, 2));
  console.log('========== END T4110 CAPTURE ==========\n');

  // Soft assertions — surface, don't abort.
  expect.soft(cap.snapshots.baseline?.eligibleRatios, 'baseline game-6 eligible ratios').toEqual(['9:16']);
  expect.soft(cap.cards.baseline, 'baseline Game Highlights card count').toBe(1);
});
