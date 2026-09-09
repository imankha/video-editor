/**
 * T9100 QA — player-detection boxes align with the video after export -> Overlay.
 *
 * Proves, in a REAL browser (jsdom cannot measure layout — T5380 lesson), the
 * pixel invariant the bug violated: the Overlay video STAGE sizes to the reel's
 * true aspect and the detection boxes land ON the rendered video — but ONLY when
 * the stage is fed the reel's true metadata. That is exactly what the T9100 fix
 * guarantees: FocusScreen's post-export null-blob branch no longer seeds the
 * shared workingVideo record with `metadata:null`, so OverlayScreen's real loader
 * populates the reel's own dimensions instead of the banned silent fallback to
 * the 16:9 source-clip dims.
 *
 * WHY A DIAG HARNESS (t9100diag.html), NOT the real Focus->Add-Spotlight->Overlay
 * flow: identical reasoning to T5676 / T9110 — a real end-to-end run needs an
 * uploaded game, annotated clips, and a real Focus + Overlay render, infeasible
 * in this container (Modal disabled; the dev-login account has zero seeded
 * projects). The harness mounts the REAL VideoPlayer + REAL PlayerDetectionOverlay
 * (its real useVideoDisplayRect transform) inside OverlayModeView's EXACT stage
 * box; only the "an export just finished" premise + the video source are synthetic.
 *
 * Two live stages play the SAME 9:16 reel with one detection box at the reel's
 * true center:
 *   - "fixed": fed the reel's true metadata (1080x1920) — the post-fix / cold-
 *     from-Drafts control path. Stage aspect == video aspect; box lands on video.
 *   - "bug":   fed the source clip's landscape metadata (1920x1080) — the pre-fix
 *     poisoned outcome. The stage stretches to 16:9 (canvas past the video) and
 *     the box sits LEFT of the video content. This is a LIVE CONTROL that proves
 *     the harness discriminates the bug from the fix (not a vacuous pass).
 *
 * Run: bash scripts/dev-verify.sh e2e/T9100-overlay-detection-alignment.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { saveEvidence, assertNoHorizontalOverflow } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

// Generated to /tmp (NOT public/) because vite v5 dev caches the publicDir listing
// at startup — files added after boot 404. We fulfill the <video> request via
// page.route from disk, which is timing-independent (T5590/T5676 lesson).
const SAMPLE_9x16 = path.join('/tmp', 't9100diag-9x16.mp4');
const HARNESS = '/t9100diag.html';

// The reel's true aspect (portrait 9:16 == 0.5625) the FIXED stage must match.
const REEL_ASPECT = 1080 / 1920;
// Tolerance: the task names ~1%.
const ASPECT_TOL = 0.01;
// T9150: the settings column must never render narrower than this, whether the
// cause would be the T9100 metadata bug or a genuinely-landscape reel.
const MIN_SETTINGS_WIDTH = 240;

async function routeSample(page) {
  await page.route(/t9100diag-9x16\.mp4(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: 'video/mp4', body: fs.readFileSync(SAMPLE_9x16) }));
}

/** Measure a stage's stage-box, rendered <video>, detection box, and (T9150) its
 * sibling settings column (screen px). */
async function measureStage(page, testId) {
  return page.evaluate((id) => {
    const wrap = document.querySelector(`[data-testid="${id}"]`);
    if (!wrap) return null;
    const stageBox = wrap.querySelector('[style*="aspect-ratio"]');
    const video = wrap.querySelector('video');
    const svg = wrap.querySelector('svg');
    const rect = wrap.querySelector('svg rect[stroke-dasharray]');
    const settings = document.querySelector(`[data-testid="${id}-settings"]`);
    if (!stageBox || !video || !svg || !rect) return null;
    const sb = stageBox.getBoundingClientRect();
    const v = video.getBoundingClientRect();
    const s = svg.getBoundingClientRect();
    const rx = +rect.getAttribute('x');
    const ry = +rect.getAttribute('y');
    const rw = +rect.getAttribute('width');
    const rh = +rect.getAttribute('height');
    return {
      stageBox: { width: sb.width, height: sb.height },
      video: { x: v.x, y: v.y, width: v.width, height: v.height },
      natural: { w: video.videoWidth, h: video.videoHeight },
      // Detection box center in screen coordinates.
      boxCenter: { x: s.x + rx + rw / 2, y: s.y + ry + rh / 2 },
      settingsWidth: settings ? settings.getBoundingClientRect().width : null,
    };
  }, testId);
}

