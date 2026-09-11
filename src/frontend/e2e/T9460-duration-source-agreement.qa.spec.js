/**
 * T9460 QA — the Focus sidebar, header and output read ONE duration source and
 * agree, and a not-yet-cached clip never shows a confident 0.0s.
 *
 * Bug (staging walkthrough): opening Focus on a FRESHLY-CREATED draft (Annotate
 * save -> mode switch to Focus) showed the sidebar's per-clip duration as 0.0s
 * while the header/output showed the real 0:06. It corrected only after REOPENING
 * the completed clip. Mechanism: the Annotate->Focus path loads clips via
 * projectDataStore.fetchClips, which sets `clips` but NEVER builds
 * `clipMetadataCache`; the sidebar read `clipMetadataCache[clip.id]?.duration || 0`
 * and fabricated a 0. The reopen path goes through useProjectLoader.loadProject,
 * which DOES build the cache, so it was already correct.
 *
 * The fix routes every surface through `clipSourceDuration(clip)` (derives from the
 * clip's own boundaries), so cache presence is irrelevant.
 *
 * This spec drives the real app (dev-login) and verifies BOTH cache states without
 * mutating the account:
 *   1. REOPENED path — open a real draft via the drafts drawer (loadProject builds
 *      the cache). Assert the sidebar shows the real per-clip duration (not 0.0s)
 *      and it floor-agrees with the header time.
 *   2. FRESHLY-CREATED-DRAFT state — reproduce the exact condition the bug needs by
 *      clearing clipMetadataCache in the store (the state fetchClips leaves behind).
 *      Assert the sidebar STILL shows the same real duration (the pre-fix code would
 *      flip to 0.0s here). This is the decisive regression discriminator.
 *
 * Run: bash scripts/dev-verify.sh e2e/T9460-duration-source-agreement.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { openFramingDraft } from './helpers/framingDraft';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

// Mirror of src/utils/clipSelectors.js clipSourceDuration — kept in-spec because a
// deployed BUILD does not expose app utils to page.evaluate.
function clipSourceDuration(c) {
  if (!c) return null;
  if (c.duration != null) return c.duration;
  if (c.start_time != null && c.end_time != null) return c.end_time - c.start_time;
  if (c.video_duration != null) return c.video_duration;
  return null;
}

// Read the store state that drives the sidebar/header duration for the selected clip.
async function readSelectedClip(page) {
  return page.evaluate(async () => {
    const { useProjectDataStore } = await import('/src/stores/projectDataStore.js');
    const s = useProjectDataStore.getState();
    const selId = s.selectedClipId ?? (s.clips[0] && s.clips[0].id);
    const clip = s.clips.find((c) => c.id === selId) || s.clips[0] || null;
    return {
      clipCount: s.clips.length,
      selectedClipId: selId,
      cacheKeys: Object.keys(s.clipMetadataCache || {}),
      clip: clip && {
        id: clip.id,
        duration: clip.duration ?? null,
        start_time: clip.start_time ?? null,
        end_time: clip.end_time ?? null,
        video_duration: clip.video_duration ?? null,
      },
    };
  });
}

// Parse a "M:SS" header time to seconds.
function parseMSS(text) {
  const m = /(\d+):(\d{2})/.exec(text || '');
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

test.describe('T9460 duration-source agreement @staging-gate', () => {
  test('sidebar/header agree on the reopened path AND when the cache is empty (fresh-draft state)', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    // --- 1. REOPENED path: open a real draft (loadProject builds the cache) ----
    await openFramingDraft(page, { waitFor: '.crop-handle' });

    const state = await readSelectedClip(page);
    console.log('[T9460] reopened state:', JSON.stringify(state));
    expect(state.clip, 'a clip is loaded in Focus').toBeTruthy();

    const srcSec = clipSourceDuration(state.clip);
    expect(srcSec, 'the loaded clip has a real (non-zero) source duration').toBeGreaterThan(0);

    const expectedSidebar = `${srcSec.toFixed(1)}s`;

    // Sidebar shows the real per-clip duration, never a fabricated 0.0s.
    await expect(
      page.getByText(expectedSidebar, { exact: true }).first(),
      `sidebar shows the real duration ${expectedSidebar}`,
    ).toBeVisible();

    // Header time (M:SS) is non-zero and floor-agrees with the sidebar seconds.
    const headerText = await page
      .getByText(/^\d+:\d{2}$/)
      .first()
      .textContent();
    const headerSec = parseMSS(headerText);
    console.log(`[T9460] reopened: sidebar=${expectedSidebar} header="${headerText}" (${headerSec}s) src=${srcSec}`);
    expect(headerSec, 'header shows a non-zero time').toBeGreaterThan(0);
    expect(
      Math.abs(headerSec - srcSec),
      'sidebar and header agree on the source duration (within 1s of format flooring)',
    ).toBeLessThanOrEqual(1);

    // --- 2. FRESHLY-CREATED-DRAFT state: clear the cache fetchClips never built --
    // This is exactly the state the Annotate->Focus mode switch leaves behind. The
    // pre-fix sidebar (clipMetadataCache[id]?.duration || 0) would now show 0.0s.
    await page.evaluate(async () => {
      const { useProjectDataStore } = await import('/src/stores/projectDataStore.js');
      useProjectDataStore.setState({ clipMetadataCache: {} });
    });

    const cleared = await readSelectedClip(page);
    expect(cleared.cacheKeys.length, 'clipMetadataCache is now empty (fresh-draft condition)').toBe(0);

    // The decisive discriminator: sidebar STILL shows the real duration, not 0.0s.
    await expect(
      page.getByText(expectedSidebar, { exact: true }).first(),
      `with an empty cache the sidebar still shows ${expectedSidebar} (not a fabricated 0.0s)`,
    ).toBeVisible();

    // And it agrees with the header exactly as it did with the cache populated.
    const headerText2 = await page
      .getByText(/^\d+:\d{2}$/)
      .first()
      .textContent();
    const headerSec2 = parseMSS(headerText2);
    console.log(`[T9460] empty-cache: sidebar=${expectedSidebar} header="${headerText2}" (${headerSec2}s)`);
    expect(
      Math.abs(headerSec2 - srcSec),
      'with an empty cache sidebar and header still agree',
    ).toBeLessThanOrEqual(1);

    await context.close();
  });
});
