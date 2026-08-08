/**
 * T5220 manual QA (Stage 6, mandatory per the task's kickoff) -- live-drives the
 * four egress paths through the REAL running dev app as a real account with real
 * data, per e2e/helpers/realAuth.js / .claude/skills/drive-app-as-user/SKILL.md.
 *
 * This is API-surface verification (send the request, capture the response), not
 * a browser UI walkthrough: the intro pre-roll itself needs a profile with intro
 * consent + a card attached (multi-step setup not guaranteed to exist for the
 * driving account), so this spec proves the SERVING/ROUTING contract T5220 wires
 * -- the composed-egress endpoints respond correctly whether or not this
 * particular account currently has an intro attached -- rather than the visual
 * motion/photo rendering (already covered by IntroPreRoll.test.jsx + the design's
 * parity tests).
 *
 * Run: bash scripts/dev-verify.sh e2e/T5220-egress.qa.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';

test('T5220: owner download, share GET intro field, and share download all serve correctly', async ({ context, page }) => {
  await loginAsRealUser(context);

  // --- 1. Find real downloads for this account ---------------------------
  const listResp = await page.request.get('/api/downloads');
  expect(listResp.ok()).toBeTruthy();
  const list = await listResp.json();
  console.log(`[T5220] account has ${list.downloads.length} downloads`);
  test.skip(list.downloads.length === 0, 'account has no published reels to verify against');

  const withIntro = list.downloads.find((d) => d.intro_card_name);
  const withoutIntro = list.downloads.find((d) => !d.intro_card_name);
  console.log(
    `[T5220] with intro: ${withIntro ? withIntro.id + ' (' + withIntro.intro_card_name + ')' : 'none attached'}; `
    + `without intro: ${withoutIntro ? withoutIntro.id : 'none'}`,
  );

  // --- 2. Regression: owner download WITHOUT an intro still serves fine --
  const target = withoutIntro || list.downloads[0];
  const fileResp = await page.request.get(`/api/downloads/${target.id}/file`);
  expect(fileResp.ok()).toBeTruthy();
  expect(fileResp.headers()['content-type']).toContain('video/mp4');
  const fileBytes = (await fileResp.body()).length;
  console.log(`[T5220] GET /api/downloads/${target.id}/file -> ${fileResp.status()}, ${fileBytes} bytes`);
  expect(fileBytes).toBeGreaterThan(0);

  // --- 2b. If this account HAS a reel with an intro attached, confirm the
  //     composed download is LARGER than the raw R2 object (intro actually
  //     burned in, not silently skipped). ---------------------------------
  if (withIntro) {
    const introFileResp = await page.request.get(`/api/downloads/${withIntro.id}/file`);
    expect(introFileResp.ok()).toBeTruthy();
    const introBytes = (await introFileResp.body()).length;
    console.log(`[T5220] reel ${withIntro.id} (intro="${withIntro.intro_card_name}") composed download -> ${introBytes} bytes`);
    // Non-zero and playable is the primary assertion; we don't have the raw
    // pre-outro/pre-intro byte count to diff against without a second R2
    // fetch, so this asserts the composed file is at least plausible size
    // (not a truncated/empty stream) rather than a strict growth diff.
    expect(introBytes).toBeGreaterThan(10_000);
  } else {
    console.log('[T5220] no reel on this account currently has an intro attached -- cannot verify the burn-in byte-growth path live; covered instead by test_t5220_serve_time.py (real ffmpeg, asserts composed duration > reel alone)');
  }

  // --- 3. Create a public share, confirm GET /api/shared/{token} carries
  //     the new optional `intro` field without erroring -------------------
  const shareResp = await page.request.post(`/api/gallery/${target.id}/share`, {
    data: { recipient_emails: [], is_public: true },
  });
  expect(shareResp.ok()).toBeTruthy();
  const shareBody = await shareResp.json();
  const token = shareBody.shares[0].share_token;
  console.log(`[T5220] created share token=${token} for reel ${target.id}`);

  const getSharedResp = await page.request.get(`/api/shared/${token}`);
  expect(getSharedResp.ok()).toBeTruthy();
  const shared = await getSharedResp.json();
  expect(shared).toHaveProperty('intro');
  console.log(`[T5220] GET /api/shared/${token} -> intro field present, value=${JSON.stringify(shared.intro)}`);

  // --- 4. New endpoint: GET /api/shared/{token}/download ------------------
  const shareDlResp = await page.request.get(`/api/shared/${token}/download`);
  expect(shareDlResp.ok()).toBeTruthy();
  expect(shareDlResp.headers()['content-type']).toContain('video/mp4');
  expect(shareDlResp.headers()['content-disposition']).toContain('attachment');
  const shareDlBytes = (await shareDlResp.body()).length;
  console.log(`[T5220] GET /api/shared/${token}/download -> ${shareDlResp.status()}, ${shareDlBytes} bytes, content-disposition=${shareDlResp.headers()['content-disposition']}`);
  expect(shareDlBytes).toBeGreaterThan(0);

  // --- 5. Probe: unknown token on the NEW endpoint must 404, not 500 ------
  const bogusResp = await page.request.get('/api/shared/definitely-not-a-real-token/download');
  console.log(`[T5220] probe: GET /api/shared/<bogus>/download -> ${bogusResp.status()}`);
  expect(bogusResp.status()).toBe(404);

  // --- cleanup: revoke the share we created --------------------------------
  await page.request.delete(`/api/shared/${token}`);
});