test.describe('T9100 detection-box alignment @staging-gate @gate-c', () => {
  // /t9100diag.html is a Vite-dev-only harness page: not an input to the
  // production build, so on a deployed target the relative path resolves against
  // the Pages origin and the SPA catch-all serves index.html — the harness never
  // mounts. Gate this describe so it self-skips there (not a silent pass).
  skipOnDeployedTarget(test, 'drives the dev-only /t9100diag.html harness page, which does not exist in a production BUILD');

  test.beforeAll(() => {
    if (!fs.existsSync(SAMPLE_9x16)) {
      execSync(
        `ffmpeg -y -f lavfi -i testsrc=duration=3:size=1080x1920:rate=30 -pix_fmt yuv420p -movflags +faststart "${SAMPLE_9x16}"`,
        { stdio: 'ignore' },
      );
    }
  });

  test('FIXED stage: stage aspect == video aspect and the detection box lands ON the video', async ({ page }) => {
    test.setTimeout(90_000);
    await routeSample(page);
    // T9150: 1600x1200, the width where the settings-panel starvation bug was
    // proven to reach 0px (not just a sliver) — see the task's live evidence table.
    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.goto(HARNESS);

    await page.getByTestId('stage-fixed').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => {
      const vids = Array.from(document.querySelectorAll('video'));
      return vids.length >= 2 && vids.every((v) => v.videoWidth > 0);
    }, { timeout: 30000 });
    // Boxes render once useVideoDisplayRect has a rect (layout effect + metadata).
    await page.locator('[data-testid="stage-fixed"] svg rect[stroke-dasharray]').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(400); // ResizeObserver + layout settle
    await assertNoHorizontalOverflow(page);

    const m = await measureStage(page, 'stage-fixed');
    expect(m, 'measured FIXED stage').not.toBeNull();
    console.log(`[T9100] FIXED stageBox=${Math.round(m.stageBox.width)}x${Math.round(m.stageBox.height)} ` +
      `video=${Math.round(m.video.width)}x${Math.round(m.video.height)} natural=${m.natural.w}x${m.natural.h}`);

    // The stage's rendered aspect ratio equals the live <video>'s natural aspect
    // (videoWidth/videoHeight) within ~1% — the exact invariant the bug broke.
    const stageAspect = m.stageBox.width / m.stageBox.height;
    const videoNaturalAspect = m.natural.w / m.natural.h;
    expect(Math.abs(stageAspect - videoNaturalAspect),
      'FIXED: stage aspect matches the video natural aspect').toBeLessThan(ASPECT_TOL);
    expect(Math.abs(stageAspect - REEL_ASPECT),
      'FIXED: stage aspect is the reel 9:16 aspect').toBeLessThan(ASPECT_TOL);

    // The detection box center lands INSIDE the rendered video rect.
    expect(m.boxCenter.x).toBeGreaterThanOrEqual(m.video.x - 2);
    expect(m.boxCenter.x).toBeLessThanOrEqual(m.video.x + m.video.width + 2);
    expect(m.boxCenter.y).toBeGreaterThanOrEqual(m.video.y - 2);
    expect(m.boxCenter.y).toBeLessThanOrEqual(m.video.y + m.video.height + 2);

    // T9150: a correctly-aligned 9:16 stage never needed much width, so its
    // settings column was never at risk — assert the floor holds anyway.
    expect(m.settingsWidth, 'FIXED: settings column width').not.toBeNull();
    expect(m.settingsWidth).toBeGreaterThanOrEqual(MIN_SETTINGS_WIDTH);
    await saveEvidence(page, 'T9100-fixed-stage-aligned');
  });

  test('BUG control: wrong (source-clip) metadata stretches the stage past the video and offsets the box left', async ({ page }) => {
    test.setTimeout(90_000);
    await routeSample(page);
    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.goto(HARNESS);

    await page.getByTestId('stage-bug').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => {
      const vids = Array.from(document.querySelectorAll('video'));
      return vids.length >= 2 && vids.every((v) => v.videoWidth > 0);
    }, { timeout: 30000 });
    await page.locator('[data-testid="stage-bug"] svg rect[stroke-dasharray]').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(400);

    const m = await measureStage(page, 'stage-bug');
    expect(m, 'measured BUG stage').not.toBeNull();
    console.log(`[T9100] BUG stageBox=${Math.round(m.stageBox.width)}x${Math.round(m.stageBox.height)} ` +
      `video=${Math.round(m.video.width)}x${Math.round(m.video.height)} ` +
      `boxCenterX=${Math.round(m.boxCenter.x)} videoLeft=${Math.round(m.video.x)}`);

    // The stage stretches to the WRONG (16:9) aspect — NOT the video's 9:16 —
    // reproducing the "canvas stretches past its area" symptom. This is what the
    // fix prevents; asserting the mismatch proves the FIXED test above is not
    // vacuous (the harness genuinely discriminates the bug from the fix).
    const stageAspect = m.stageBox.width / m.stageBox.height;
    const videoNaturalAspect = m.natural.w / m.natural.h;
    expect(Math.abs(stageAspect - videoNaturalAspect),
      'BUG: stage aspect does NOT match the video (canvas stretches past it)').toBeGreaterThan(0.5);

    // The detection box is pushed LEFT of the actual video content — exactly the
    // reported symptom (boxes in the empty black space left of the video).
    expect(m.boxCenter.x, 'BUG: detection box center sits left of the video content')
      .toBeLessThan(m.video.x);

    // T9150 Fix C: even in the poisoned-metadata case, the stage's lg:max-w cap
    // (alongside lg:flex-initial on its column) must stop the wrongly-landscape
    // stage from consuming the whole row — the settings column must never be
    // starved to a sliver or 0px, independent of whatever fixes the metadata itself.
    expect(m.settingsWidth, 'BUG: settings column width').not.toBeNull();
    expect(m.settingsWidth).toBeGreaterThanOrEqual(MIN_SETTINGS_WIDTH);
    await saveEvidence(page, 'T9100-bug-control-offset');
  });

  test('T9150: a genuinely 16:9 reel (correct metadata) does not starve the settings column', async ({ page }) => {
    test.setTimeout(90_000);
    await routeSample(page);
    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.goto(HARNESS);

    await page.getByTestId('stage-16x9-real').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => {
      const vids = Array.from(document.querySelectorAll('video'));
      return vids.length >= 3 && vids.every((v) => v.videoWidth > 0);
    }, { timeout: 30000 });
    await page.locator('[data-testid="stage-16x9-real"] svg rect[stroke-dasharray]').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(400);

    const m = await measureStage(page, 'stage-16x9-real');
    expect(m, 'measured 16:9 stage').not.toBeNull();
    console.log(`[T9150] 16x9 stageBox=${Math.round(m.stageBox.width)}x${Math.round(m.stageBox.height)} ` +
      `settingsWidth=${Math.round(m.settingsWidth ?? -1)}`);

    // This case has NO metadata bug at all (the reel genuinely is 16:9) — before
    // Fix C, this was the independently-discovered, currently-shipping regression:
    // a real landscape reel starved its own settings panel with fully correct data.
    expect(m.settingsWidth, '16:9: settings column width').not.toBeNull();
    expect(m.settingsWidth).toBeGreaterThanOrEqual(MIN_SETTINGS_WIDTH);
    await saveEvidence(page, 'T9150-16x9-settings-not-starved');
  });

  test('T9150: at 2560x1440, neither the metadata bug nor a real 16:9 reel starves the settings column', async ({ page }) => {
    test.setTimeout(90_000);
    await routeSample(page);
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.goto(HARNESS);

    await page.waitForFunction(() => {
      const vids = Array.from(document.querySelectorAll('video'));
      return vids.length >= 3 && vids.every((v) => v.videoWidth > 0);
    }, { timeout: 30000 });
    await Promise.all(
      ['stage-fixed', 'stage-bug', 'stage-16x9-real'].map((id) =>
        page.locator(`[data-testid="${id}"] svg rect[stroke-dasharray]`).first().waitFor({ timeout: 30000 })),
    );
    await page.waitForTimeout(400);

    for (const id of ['stage-fixed', 'stage-bug', 'stage-16x9-real']) {
      const m = await measureStage(page, id);
      expect(m, `measured ${id} at 2560x1440`).not.toBeNull();
      expect(m.settingsWidth, `${id}: settings column width at 2560x1440`).not.toBeNull();
      expect(m.settingsWidth).toBeGreaterThanOrEqual(MIN_SETTINGS_WIDTH);
    }
  });
});
