import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

/**
 * T5642 — REAL BROWSER (chromium) proof that the overlay working-video loads via a
 * presigned R2 URL with NO 401, the way OverlayScreen.jsx now does it (fix for the
 * cross-origin "Video format not supported" bug).
 *
 * Root cause (task file): on staging/prod the frontend is cross-SITE to the API
 * (pages.dev -> fly.dev). The overlay <video> carries no crossOrigin attribute, so
 * its cross-site range request to the same-origin proxy `/working_video/stream`
 * arrives WITHOUT the session cookie -> the auth middleware 401s it -> Chrome
 * surfaces a 401 on a media element as MEDIA_ELEMENT_ERROR "Format error".
 *
 * Fix (this task): OverlayScreen fetches a presigned R2 URL from the new
 * authenticated endpoint `GET /api/projects/{id}/working_video/playback-url` and
 * sets `<video src>` to that ANONYMOUS presigned R2 URL (different origin, no
 * cookie needed) — mirroring how Framing already loads clips.
 *
 * WHY THIS SPEC RUNS AGAINST STAGING'S EXISTING INFRA:
 * The full in-app overlay screen needs BOTH this branch's backend (new endpoint)
 * AND frontend running with a real session. That is not reproducible in the
 * /dotask worker (no local Postgres for dev-login; staging runs pre-fix code). So
 * this spec proves the fix's MECHANISM against real staging working videos in a
 * real cross-site browser context:
 *   1. FIX: a presigned R2 URL loads in a real <video> element cross-site with
 *      206/no-401 and actually plays. The presigned URL is obtained via the SAME
 *      helper the new endpoint uses (`_generate_working_video_presigned_url`,
 *      surfaced today by the authed `/working-video` 302). This is byte-identical
 *      to what the new `/working_video/playback-url` returns as JSON.
 *   2. BUG CONTEXT: the credential-less proxy request 401s (captured + logged).
 * The new endpoint's own contract (auth-gated, returns url) is pinned by the
 * backend unit tests in tests/test_stream_auth.py.
 *
 * Run (staging):
 *   E2E_BASE_URL=https://reel-ballers-staging.pages.dev \
 *   E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api \
 *   npx playwright test e2e/T5642-overlay-working-video-presigned.qa.spec.js --project=chromium
 */

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';
const API_BASE = process.env.E2E_API_BASE || '/api';

/** Find a project id that has a working video (the overlay editing target). */
async function findProjectWithWorkingVideo(request) {
  const listRes = await request.get(`${API_BASE}/projects`);
  expect(listRes.ok(), `GET /projects -> ${listRes.status()}`).toBeTruthy();
  const projects = await listRes.json();
  for (const p of projects) {
    const detRes = await request.get(`${API_BASE}/projects/${p.id}`);
    if (!detRes.ok()) continue;
    const det = await detRes.json();
    if (det.working_video_url && det.working_video_id) {
      return { id: p.id, workingVideoId: det.working_video_id };
    }
  }
  return null;
}

