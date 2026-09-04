import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { waitForAppReady } from './helpers/appReady.js';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

/**
 * T8350 QA -- multi-clip reel staleness visual cue (LIVE, real user). Drives the
 * app as imankh@gmail.com.
 *
 * This spec is deliberately NON-DESTRUCTIVE (T6180 pattern): it never writes
 * clip boundaries or exports a reel. It route-injects `reel_source_*` /
 * `start_time` / `end_time` onto the REAL GET /api/projects and
 * GET /api/clips/projects/{id}/clips responses in the browser only (no backend
 * write), so the real DraftTile / SegmentedProgressStrip / ClipSelectorSidebar
 * component tree renders the cue exactly as isClipStale computes it, without
 * needing a real produced reel + real boundary edit round-trip.
 *
 * Acceptance-criterion map (T8350-design.md Sec 13):
 *   AC1 ui-designer spec approved -- covered by the design-gate approval, not by this spec.
 *   AC2 a multi-clip reel with one drifted clip shows the cue on exactly that clip
 *       (PRIMARY badge in the produced state; SECONDARY segment ring pre-produce;
 *       TERTIARY Focus-list dot).
 *   AC3 reverting that clip's boundaries to the exact producing values clears the cue.
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T8350-multiclip-staleness-cue.qa.spec.js --reporter=line
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE_ID = process.env.E2E_REAL_PROFILE || '9fa7378c';

const STALE_PROJECT_ID = 900001;
const STALE_PROJECT_NAME = 'T8350 QA Stale Reel';

// clip 1 drifted (live start_time moved off the reel_source snapshot); clip 2 matches.
const DRIFTED_CLIPS = [
  { id: 900101, name: 'Drifted Clip', tags: [], rating: 4, start_time: 11.5, end_time: 20, reel_source_start_time: 10, reel_source_end_time: 20 },
  { id: 900102, name: 'Stable Clip', tags: [], rating: 3, start_time: 30, end_time: 40, reel_source_start_time: 30, reel_source_end_time: 40 },
];
// same clips, but clip 1 reverted to the EXACT producing values -- AC3.
const REVERTED_CLIPS = [
  { ...DRIFTED_CLIPS[0], start_time: 10 },
  DRIFTED_CLIPS[1],
];

function baseProject(overrides) {
  return {
    id: STALE_PROJECT_ID,
    name: STALE_PROJECT_NAME,
    aspect_ratio: '9:16',
    clip_count: 2,
    clips_exported: 0,
    clips_in_progress: 0,
    has_crop_keyframes: false,
    has_working_video: false,
    has_overlay_edits: false,
    has_final_video: false,
    final_video_id: null,
    is_published: false,
    is_auto_created: false,
    created_at: new Date(0).toISOString(),
    current_mode: 'framing',
    game_ids: [],
    game_names: [],
    game_dates: [],
    clips: DRIFTED_CLIPS,
    ...overrides,
  };
}

/**
 * Route-inject ONE synthetic multi-clip project.
 *
 * The app's initial `/home` load never issues a bare `GET /api/projects` --
 * `App.jsx`'s bootstrap call (`GET /api/bootstrap`) inlines the same
 * `list_projects()` result as `data.projects` server-side, and
 * `useProjectsStore.setFromBootstrap` populates the store straight from that
 * envelope. `fetchProjects()` (the real `/api/projects` caller) only runs as a
 * bootstrap-failure fallback or on later on-demand refreshes. So the
 * injection must happen on `/api/bootstrap`'s `projects` field; the
 * `/api/projects` intercept is kept too, as a harmless no-op most of the time
 * that also covers the fallback/refresh paths.
 */
function spliceProject(list, projectOverrides) {
  if (!Array.isArray(list)) return list;
  const injected = baseProject(projectOverrides);
  const withoutStale = list.filter((p) => p.id !== STALE_PROJECT_ID);
  return [injected, ...withoutStale];
}

async function injectProject(page, projectOverrides) {
  await page.route('**/api/bootstrap', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const resp = await route.fetch();
    let data;
    try { data = await resp.json(); } catch { return route.fulfill({ response: resp }); }
    data.projects = spliceProject(data.projects, projectOverrides);
    await route.fulfill({ response: resp, json: data });
  });

  await page.route('**/api/projects', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const resp = await route.fetch();
    let projects;
    try { projects = await resp.json(); } catch { return route.fulfill({ response: resp }); }
    projects = spliceProject(projects, projectOverrides);
    await route.fulfill({ response: resp, json: projects });
  });
}

async function openInProgressReelsPanel(page) {
  await page.goto('/home');
  await waitForAppReady(page, { ready: page.getByRole('button', { name: /^In Progress Reels/ }) });
  await page.getByRole('button', { name: /^In Progress Reels/ }).first().click();
  await expect(page.getByTestId('in-progress-reels-tab-panel')).toBeVisible({ timeout: 10000 });
}

