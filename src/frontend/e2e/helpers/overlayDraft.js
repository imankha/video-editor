/**
 * overlayDraft — open a reel draft that has reached the Overlay stage AND whose
 * working video actually streams, then gate on the real overlay ready-signal (T6110).
 *
 * WHY THIS EXISTS. The three real-account overlay specs (T5676, bug38, T4550's overlay
 * test) used to open the `.first()` "In Overlay" draft and then wait on the overlay
 * stage's inline `aspect-ratio` — the app's OWN "metadata ready / useAspectStage flipped"
 * signal. That signal is correct, but T6100 measured WHY the wait never returned on
 * staging: the seed carries DANGLING `working_videos` refs. `working_video/playback-url`
 * returns 200 with a presigned URL, but the R2 GET for that object is a fast, deterministic
 * 404 (~120ms) — so the <video> fires `error` and the aspect-ratio can NEVER arrive. The
 * old spec then waited out its whole timeout (the observed 240s hang). Raising the timeout
 * would be the same bug, slower.
 *
 * So there are TWO fixes, and a readiness wait alone is not enough: we must also CHOOSE A
 * LOADABLE DRAFT. This helper does exactly that:
 *   1. Probe every In-Overlay draft's working video the way T6100 did — playback-url, then a
 *      Range GET on the presigned R2 URL — to find one that streams (206), classifying the
 *      rest as dangling.
 *   2. Open that specific draft deterministically (its DraftTile carries the project id in its
 *      poster `src`, so we target the card directly — no dependence on list order or on the
 *      `.first()` gamble), then gate on `waitForRealVideoReady` (the one readiness contract).
 *   3. If NO draft streams, return a loud verdict NAMING the dangling refs so the spec skips
 *      honestly (never a vacuous pass, never a domain assertion against a placeholder).
 *
 * On the current staging copy of imankh, 5 drafts are In-Overlay; 2 stream (54, 37) and 3
 * are dangling (31, 33, 51) — so these specs run GREEN by opening 54/37, and would skip
 * loudly if a re-seed dropped the streamable ones.
 */
import { waitForRealVideoReady } from './videoRoute.js';

const API_BASE = process.env.E2E_API_BASE || '/api';

/**
 * Classify each In-Overlay draft's working video by ACTUALLY range-GETting its R2 object
 * (the T6100 signal), using the authed `page.request` (shares the dev-login cookie).
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{loadable: number[], dangling: string[]}>}
 *   `loadable` = project ids whose R2 object streams (206/200), in API order;
 *   `dangling` = "project N (name): reason" strings for the ones that don't.
 */
export async function probeOverlayDrafts(page) {
  const res = await page.request.get(`${API_BASE}/projects`);
  if (!res.ok()) return { loadable: [], dangling: [`GET /projects -> ${res.status()}`] };
  const body = await res.json();
  const projects = Array.isArray(body) ? body : (body.projects || body.items || []);
  const loadable = [];
  const dangling = [];
  for (const p of projects) {
    if (!p.has_working_video) continue;
    const presign = await page.request.get(`${API_BASE}/projects/${p.id}/working_video/playback-url`);
    if (!presign.ok()) {
      dangling.push(`project ${p.id} (${p.name}): playback-url ${presign.status()} (no working_video object)`);
      continue;
    }
    let url;
    try { url = (await presign.json()).url; } catch { url = null; }
    if (!url) { dangling.push(`project ${p.id} (${p.name}): playback-url 200 but no url in body`); continue; }
    // Range GET the presigned R2 URL — 206 means the object is really there; a fast 404 is
    // the dangling ref T6100 measured. page.request is a Node-side fetch (no CORS gate).
    const obj = await page.request.get(url, { headers: { Range: 'bytes=0-1' }, maxRedirects: 5 });
    if (obj.status() === 206 || obj.status() === 200) loadable.push(p.id);
    else dangling.push(`project ${p.id} (${p.name}): R2 GET ${obj.status()} (dangling working_video ref — object missing)`);
  }
  return { loadable, dangling };
}

/**
 * Open a streamable In-Overlay draft and wait for the real overlay ready-signal.
 *
 * @param {import('@playwright/test').Page} page  authenticated (loginAsRealUser already ran)
 * @param {object} [opts]
 * @param {number} [opts.minReadyState=3] readyState required of the overlay <video>
 *   (3 for specs that seek/step/drag; 2 for a pure geometry/alignment read).
 * @returns {Promise<{ok: boolean, projectId?: number, reason?: string}>}
 *   `ok:true` once the overlay stage is hydrated and interactive; otherwise a loud reason to
 *   `test.skip(...)` on (naming hydration / the dangling refs).
 */
export async function openLoadableOverlayDraft(page, { minReadyState = 3 } = {}) {
  const { loadable, dangling } = await probeOverlayDrafts(page);
  if (loadable.length === 0) {
    return {
      ok: false,
      reason:
        'No In-Overlay draft in this env has a streamable working video — every candidate has a ' +
        `dangling/missing working_video ref (T6100 root cause), so the overlay stage can never hydrate. ` +
        `Details:\n  ${dangling.join('\n  ') || '(no In-Overlay drafts at all)'}`,
    };
  }
  const targetId = loadable[0];

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Reel Drafts' }).click();
  const overlayFilter = page.getByText(/^In Overlay \(\d+\)$/);
  if ((await overlayFilter.count()) === 0) {
    return {
      ok: false,
      reason: `probe found streamable In-Overlay draft(s) [${loadable.join(', ')}] but the "In Overlay" ` +
        'drafts filter is absent in the UI (API/UI mismatch)',
    };
  }
  await overlayFilter.first().click();

  // Open the LOADABLE draft deterministically: its DraftTile poster src carries the project
  // id. Click that card's own "Open in Overlay" button (Playwright hovers it first, which
  // flips the hover-gated tile actions to pointer-events:auto) — no `.first()` gamble.
  const card = page
    .locator('[data-testid="project-card"]')
    .filter({ has: page.locator(`img[src*="/projects/${targetId}/poster"]`) })
    .first();
  await card.waitFor({ timeout: 30000 });
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await card.getByRole('button', { name: 'Open in Overlay' }).click();

  const stage = page.getByTestId('overlay-video-stage').first();
  await stage.waitFor({ timeout: 60000 });
  const verdict = await waitForRealVideoReady(page, { requireAspectRatio: true, minReadyState });
  if (verdict.ready) return { ok: true, projectId: targetId };
  return {
    ok: false,
    reason:
      `In-Overlay draft ${targetId} probed streamable (R2 206) yet its overlay stage never hydrated ` +
      `in-app: ${verdict.reason}`,
  };
}