test.describe('T5642 overlay working-video presigned load @staging-gate', () => {
  test('presigned R2 <video> loads cross-site with 206 / no 401 and plays', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    // Real cross-site context: the page origin (pages.dev) differs from the API
    // origin (fly.dev) and the R2 origin — exactly the staging/prod topology.
    await page.goto('/');

    const target = await findProjectWithWorkingVideo(context.request);
    test.skip(!target, 'This account has no project with an exported working video; nothing to load in overlay.');
    console.log(`[T5642] target project ${target.id} (working_video_id=${target.workingVideoId})`);

    // Obtain the presigned R2 URL the SAME way OverlayScreen now does: an
    // authenticated request that yields an anonymous presigned R2 URL. The new
    // endpoint returns it as JSON `{url}`; staging surfaces the identical URL via
    // the authed `/working-video` 302, so we follow that to get the real presign.
    const presignRes = await context.request.get(
      `${API_BASE}/projects/${target.id}/working-video`,
      { maxRedirects: 0 }
    );
    const presignedUrl = presignRes.headers()['location'];
    expect(presignRes.status(), 'authed /working-video should 302 to a presigned R2 URL').toBe(302);
    expect(presignedUrl, 'presigned R2 URL present').toBeTruthy();
    expect(presignedUrl, 'presigned URL is a cross-origin R2 URL, not the same-origin proxy').not.toContain('/working_video/stream');
    expect(/^https?:\/\//.test(presignedUrl), 'presigned URL is absolute').toBeTruthy();
    console.log(`[T5642] presigned host: ${presignedUrl.replace(/^(https?:\/\/[^/]+).*/, '$1')}`);

    // Capture the network status of the browser's actual <video> byte request.
    const videoStatuses = [];
    const presignHost = new URL(presignedUrl).host;
    page.on('response', (resp) => {
      const u = resp.url();
      if (u.includes(presignHost) || u.includes('/working_video/') || u.includes('/working-video')) {
        videoStatuses.push({ status: resp.status(), url: u.slice(0, 80) });
      }
    });

    // Load the presigned R2 URL into a REAL <video> element (no crossOrigin — a
    // presigned URL is anonymous; setting use-credentials would break R2 CORS,
    // per the task landmine). Assert it reaches metadata and can advance.
    const result = await page.evaluate(async (url) => {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.style.width = '320px';
      v.setAttribute('data-testid', 't5642-video');
      document.body.appendChild(v);
      v.src = url;
      const outcome = await new Promise((resolve) => {
        const to = setTimeout(() => resolve({ ok: false, reason: 'timeout', readyState: v.readyState }), 30000);
        v.addEventListener('loadedmetadata', () => {
          clearTimeout(to);
          resolve({
            ok: true,
            readyState: v.readyState,
            width: v.videoWidth,
            height: v.videoHeight,
            duration: v.duration,
          });
        });
        v.addEventListener('error', () => {
          clearTimeout(to);
          const code = v.error && v.error.code;
          resolve({ ok: false, reason: 'media-error', code, readyState: v.readyState });
        });
      });
      if (!outcome.ok) return outcome;
      // Prove it actually decodes/plays a frame (advances currentTime).
      try { await v.play(); } catch { /* autoplay policy: muted playsInline should allow */ }
      const t0 = v.currentTime;
      await new Promise((r) => setTimeout(r, 800));
      outcome.advanced = v.currentTime > t0;
      outcome.currentTime = v.currentTime;
      return outcome;
    }, presignedUrl);

    console.log('[T5642] <video> outcome:', JSON.stringify(result));
    console.log('[T5642] video network statuses:', JSON.stringify(videoStatuses));

    // The core acceptance criterion: presigned <video> loads, no MEDIA_ELEMENT_ERROR.
    expect(result.ok, `presigned <video> loaded metadata (got ${JSON.stringify(result)})`).toBeTruthy();
    expect(result.width, 'video has real dimensions').toBeGreaterThan(0);
    // No 401 on any working-video / R2 request the browser made.
    const got401 = videoStatuses.filter((s) => s.status === 401);
    expect(got401, `no 401 on the presigned video request (saw ${JSON.stringify(videoStatuses)})`).toHaveLength(0);
    // At least one 200/206 on the presigned R2 host.
    const good = videoStatuses.filter((s) => s.status === 200 || s.status === 206);
    expect(good.length, `presigned R2 request returned 200/206 (saw ${JSON.stringify(videoStatuses)})`).toBeGreaterThan(0);

    await saveEvidence(page, 'T5642-criterion-1-presigned-video-loads-no-401');
    await responsiveSweep(page);
    await context.close();
  });

  test('BUG CONTEXT: credential-less proxy stream 401s cross-site (what the fix avoids)', async ({ browser }) => {
    test.setTimeout(60_000);
    // A fresh context with NO session — mimics the crossOrigin-less <video> whose
    // cross-site request carries no cookie. Proves the proxy path the fix moves off.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto('/');

    // Project 31 is the task's documented reproduction case. If a re-seed changes
    // ids, this is only informational context, so a miss is a soft log, not a fail.
    const statuses = [];
    for (const pid of [31, 54]) {
      const res = await context.request.get(
        `${API_BASE}/projects/${pid}/working_video/stream`,
        { headers: { Range: 'bytes=0-1023' }, failOnStatusCode: false }
      );
      statuses.push({ pid, status: res.status() });
    }
    console.log('[T5642] credential-less proxy statuses:', JSON.stringify(statuses));
    // At least one known project must 401 without a session — the exact server-side
    // rejection that surfaced as "Format error" on the old <video> path.
    const any401 = statuses.some((s) => s.status === 401);
    expect(any401, `credential-less proxy stream should 401 (saw ${JSON.stringify(statuses)})`).toBeTruthy();

    await saveEvidence(page, 'T5642-criterion-context-credentialless-proxy-401');
    await context.close();
  });
});
