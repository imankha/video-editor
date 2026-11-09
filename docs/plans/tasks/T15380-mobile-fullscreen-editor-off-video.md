# T15380: Mobile fullscreen Annotate stops covering the video (portrait layout + peek while dragging)

**Status:** STAGING
**Impact:** 8
**Complexity:** 4
**Tier:** M (frontend only, no schema change)
**Created:** 2026-11-08
**Updated:** 2026-11-08

Owner chose options B + D on 2026-11-08 from a UX consult. The landscape side-strip layout (option C) is the follow-up T15370.

## Problem

User feedback (iPhone, 2026-11-08): "When trying to mark a play on the app on my phone ... the options overlay the video so I can't see the play to trim properly. Actually same with if I'm trying to use the fast forward function in full screen landscape mode."

This happens only in phone fullscreen (`mobileFs = annotateFullscreen && isMobile`, `AnnotateModeView.jsx` ~L1127-1230). Windowed portrait already puts the editor below the video (T10620). Measured with Playwright on the seeded `full` dev account, as the share of the visible video picture covered:

| State | Viewport | Covered |
|---|---|---|
| Edit play open | portrait 393x852 | 92% (the video is centred, leaving about 315px of empty black above it) |
| Edit play open | landscape 852x393 | 76% |
| Transport controls showing | landscape 852x393 | 88% |
| Transport controls showing | portrait 393x852 | 35% |

Causes:
1. The editor and the controls are `absolute bottom-0` layers (70dvh in portrait, 76dvh in landscape) on top of a full-screen `object-contain` video.
2. `isDraggingScrub` hides the controls layer during a drag but not the editor sheet, so the user trims without seeing the picture.
3. `useFullscreenControls` only starts the auto-hide timer while the video plays (`handleInteraction`, `if (isPlaying) startTimer()`). When paused, which is when the user trims and scrubs, the controls stay up.

## Solution

**B: portrait fullscreen.** Pin the video to the top, inside `env(safe-area-inset-top)`. Render the editor below it in normal page flow with `layout="portrait-strip"` (the T10620 branch), and the transport controls and timeline the same way. Nothing is drawn over the picture. Keep the exit-fullscreen button clear of the notch.

**D: both orientations, mainly landscape until T15370.**
- While a trim handle or the scrub bar is dragged, collapse the edit sheet to just the `ClipScrubRegion` row on a light background and hide the rest of the form. Restore it on release. Keep the scrub row mounted in the same place so the drag does not lose its touch.
- After any control interaction, start the auto-hide timer when paused as well as when playing.
- In landscape, hide the source bar and the zoom pill until the user taps the video.

## Acceptance criteria

1. [ ] Portrait fullscreen with Edit play open: 0% of the video picture is covered (picture rect vs editor rect).
2. [ ] Portrait fullscreen with controls showing: 0% of the picture is covered.
3. [ ] Landscape fullscreen while dragging a trim handle: at least 75% of the picture is visible. After release the full editor is back and the drag has not lost its touch.
4. [ ] Landscape fullscreen, paused: after a control tap, the controls hide within the auto-hide delay (3 s).
5. [ ] These keep working: double-tap skip, long-press drag mode, the soft keyboard over the name input in portrait, and the multi-video source bar.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/AnnotateModeView.jsx` (`mobileFs` branch)
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` (`portrait-strip`, `landscape-inline`, `onScrubDragChange`)
- `src/frontend/src/hooks/useFullscreenControls.js`
- Tests: `AnnotateFullscreenOverlay.portraitStrip.test.jsx`, `AnnotateModeView.portraitStrip.test.jsx`, the render-site inventory test

### Repro
The measurement harness (picture rect from `object-contain` vs overlay rect, for portrait 393x852 and landscape 852x393, `loginAsDevPreset(context, 'full')`) is in the appendix below (it reproduced the numbers above against pre-fix master on 2026-11-08). Turn it into the acceptance e2e spec for this task and assert the criteria thresholds.

### Knowledge
`.claude/knowledge/annotate.md`: T10620, T9500, T10800, T10780, T14350 (double-tap skip).

### Related Tasks
- T15370 (landscape side-strip layout, the follow-up)
- T10620 (portrait in-flow strip, windowed)
- T10840 (Focus landscape side-strip layout)

## Appendix: repro harness (pre-fix, 2026-11-08)

