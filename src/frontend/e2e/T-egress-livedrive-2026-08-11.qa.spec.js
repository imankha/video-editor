/**
 * Part A egress live-drive QA (docs/testing/derisk-plan-2026-08-11.md) --
 * verifies every place a video LEAVES the app after this release's rewrite of
 * serve-time ffmpeg composition (`[intro][reel][outro]`), share-page
 * playback/download, and collection share freeze. None of this was live-
 * tested before (staging-verification-2026-08-10-RESULTS.md "Not exercised
 * this pass"). Driven against the running container (reel-task-testsweep2)
 * as the real account imankh@gmail.com / profile 9fa7378c via dev-login.
 *
 * Checklist (verbatim from the derisk plan, Part A):
 *   1. owner download of a reel with an intro -> ONE composed file (ffprobe)
 *   2. share link playback, logged out -> intro plays, reel auto-resumes
 *   3. share-page in-app download button -> composed file (ffprobe)
 *   4. KNOWN GAP (confirm only): public share page footer <a class="dl">
 *      still points at the raw, uncomposed video_url
 *   5. desktop Share button -> app ShareModal, never navigator.share;
 *      mobile emulation -> native share path still attempted
 *   6. collection share freeze: changing a collection's attached intro AFTER
 *      a share link exists must not retroactively change that link
 *   7. re-export carries the intro forward onto the new final_videos row
 *
 * Run:
 *   cd src/frontend && E2E_BASE_URL=http://localhost:5176 npx playwright test \
 *     e2e/T-egress-livedrive-2026-08-11.qa.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence, QA_DIR } from './helpers/qa.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileP = promisify(execFile);

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

// app/services/branded_outro.py OUTRO_DURATION -- fixed branded-outro length
// appended to every composed download/share.
const OUTRO_DURATION_SEC = 4.5;
// Concat re-encode / GOP-alignment slack. Generous on purpose: this is a live
// end-to-end duration check, not a frame-exact unit test.
const DURATION_TOLERANCE_SEC = 2.5;

async function probeVideo(filePath) {
  const { stdout } = await execFileP('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-show_entries', 'stream=width,height',
    '-of', 'json',
    filePath,
  ]);
  return JSON.parse(stdout);
}

async function extractFrame(filePath, atSec, outPath) {
  await execFileP('ffmpeg', ['-y', '-ss', String(atSec), '-i', filePath, '-frames:v', '1', outPath]);
}

async function saveResponseBytesToTemp(resp, suffix) {
  const buf = await resp.body();
  const file = path.join(
    os.tmpdir(),
    `egress-qa-${Date.now()}-${Math.random().toString(36).slice(2)}.${suffix}`,
  );
  fs.writeFileSync(file, buf);
  return file;
}

// Known-good reels per the kickoff's "already queried" account data (ids 64,
// 23, 27 all carry "T6670 inline-create QA card"). Preferred over "first
// match in the list" because item 7 (re-export) is destructive -- it deletes
// the prior final_videos row and republishes a new id for the same project,
// which then sorts to the FRONT of the list (most-recently-published) on any
// re-run. Preferring the known ids keeps items 1/2/3's duration math stable
// across repeated local runs instead of drifting onto whatever id item 7
// last produced.
const PREFERRED_INTRO_REEL_IDS = [64, 23, 27];

/** A download with an intro attached, optionally excluding some ids (used so
 * items that mutate a reel don't collide with items that already asserted
 * against a specific reel's bytes/token). Prefers the known-good ids above;
 * falls back to the first list match (e.g. after they've all been consumed
 * by repeated local re-export runs). */
function pickIntroReel(list, excludeIds = []) {
  const byId = new Map(list.downloads.map((d) => [d.id, d]));
  for (const id of PREFERRED_INTRO_REEL_IDS) {
    const d = byId.get(id);
    if (d && d.intro_card_name && !excludeIds.includes(d.id)) return d;
  }
  return list.downloads.find((d) => d.intro_card_name && !excludeIds.includes(d.id));
}