function staleTile(page) {
  return page.locator('[data-testid="project-card"]', { hasText: STALE_PROJECT_NAME });
}

test.beforeEach(async ({ context }) => {
  await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
});

test('AC2: PRIMARY badge shows "1 outdated" on a produced multi-clip reel with one drifted clip', async ({ page }) => {
  await injectProject(page, {
    has_final_video: true, is_published: false, final_video_id: 555555,
    has_working_video: true, clips_exported: 2,
  });
  await openInProgressReelsPanel(page);

  const tile = staleTile(page);
  await expect(tile).toBeVisible();
  const badge = tile.getByText('1 outdated');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute(
    'title', '1 clip changed since this reel was made — re-export to update it'
  );

  // The badge is the ONLY cue reachable in this state -- the strip is suppressed
  // entirely (isReadyToPublish), so it must not render inside this tile.
  await expect(tile.locator('.ring-amber-400')).toHaveCount(0);

  await saveEvidence(page, 'T8350-AC2-primary-badge-produced-desktop');
  await responsiveSweep(page);
});

test('AC3: badge clears when the drifted clip is reverted to the exact producing values', async ({ page }) => {
  await injectProject(page, {
    has_final_video: true, is_published: false, final_video_id: 555555,
    has_working_video: true, clips_exported: 2,
    clips: REVERTED_CLIPS,
  });
  await openInProgressReelsPanel(page);

  const tile = staleTile(page);
  await expect(tile).toBeVisible();
  await expect(tile.getByText(/outdated/)).toHaveCount(0);

  await saveEvidence(page, 'T8350-AC3-badge-cleared-on-exact-revert');
});

test('AC2: SECONDARY segment ring + tooltip on exactly the drifted clip, pre-produce', async ({ page }) => {
  await injectProject(page, {
    has_final_video: false, has_working_video: false, is_published: false,
    clips_in_progress: 1,
  });
  await openInProgressReelsPanel(page);

  const tile = staleTile(page);
  await expect(tile).toBeVisible();
  // The badge is surface-agnostic (design doc Sec 1a) -- it renders in EVERY tile
  // state, including pre-produce, layered alongside the segment-strip cue below.
  await expect(tile.getByText('1 outdated')).toBeVisible();

  const segments = tile.locator('[title*="(click to open)"]');
  const drifted = tile.locator('[title*="Drifted Clip"]');
  const stable = tile.locator('[title*="Stable Clip"]');
  await expect(drifted).toHaveCount(1);
  await expect(stable).toHaveCount(1);

  await expect(drifted).toHaveClass(/ring-amber-400/);
  await expect(drifted).toHaveAttribute('title', /clip edited since this reel was made/);
  // The cue is scoped to EXACTLY the drifted clip, not the whole reel.
  await expect(stable).not.toHaveClass(/ring-amber-400/);
  await expect(await stable.getAttribute('title')).not.toMatch(/clip edited since this reel was made/);

  await saveEvidence(page, 'T8350-AC2-secondary-segment-ring-pre-produce');
});

test('AC2: TERTIARY Focus clip-list dot on exactly the drifted clip', async ({ page }) => {
  // Open ANY real project into Focus (the Focus dot only needs a valid backend
  // project id to load; the drifted values are route-injected onto its clips
  // response, same non-destructive pattern as the tile tests above).
  await page.goto('/home/reels');
  await waitForAppReady(page, { ready: page.getByRole('button', { name: /^In Progress Clips/ }) });

  const projects = await page.evaluate(async () => {
    const r = await fetch('/api/projects', { credentials: 'include' });
    return r.ok ? r.json() : [];
  });
  test.skip(projects.length === 0, 'account has no drafts to open into Focus');
  const targetId = projects[0].id;

  await page.route(`**/api/clips/projects/${targetId}/clips`, async (route) => {
    const resp = await route.fetch();
    let clips;
    try { clips = await resp.json(); } catch { return route.fulfill({ response: resp }); }
    if (Array.isArray(clips) && clips.length > 0) {
      clips = clips.map((c, i) => (
        i === 0
          ? { ...c, start_time: 11.5, end_time: 20, reel_source_start_time: 10, reel_source_end_time: 20 }
          : { ...c, reel_source_start_time: null, reel_source_end_time: null }
      ));
    }
    await route.fulfill({ response: resp, json: clips });
  });

  const chip = page.getByTitle(/^(?!Overlay:).*\(click to open\)/).first();
  await chip.waitFor({ timeout: 30000 });
  await chip.click();

  const rows = page.getByTestId('clip-item');
  await expect(rows.first()).toBeVisible({ timeout: 30000 });

  const dots = page.getByLabel('Edited since this reel was made');
  await expect(dots).toHaveCount(1);
  await expect(rows.first().getByLabel('Edited since this reel was made')).toBeVisible();

  await saveEvidence(page, 'T8350-AC2-tertiary-focus-dot');
  await responsiveSweep(page);
});