```js
// TEMP repro for user feedback (mobile editor/controls cover video). Not committed.
import { test, expect } from '@playwright/test';
import { loginAsDevPreset, openGameInAnnotate } from './helpers/realAuth.js';

const OUT = process.env.REPRO_OUT;
const VPS = [
  { label: 'portrait-393x852', width: 393, height: 852 },
  { label: 'landscape-852x393', width: 852, height: 393 },
];

// Fraction of the visible video PICTURE (object-contain rect) covered by `sel`.
async function coverage(page, sel) {
  return page.evaluate((sel) => {
    const v = [...document.querySelectorAll('video')].find(x => x.getBoundingClientRect().width > 50);
    const o = document.querySelector(sel);
    if (!v || !o) return { err: `video=${!!v} overlay=${!!o}` };
    const r = v.getBoundingClientRect();
    const vw = v.videoWidth || 16, vh = v.videoHeight || 9;
    const s = Math.min(r.width / vw, r.height / vh);
    const pw = vw * s, ph = vh * s;
    const pic = { x: r.x + (r.width - pw) / 2, y: r.y + (r.height - ph) / 2, w: pw, h: ph };
    const ob = o.getBoundingClientRect();
    const ix = Math.max(0, Math.min(pic.x + pic.w, ob.right) - Math.max(pic.x, ob.left));
    const iy = Math.max(0, Math.min(pic.y + pic.h, ob.bottom) - Math.max(pic.y, ob.top));
    return {
      picture: [pic.x, pic.y, pic.w, pic.h].map(Math.round),
      overlay: [ob.x, ob.y, ob.width, ob.height].map(Math.round),
      coveredPct: Math.round((ix * iy) / (pic.w * pic.h) * 100),
      viewport: [innerWidth, innerHeight],
    };
  }, sel);
}

for (const vp of VPS) {
  test(`repro ${vp.label}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: true,
      deviceScaleFactor: 2, baseURL: 'http://localhost:5173',
    });
    const page = await context.newPage();
    await loginAsDevPreset(context, 'full');
    const games = (await (await context.request.get('/api/games')).json()).games || [];
    const g = games.find(x => x.storage_status === 'active' && (x.clip_count || 0) > 0) || games[0];
    console.log(`[repro] game ${g?.id} clips=${g?.clip_count}`);
    await openGameInAnnotate(page, g.id);
    await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${vp.label}-0-windowed.png` });

    // Enter fullscreen (the user's state in both screenshots)
    await page.locator('button[title="Fullscreen"]').first().click();
    await page.waitForTimeout(800);
    // Tap stage to wake controls
    await page.mouse.click(vp.width / 2, vp.height / 3);
    await page.waitForTimeout(400);
    await page.mouse.click(vp.width / 2, vp.height / 3); // toggle play back
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${vp.label}-1-fs-controls.png` });
    const ctrl = await coverage(page, '[data-testid="annotate-controls"]');
    const ctrlBlock = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="annotate-controls"]');
      let n = c; while (n && !(n.className || '').toString().includes('absolute inset-x-0 bottom-0')) n = n.parentElement;
      if (!n) return null; n.setAttribute('data-repro', 'ctrl'); return true;
    });
    const ctrlFull = ctrlBlock ? await coverage(page, '[data-repro="ctrl"]') : null;
    console.log(`[repro] ${vp.label} controls-row`, JSON.stringify(ctrl), 'controls-block', JSON.stringify(ctrlFull));

    await page.mouse.move(vp.width/2+5, vp.height/3+5); await page.mouse.move(vp.width/2, vp.height/3); await page.waitForTimeout(200);
    // Open editor on an existing play (as the user did)
    await page.locator('.clip-marker').first().click({ force: true });
    await page.waitForTimeout(500);
    const cta = page.locator('[data-testid="annotate-primary-cta"]');
    if (await cta.isVisible().catch(() => false)) await cta.click();
    else await page.locator('button[title^="Edit selected play"]:visible, button[title^="Mark play"]:visible').first().click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${vp.label}-2-fs-editor.png` });
    await page.evaluate(() => {
      const f = document.querySelector('[data-add-clip-form]');
      let n = f; while (n && !(n.className || '').toString().includes('overflow-y-auto bg-gray-900/95')) n = n.parentElement;
      (n || f)?.setAttribute('data-repro', 'editor');
    });
    console.log(`[repro] ${vp.label} editor`, JSON.stringify(await coverage(page, '[data-repro="editor"]')));
    await context.close();
  });
}
```
