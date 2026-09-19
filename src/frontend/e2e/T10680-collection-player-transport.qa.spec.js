import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveEvidence } from './helpers/qa.js';

/**
 * T10680 QA evidence — CollectionPlayer transport controls (center play/pause
 * glyph + header Play/Pause + Fullscreen) on the finished-reel players. Real
 * browser is required: jsdom has no requestFullscreen and cannot exercise the
 * pointer tap zones or real <video> play/pause edges (memory rule: pointer/
 * fullscreen behaviour is verified in a real browser, never claimed from jsdom).
 *
 * Two dev-only harnesses mount the REAL components:
 *   - /introstoryplayerdiag.html -> the IntroStoryPlayer-mounted player (the
 *     Published/Downloads shape, intro=null) over a VP9 WebM that headless
 *     Chromium can actually PLAY. Carries the real-playback evidence (glyph
 *     fades on the play edge, header label flips, center-tap toggles) AND the
 *     crux: the composite scrubber (a SIBLING of the panel) SURVIVES the
 *     fullscreen expand — the reason the task keeps transport ON there and adds
 *     the fullscreenTarget wrapper.
 *   - /collectionplayerdiag.html -> the bare CollectionPlayer (public-viewer /
 *     Draft-preview shape) over the T5860 H.264 mp4 (headless can't decode it,
 *     so this harness only evidences control PRESENCE + CSS expand + Escape,
 *     never playback).
 *
 * Native OS fullscreen (the actual requestFullscreen escalation) and iPhone
 * webkitEnterFullscreen are a precedented accepted gap in headless CI — the CSS
 * `expanded` path (which also proves the composite scrubber stays visible) is
 * asserted here; true OS fullscreen on a real device is owed at the manual stage
 * (task file § Technical Notes).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBM = path.resolve(__dirname, '..', 'public', 'introstoryplayerdiag-sample.webm');
const MP4 = path.resolve(__dirname, '..', 'public', 'collectionplayerdiag-sample.mp4');

test.beforeAll(() => {
  if (!existsSync(WEBM)) {
    execSync(
      `ffmpeg -y -f lavfi -i testsrc=duration=4:size=360x640:rate=30 -c:v libvpx-vp9 -pix_fmt yuv420p "${WEBM}"`,
      { stdio: 'ignore' },
    );
  }
  if (!existsSync(MP4)) {
    execSync(
      `ffmpeg -y -f lavfi -i testsrc=duration=3:size=360x640:rate=30 -pix_fmt yuv420p -movflags +faststart "${MP4}"`,
      { stdio: 'ignore' },
    );
  }
});

// Two contexts: desktop (fine pointer, panel md:inset-12) and mobile (390px +
// coarse pointer, panel inset-0). On mobile IntroStoryPlayer's composite scrubber
// (a z-90 overlay at the viewport top) overlaps the top of the header — a
// pre-existing T6710 layout (every header button, Close included, sits under it);
// the design's `coarse-pointer:min-h-11` (44px) floor pushes each transport
// button's center BELOW the ~28px bar so it stays tappable on real touch devices.
// The mobile context therefore MUST emulate a coarse pointer (isMobile+hasTouch)
// to reflect reality — a bare fine-pointer 390px viewport leaves the 26px buttons
// clipped by the bar (not a real-device state).
for (const vp of [
  { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
]) {
  test.describe(`T10680 transport — IntroStoryPlayer player @ ${vp.name}`, () => {
    test.use(vp.use);
    test('real playback (glyph fade), header toggle, center-tap, expand keeps composite scrubber', async ({
      page,
    }) => {
      await page.goto('/introstoryplayerdiag.html');
      await page.waitForSelector('video');

      const glyph = page.getByTestId('collection-player-play-glyph');
      const fs = page.getByRole('button', { name: 'Fullscreen' });

      // Glyph is a pointer-events-none overlay (never steals the center tap);
      // header transport + Fullscreen are present by accessible name.
      await expect(glyph).toBeAttached();
      await expect(glyph).toHaveClass(/pointer-events-none/);
      await expect(page.getByRole('button', { name: /^(Play|Pause)$/ })).toBeVisible();
      await expect(fs).toBeVisible();
      await saveEvidence(page, `ac1-ac2-glyph-and-header-transport-${vp.name}`);

      // Real playback drives the glyph fade (not a fake timer): the paused->playing
      // edge flashes Pause then fades the glyph to opacity-0 within ~600ms, and the
      // header button's accessible name flips to "Pause" while playing.
      await page.$eval('video', (v) => { v.muted = true; return v.play().catch(() => {}); });
      await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 3000 });
      await expect(glyph).toHaveClass(/opacity-0/, { timeout: 3000 });
      await saveEvidence(page, `ac1-glyph-faded-after-play-${vp.name}`);

      // Center-tap toggles play THROUGH the glyph (proves pointer-events-none): tap
      // the middle of the video area; playback state flips.
      const wasPlaying = await page.$eval('video', (v) => !v.paused);
      const box = await page.getByTestId('collection-player-video').boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(
        (prev) => document.querySelector('video').paused === prev,
        wasPlaying,
        { timeout: 2000 },
      );

      // The composite scrubber (IntroStoryPlayer's own bar, a SIBLING of the panel)
      // renders its reel segments before expand.
      const segments = page.locator('[data-segment-kind="reel"]');
      expect(await segments.count()).toBeGreaterThan(0);

      // Expand -> the composite scrubber MUST still be visible (design's reason for
      // the fullscreenTarget wrapper). Headless CSS-expand path; native OS
      // fullscreen keeping the bar is the accepted real-device gap.
      await fs.click();
      await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible();
      await expect(segments.first()).toBeVisible();
      await saveEvidence(page, `ac3-expand-keeps-composite-scrubber-${vp.name}`);

      // Escape leaves fullscreen first; the composite scrubber + player remain.
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Fullscreen' })).toBeVisible();
      await expect(segments.first()).toBeVisible();
      await saveEvidence(page, `ac4-escape-leaves-fullscreen-first-${vp.name}`);
    });
  });
}

test.describe('T10680 transport — bare CollectionPlayer shape (presence + expand, /collectionplayerdiag)', () => {
  test('glyph + header Play/Pause + Fullscreen present; Fullscreen CSS-expands the panel', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/collectionplayerdiag.html');
    await page.waitForSelector('video');

    await expect(page.getByTestId('collection-player-play-glyph')).toHaveClass(/pointer-events-none/);
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    const fs = page.getByRole('button', { name: 'Fullscreen' });
    await expect(fs).toBeVisible();

    await fs.click();
    await expect(page.getByRole('dialog')).toHaveClass(/rounded-none/);
    await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Fullscreen' })).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