test.describe('Part A - Egress live-drive QA (2026-08-11)', () => {
  test.setTimeout(120_000);

  // Shared across items 1/2/3/7: one authenticated owner context + one target
  // reel-with-intro + its share token. workers:1/fullyParallel:false (this
  // project's playwright.config.js) guarantees these tests run in ONE worker
  // in file order, so beforeAll's module-scoped state is safe to share --
  // NOT test.describe.serial(), which would skip every remaining item after
  // the first failure (violates the derisk plan's "still finish documenting
  // the OTHER checklist items" failure protocol).
  let ownerCtx;
  let reel;
  let introDurationSec;
  let shareToken;

  test.beforeAll(async ({ browser }) => {
    ownerCtx = await browser.newContext();
    await loginAsRealUser(ownerCtx, EMAIL, PROFILE);

    const listResp = await ownerCtx.request.get('/api/downloads');
    expect(listResp.ok(), 'GET /api/downloads must succeed for the owner').toBeTruthy();
    const list = await listResp.json();
    reel = pickIntroReel(list);
    if (!reel) {
      throw new Error('[Part A] account has no published reel with an intro attached -- cannot run egress QA (expected one of ids 64/23/27)');
    }
    console.log(`[Part A][setup] target reel id=${reel.id} intro="${reel.intro_card_name}" duration=${reel.duration}s project_id=${reel.project_id}`);

    const introResp = await ownerCtx.request.get(`/api/downloads/${reel.id}/intro-playback`);
    expect(introResp.ok(), 'intro-playback resolve must succeed').toBeTruthy();
    const introPayload = await introResp.json();
    if (!introPayload.intro) {
      throw new Error(`[Part A] resolver returned null intro for reel ${reel.id} despite intro_card_name="${reel.intro_card_name}" being set`);
    }
    introDurationSec = introPayload.intro.card?.duration || 4.0;
    console.log(`[Part A][setup] intro card duration=${introDurationSec}s`);

    const shareResp = await ownerCtx.request.post(`/api/gallery/${reel.id}/share`, {
      data: { recipient_emails: [], is_public: true },
    });
    expect(shareResp.ok(), 'share creation must succeed').toBeTruthy();
    const shareBody = await shareResp.json();
    shareToken = shareBody.shares[0].share_token;
    console.log(`[Part A][setup] created public share token=${shareToken} for reel ${reel.id}`);
  });

  test.afterAll(async () => {
    if (ownerCtx && shareToken) {
      await ownerCtx.request.delete(`/api/shared/${shareToken}`).catch(() => {});
    }
    await ownerCtx?.close();
  });

  // -------------------------------------------------------------------
  // Item 1: owner download composes ONE file [intro][reel][outro]
  // -------------------------------------------------------------------
  test('item 1: owner download of a reel with an intro composes ONE file [intro][reel][outro]', async () => {
    const fileResp = await ownerCtx.request.get(`/api/downloads/${reel.id}/file`, { timeout: 60_000 });
    expect(fileResp.ok(), `GET /api/downloads/${reel.id}/file must succeed`).toBeTruthy();
    expect(fileResp.headers()['content-type']).toContain('video/mp4');

    const localFile = await saveResponseBytesToTemp(fileResp, 'mp4');
    console.log(`[Part A][item1] downloaded ${fs.statSync(localFile).size} bytes -> ${localFile}`);

    const probe = await probeVideo(localFile);
    console.log(`[Part A][item1] ffprobe: ${JSON.stringify(probe)}`);
    const actualDuration = parseFloat(probe.format.duration);
    const reelDuration = reel.duration || 0;
    const expectedDuration = introDurationSec + reelDuration + OUTRO_DURATION_SEC;
    console.log(`[Part A][item1] duration actual=${actualDuration.toFixed(2)}s expected~=${expectedDuration.toFixed(2)}s (intro=${introDurationSec} + reel=${reelDuration} + outro=${OUTRO_DURATION_SEC})`);
    expect(
      Math.abs(actualDuration - expectedDuration),
      `composed duration ${actualDuration}s should be within ${DURATION_TOLERANCE_SEC}s of intro+reel+outro=${expectedDuration}s`,
    ).toBeLessThan(DURATION_TOLERANCE_SEC);

    fs.mkdirSync(QA_DIR, { recursive: true });
    const framePath = path.join(QA_DIR, 'part-a-item-1-owner-download-intro-frame-0.5s.png');
    await extractFrame(localFile, 0.5, framePath);
    expect(fs.existsSync(framePath), 'frame extraction at t=0.5s must produce a file').toBeTruthy();
    console.log(`[Part A][item1] evidence frame (should show the intro card, not the reel) saved: ${framePath}`);
  });

  // -------------------------------------------------------------------
  // Item 2: share link playback, logged out -- intro plays, reel
  // auto-resumes with NO manual tap (regressed once before).
  // -------------------------------------------------------------------
  test('item 2: share link playback (logged out) -- intro plays then reel auto-resumes with no manual tap', async ({ page }) => {
    // Default `page`/`context` fixtures are a FRESH context per test (no
    // cookies) -- loginAsRealUser is never called in this test.
    await page.goto(`/shared/${shareToken}`);
    const video = page.locator('video').first();
    await expect(video, 'MediaPlayer video element must mount (even while paused under the intro overlay)')
      .toBeVisible({ timeout: 20_000 });
    await saveEvidence(page, 'part-a-item-2-share-page-loaded-intro-showing');

    // Intro pre-roll runs its own rAF fallback clock (IntroPreRoll, no
    // currentTimeMs driven in) up to the card's duration, then fires onDone
    // -> introShowing=false -> MediaPlayer's autoPlay flips true. Poll for
    // the video to start ADVANCING on its own (not just becoming ready).
    const waitMs = (introDurationSec * 1000) + 10_000;
    await page.waitForFunction(
      () => {
        const v = document.querySelector('video');
        return !!v && !v.paused && v.currentTime > 0.3;
      },
      undefined,
      { timeout: waitMs },
    );

    const t1 = await page.evaluate(() => document.querySelector('video')?.currentTime);
    await page.waitForTimeout(2000);
    const t2 = await page.evaluate(() => document.querySelector('video')?.currentTime);
    const paused = await page.evaluate(() => document.querySelector('video')?.paused);
    console.log(`[Part A][item2] video currentTime t1=${t1?.toFixed(2)}s t2=${t2?.toFixed(2)}s paused=${paused} (must be advancing on its own, no manual tap)`);
    expect(paused, 'video must be playing, not paused-but-ready').toBe(false);
    expect(t2, 'currentTime must have genuinely advanced over the 2s window').toBeGreaterThan(t1);
    await saveEvidence(page, 'part-a-item-2-reel-auto-resumed-playing');
  });

  // -------------------------------------------------------------------
  // Item 3: share-page in-app download button serves the composed file.
  // -------------------------------------------------------------------
  test('item 3: share-page in-app download endpoint serves the composed [intro][reel][outro] file', async ({ browser }) => {
    // Genuinely logged-out context -- GET /api/shared/{token}/download is a
    // public, token-authenticated endpoint (mirrors the real SharedVideoOverlay
    // download button, which any visitor with the link can click).
    const anonCtx = await browser.newContext();
    try {
      // Ported from T5220 (folded here on removal): the public GET
      // /api/shared/{token} metadata endpoint carries the optional `intro`
      // field without erroring, and an unknown token on the composed-download
      // endpoint must 404 (not 500). Both are token-authenticated public paths,
      // so they run on the same logged-out anon context as the download below.
      const getSharedResp = await anonCtx.request.get(`/api/shared/${shareToken}`);
      expect(getSharedResp.ok(), `GET /api/shared/${shareToken} must succeed logged-out`).toBeTruthy();
      const shared = await getSharedResp.json();
      expect(shared, 'GET /api/shared/{token} must carry the optional intro field').toHaveProperty('intro');
      console.log(`[Part A][item3] GET /api/shared/${shareToken} -> intro field present, value=${JSON.stringify(shared.intro)}`);

      const bogusResp = await anonCtx.request.get('/api/shared/definitely-not-a-real-token/download');
      console.log(`[Part A][item3] probe: GET /api/shared/<bogus>/download -> ${bogusResp.status()}`);
      expect(bogusResp.status(), 'unknown share token must 404, not 500').toBe(404);

      const dlResp = await anonCtx.request.get(`/api/shared/${shareToken}/download`, { timeout: 60_000 });
      expect(dlResp.ok(), `GET /api/shared/${shareToken}/download must succeed logged-out`).toBeTruthy();
      expect(dlResp.headers()['content-type']).toContain('video/mp4');
      expect(dlResp.headers()['content-disposition']).toContain('attachment');

      const localFile = await saveResponseBytesToTemp(dlResp, 'mp4');
      console.log(`[Part A][item3] downloaded ${fs.statSync(localFile).size} bytes -> ${localFile}`);

      const probe = await probeVideo(localFile);
      console.log(`[Part A][item3] ffprobe: ${JSON.stringify(probe)}`);
      const actualDuration = parseFloat(probe.format.duration);
      const reelDuration = reel.duration || 0;
      const expectedDuration = introDurationSec + reelDuration + OUTRO_DURATION_SEC;
      console.log(`[Part A][item3] duration actual=${actualDuration.toFixed(2)}s expected~=${expectedDuration.toFixed(2)}s (intro=${introDurationSec} + reel=${reelDuration} + outro=${OUTRO_DURATION_SEC})`);
      expect(
        Math.abs(actualDuration - expectedDuration),
        `composed duration ${actualDuration}s should be within ${DURATION_TOLERANCE_SEC}s of intro+reel+outro=${expectedDuration}s`,
      ).toBeLessThan(DURATION_TOLERANCE_SEC);

      fs.mkdirSync(QA_DIR, { recursive: true });
      const framePath = path.join(QA_DIR, 'part-a-item-3-share-download-intro-frame-0.5s.png');
      await extractFrame(localFile, 0.5, framePath);
      expect(fs.existsSync(framePath)).toBeTruthy();
      console.log(`[Part A][item3] evidence frame (should show the intro card) saved: ${framePath}`);
    } finally {
      await anonCtx.close();
    }
  });

  // -------------------------------------------------------------------
  // Item 4 (KNOWN GAP -- confirm current behavior, do NOT fix): the public
  // Cloudflare Pages Function share page's plain-HTML footer download link
  // still points at the raw video_url, no intro/outro composited in.
  // -------------------------------------------------------------------
  test('item 4 (KNOWN GAP - confirm only): public share-page footer download link is the raw, uncomposed video_url', async () => {
    const fnPath = path.resolve(__dirname, '..', 'functions', 'shared', '[token].js');
    expect(fs.existsSync(fnPath), `expected the CF Pages Function at ${fnPath}`).toBeTruthy();
    const src = fs.readFileSync(fnPath, 'utf8');

    // (a) videoUrl is built directly from share.video_url (no compose call).
    expect(src).toMatch(/const\s+videoUrl\s*=\s*escapeHtml\(share\.video_url\)/);
    // (b) the footer's download anchor uses that same raw videoUrl.
    expect(src).toMatch(/<a class="dl" href="\$\{videoUrl\}" download>Download<\/a>/);
    // (c) nothing in this file calls into the compose/serve-time machinery or
    // the composed-download endpoint -- confirms the gap is total, not partial.
    expect(src).not.toMatch(/compose_serve_time|composeServeTime|\/shared\/[^"'`]*\/download/);

    console.log('[Part A][item4] CONFIRMED GAP: functions/shared/[token].js footer <a class="dl"> points at raw share.video_url -- no intro/outro compositing anywhere in this file. This is the documented product gap (release-map §7), not a new bug -- QA correctly characterizes current behavior, no fix applied.');
  });

  // -------------------------------------------------------------------
  // Item 5 (share routing 5a/5b) REMOVED (T7770): the desktop-ShareModal /
  // mobile-native-share routing is now owned by T7350-mobile-share-routing,
  // which keys on the corrected `(pointer: coarse)` capability mechanism
  // (verifying the matchMedia flip) rather than viewport/UA emulation.
  // -------------------------------------------------------------------

  // -------------------------------------------------------------------
  // Item 6: collection share freeze -- changing the collection's attached
  // intro AFTER a share link exists must not retroactively change that link.
  // -------------------------------------------------------------------
  test('item 6: collection share freezes its intro at creation time; a later badge change does not retroactively move it', async () => {
    // Sessions appear to be single-active-per-account (memory: "sessions
    // pinned to one machine") -- any prior loginAsRealUser call on a separate
    // throwaway context can invalidate ownerCtx's original session. Re-auth
    // ownerCtx immediately before using it again here.
    await loginAsRealUser(ownerCtx, EMAIL, PROFILE);

    // Explicit attachment (a real id, not 0/null) is consent-gated
    // (collections.py set_collection_intro / create_collection_share_endpoint,
    // same gate as the reel PATCH). Record the same attestation gesture the
    // ConsentGate checkbox fires -- idempotent, safe to call even if consent
    // was already recorded (as it must have been for reels 64/23/27's
    // existing attachments from prior QA sessions).
    const consentResp = await ownerCtx.request.post(`/api/profiles/${PROFILE}/intro/consent`);
    expect(consentResp.ok(), 'recording intro consent must succeed').toBeTruthy();

    const cardsResp = await ownerCtx.request.get('/api/intro-cards');
    expect(cardsResp.ok()).toBeTruthy();
    const cards = (await cardsResp.json()).cards || [];
    test.skip(cards.length < 1, 'account has no intro cards to exercise the collection-freeze path with');
    const cardA = cards[0];
    const cardB = cards.length > 1 ? cards[1] : null;

    // Attach cardA to the game_id=6 collection's badge.
    const patchA = await ownerCtx.request.patch(
      '/api/collections/intro?scope_type=game&game_id=6&aspect_ratio=9:16',
      { data: { intro_card_id: cardA.id }, headers: { 'Content-Type': 'application/json' } },
    );
    expect(patchA.ok(), 'attaching cardA to the collection badge must succeed').toBeTruthy();
    console.log(`[Part A][item6] attached card ${cardA.id} ("${cardA.name}") to game_id=6 collection`);

    // Create a share, EXPLICITLY freezing cardA (CollectionShareModal reads
    // its own local picker state, not the badge -- see
    // CollectionShareModal.jsx:39; this call mirrors the realistic "share
    // right after attaching, with the same card selected" flow).
    const shareResp = await ownerCtx.request.post('/api/collections/share', {
      data: {
        definition: {
          scope: { type: 'game', game_id: 6 },
          aspect_ratio: '9:16',
          intro_card_id: cardA.id,
        },
        recipient_emails: [],
        is_public: true,
      },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(shareResp.ok(), 'collection share creation must succeed').toBeTruthy();
    const shareBody = await shareResp.json();
    const token = shareBody.shares[0].share_token;
    console.log(`[Part A][item6] created collection share token=${token} frozen intro_card_id=${cardA.id}`);

    const before = await ownerCtx.request.get(`/api/shared/collection/${token}`);
    expect(before.ok()).toBeTruthy();
    const beforeBody = await before.json();
    console.log(`[Part A][item6] GET share BEFORE badge change: intro_card_id=${beforeBody.intro_card_id} intro_card_name=${beforeBody.intro_card_name}`);
    expect(beforeBody.intro_card_id, 'the fresh share must resolve the just-frozen cardA').toBe(cardA.id);

    // Now change the collection's OWN attached intro (badge) to something else.
    const newId = cardB ? cardB.id : 0;
    const patchB = await ownerCtx.request.patch(
      '/api/collections/intro?scope_type=game&game_id=6&aspect_ratio=9:16',
      { data: { intro_card_id: newId }, headers: { 'Content-Type': 'application/json' } },
    );
    expect(patchB.ok(), 'changing the collection badge afterwards must succeed').toBeTruthy();
    console.log(`[Part A][item6] changed game_id=6 collection's attached badge to id=${newId} (${cardB ? cardB.name : 'none'})`);

    const after = await ownerCtx.request.get(`/api/shared/collection/${token}`);
    expect(after.ok()).toBeTruthy();
    const afterBody = await after.json();
    console.log(`[Part A][item6] GET share AFTER badge change: intro_card_id=${afterBody.intro_card_id} intro_card_name=${afterBody.intro_card_name}`);

    // THE FREEZE ASSERTION: the existing link must still show cardA.
    expect(afterBody.intro_card_id, 'existing share must stay frozen at cardA, NOT follow the badge change').toBe(cardA.id);
    if (cardB) {
      expect(afterBody.intro_card_name).toBe(cardA.name);
      expect(afterBody.intro_card_id).not.toBe(newId);
    }

    // Cleanup: restore the collection's badge to unattached. (No revoke
    // endpoint exists for collection shares in this codebase -- only
    // DELETE /api/shared/{token} for single-reel shares -- so the created
    // collection share link is left active, same as the account's existing
    // QA-generated collection shares.)
    await ownerCtx.request.patch(
      '/api/collections/intro?scope_type=game&game_id=6&aspect_ratio=9:16',
      { data: { intro_card_id: 0 }, headers: { 'Content-Type': 'application/json' } },
    ).catch(() => {});
  });

  // -------------------------------------------------------------------
  // Item 7: re-export carries the intro forward onto the new final_videos
  // row (a re-export must not silently drop the attachment -- T5215's top
  // regression risk).
  // -------------------------------------------------------------------
  test('item 7: re-export carries the intro forward onto the new final_videos row', async () => {
    // See item 6's note: re-auth ownerCtx in case an earlier test's own login
    // (item 6's own re-auth of ownerCtx, or any throwaway-context login)
    // invalidated the session again.
    await loginAsRealUser(ownerCtx, EMAIL, PROFILE);
    const listResp = await ownerCtx.request.get('/api/downloads');
    expect(listResp.ok()).toBeTruthy();
    const list = await listResp.json();
    // A DIFFERENT reel than items 1/3's target, so re-exporting (which
    // replaces the row/filename) can't disturb bytes/tokens those tests
    // already asserted against.
    const target = pickIntroReel(list, [reel.id]) || pickIntroReel(list);
    test.skip(!target, 'no reel with an intro attached available for the re-export test');
    test.skip(!target.project_id, `reel ${target.id} has no project_id -- can't drive /api/export/final without one`);
    console.log(`[Part A][item7] re-export target reel id=${target.id} project_id=${target.project_id} intro_card_id(before)=${target.intro_card_id} intro_card_name(before)=${target.intro_card_name}`);

    // Re-upload the RAW stored final-video bytes (NOT /api/downloads/.../file,
    // which is the serve-time COMPOSED [intro][reel][outro] file -- re-
    // uploading that would double-composite on the next download and inflate
    // duration, a pure test-harness artifact unrelated to the carry-forward
    // logic under test). GET .../final-video returns a presigned URL to the
    // raw object as actually stored (composition happens at serve time only).
    // This exercises the backend's carry-forward SQL
    // (export/overlay.py:1746-1830), not the client-side canvas render
    // pipeline, which is out of scope for this DB-contract check.
    const finalVideoResp = await ownerCtx.request.get(`/api/export/projects/${target.project_id}/final-video`);
    expect(finalVideoResp.ok(), 'GET .../final-video (presigned raw URL) must succeed').toBeTruthy();
    const { url: rawVideoUrl } = await finalVideoResp.json();
    const rawResp = await ownerCtx.request.get(rawVideoUrl, { timeout: 60_000 });
    expect(rawResp.ok(), 'fetching the raw final-video bytes from R2 must succeed').toBeTruthy();
    const videoBytes = await rawResp.body();
    console.log(`[Part A][item7] fetched RAW (uncomposed) final-video bytes: ${videoBytes.length}`);

    // A published reel's project has its working data archived to R2
    // (publish_to_my_reels docstring) -- /api/export/final 400s with no
    // working_video_id until the project is re-materialized first. This is
    // the SAME "Open as Draft" gesture the real UI's ReelTile kebab uses
    // (useReEditReel.openReelAsProject -> POST .../restore-project), which
    // also unpublishes the reel (moves it back to Drafts) until re-published.
    const restoreResp = await ownerCtx.request.post(`/api/downloads/${target.id}/restore-project`, { timeout: 30_000 });
    expect(restoreResp.ok(), 'restore-project (Open as Draft) must succeed').toBeTruthy();
    const restoreBody = await restoreResp.json();
    const restoredProjectId = restoreBody.project_id;
    console.log(`[Part A][item7] restored project_id=${restoredProjectId} (working data re-materialized, reel unpublished)`);

    const exportResp = await ownerCtx.request.post('/api/export/final', {
      multipart: {
        project_id: String(restoredProjectId),
        overlay_data: '{}',
        video: { name: 're-export.mp4', mimeType: 'video/mp4', buffer: videoBytes },
      },
      timeout: 90_000,
    });
    expect(exportResp.ok(), 'POST /api/export/final (re-export) must succeed').toBeTruthy();
    const exportBody = await exportResp.json();
    console.log(`[Part A][item7] POST /api/export/final -> new final_video_id=${exportBody.final_video_id}`);

    // A fresh re-export row is unpublished until the publish gesture runs
    // (downloads.py publish_to_my_reels) -- mirrors the real "re-export an
    // already-published reel" flow, which republishes the new version.
    const publishResp = await ownerCtx.request.post(`/api/downloads/publish/${restoredProjectId}`, { timeout: 30_000 });
    expect(publishResp.ok(), 'publish after re-export must succeed').toBeTruthy();

    const afterList = await (await ownerCtx.request.get('/api/downloads')).json();
    const afterRow = afterList.downloads.find((d) => d.id === exportBody.final_video_id);
    expect(afterRow, 'the re-exported + republished reel must show up in /api/downloads').toBeTruthy();
    console.log(`[Part A][item7] after re-export: id=${afterRow.id} intro_card_id=${afterRow.intro_card_id} intro_card_name=${afterRow.intro_card_name}`);

    expect(afterRow.intro_card_id, 'intro_card_id must carry forward unchanged across the re-export').toBe(target.intro_card_id);
    expect(afterRow.intro_card_name).toBe(target.intro_card_name);
  });
});
