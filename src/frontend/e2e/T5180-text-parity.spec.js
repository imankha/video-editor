import { test, expect } from '@playwright/test';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T5180 — rich-text engine PARITY test (design §8, gate decisions Q3/Q4).
 *
 * Design: docs/plans/tasks/T5180-design.md. This is the deliverable that makes the
 * backend renderer (`app.services.text_render.render_text_layer`) and the frontend
 * preview (`RichText.jsx`) count as ONE system instead of two font stacks that can
 * silently drift. For every font in the catalogue, at both shipped resolutions, it
 * renders the SAME TextSpec through both paths and asserts:
 *   - box width/height + baseline agree within a documented tolerance (FILL-ONLY --
 *     shadow.blur=0, stroke.width=0 -- gate decision, resolves the shadow-bbox review
 *     note: CSS text-shadow never affects layout, so an inclusive-of-shadow backend
 *     bbox would compare two different things)
 *   - shadow presence/geometry is asserted SEPARATELY (halo outside the fill-only bbox
 *     on the backend; computed textShadow on the frontend) -- never folded into the
 *     box tolerance
 *   - stroke presence/geometry is asserted SEPARATELY (glyph-edge alpha extension on
 *     the backend; computed -webkit-text-stroke on the frontend)
 *
 * BRIDGING SEAM (judgment call — flagged for Implementor/Reviewer):
 * This repo's Playwright specs only ever drive the deployed/dev React app through real
 * routes (see e2e/helpers/targetEnv.js LOCAL_ONLY_SPECS for the existing seam
 * inventory) -- there is no existing "mount one isolated component" harness. Rather
 * than inventing a bespoke test-only bundler entry, this spec follows the established
 * `/api/test/*` seam convention (test_seams.py, gated by `_test_seams_enabled()`,
 * 404s on prod/staging, T4120/T4850 precedent) and ADDS TWO NEW LOCAL-ONLY SEAMS the
 * Implementor must build in Stage 4:
 *
 *   1. Backend: `POST /api/test/render-text-bbox` — body `{ spec, frame_w, frame_h }`,
 *      calls `render_text_layer` and returns `{ bbox: [minX, minY, maxX, maxY],
 *      baseline_y, shadow_halo_bbox: [...] | null, stroke_extent_px: number | null }`
 *      computed the same way this file's backend companion
 *      (tests/test_t5180_text_render.py) computes them, so the two suites can't drift
 *      on "what counts as the bbox." Gated exactly like the other `/api/test/*` seams
 *      (test_seams.py pattern: `_require_seams_enabled()`, 404 on prod/staging).
 *   2. Frontend: a debug route `/debug/rich-text?spec=<json>&boxWidth=<px>&boxHeight=<px>`
 *      that mounts a BARE `<RichText spec={...} boxWidth={...} boxHeight={...} />` with
 *      no chrome around it, gated the same way the app gates its `X-Test-Mode`/dev-only
 *      surfaces (see src/frontend/CLAUDE.md "Testing Auth Bypass"). This keeps
 *      `RichText.jsx` itself provider-free (per its own contract in RichText.test.jsx)
 *      while giving Playwright a real, in-app mount point instead of a synthetic
 *      standalone bundle that could drift from how T5210/T5225 actually use it.
 *
 * This spec is registered in e2e/helpers/targetEnv.js's LOCAL_ONLY_SPECS by the
 * Implementor once the seams exist (not yet done here — Stage 3 only pins the test).
 *
 * RED STATE (expected now): every test in this file fails because `/api/test/render-text-bbox`
 * and `/debug/rich-text` do not exist yet (404 / route not found). That is the correct
 * Stage 3 RED — Stage 4 implements both seams plus the underlying renderer/component.
 */

skipOnDeployedTarget(test, 'uses /api/test/render-text-bbox (dev/local-only seam, T5180)');

// Gate decision Q4 (frozen) — named constants, never inline magic numbers.
const TOL_BOX_FRACTION = 0.015; // 1.5% of the relevant frame dimension
const TOL_BASELINE_FRACTION = 0.005; // 0.5% of frame HEIGHT

const FONT_KEYS = ['anton', 'oswald', 'graduate', 'playfair'];

const RESOLUTIONS = [
  { w: 1080, h: 1920 },
  { w: 1920, h: 1080 },
];

function fillSpec(font) {
  return {
    text: 'MIDFIELDER 6-8-10',
    font,
    size: 0.08,
    color: '#FFD66B',
    align: 'left',
    position: { x: 0.1, y: 0.4 },
    maxWidth: 0.8,
    shadow: { blur: 0, color: '#000000', opacity: 0 },
    stroke: { width: 0, color: '#000000' },
    animation: 'none',
  };
}

function shadowSpec(font) {
  return {
    ...fillSpec(font),
    shadow: { blur: 0.08, color: '#000000', opacity: 0.55 },
  };
}

function strokeSpec(font) {
  return {
    ...fillSpec(font),
    stroke: { width: 0.06, color: '#FF0000' },
  };
}

// T6640 §2c — a WRAPPING two-word title (the exact shape of the reported card
// bug: a long name must wrap to 2 lines, never overflow one). Narrow maxWidth
// forces a wrap at the SAME word boundary the greedy algorithm on both sides
// chooses (RichText.jsx's `wrapLines` <-> text_render.py's `wrap_lines`, T6640
// §2a). No PII: an invented two-word name, not the real minor's.
function wrappingTitleSpec(font) {
  return {
    ...fillSpec(font),
    text: 'Anastasia Wintergreen',
    size: 0.1,
    maxWidth: 0.45,
  };
}

// The db_sync middleware requires a session for every non-allowlisted /api/*
// route (AUTH_ALLOWLIST_PREFIXES does NOT include /api/test — seams stay
// behind auth like everything else, matching the T4120 precedent of logging
// in before calling a seam). This mints a session cookie via the lightweight
// empty-account test-login (no real user data needed for a stateless render).
// MUST use `page.request` (shares the browser context's cookie jar), never
// the bare `request` fixture — that's the exact landmine recorded in
// export-pipeline.md § Testing seams ("shared test-login account + Playwright's
// bare request fixture").
async function authenticateForSeams(page) {
  await page.setExtraHTTPHeaders({ 'X-Test-Mode': 'true' });
  await page.goto('/');
  await page.evaluate(async () => {
    await fetch('/api/auth/test-login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Test-Mode': 'true' },
    });
  });
}

async function backendRenderBbox(page, spec, w, h) {
  const res = await page.request.post('/api/test/render-text-bbox', {
    data: { spec, frame_w: w, frame_h: h },
  });
  expect(res.status(), 'backend /api/test/render-text-bbox seam must exist and succeed').toBe(200);
  return res.json();
}

// getBoundingClientRect()/Playwright's boundingBox() measure the CSS LINE BOX
// (font metrics + line-height), not the glyph ink — for text with no
// descenders (all-caps captions, digits) the line box is taller than the
// actual rendered pixels, the same gap Pillow's tight alpha bbox never has.
// Diagnosed against the real /debug/rich-text route (font=anton 1080x1920):
// the CSS box came back 864x460 (== maxWidth, the *container's* available
// width — see the display:inline note on RichText.jsx) while the backend's
// tight alpha bbox was 652x365. So this measures the same thing the backend
// measures: the tight bounding box of actual glyph ink, per rendered line.
//   1. Walk the text node character-by-character (Range per char) and group
//      by rect.top to recover the browser's OWN line-wrap boundaries — no
//      re-implementation of word-wrap on the frontend (single source of
//      wrap truth stays the browser's UA line breaking, mirrored to the
//      backend only via the word-joiner suppression already in RichText.jsx).
//   2. Per line, re-measure that exact substring with Canvas 2D
//      `measureText()`, whose `actualBoundingBox*` fields report true glyph
//      ink extents (the browser's only tight-bbox primitive), and position
//      them at that line's real rendered (left, top).
//   3. Union the per-line ink boxes — the same "min/max over non-transparent
//      pixels" the backend's numpy bbox computes, just accumulated per line
//      instead of per pixel.
// `w`/`h` clamp the result to the frame bounds, mirroring the backend: its
// Pillow canvas is physically `frame_w x frame_h` pixels, so ink from an
// overflowing unbreakable word (no mid-word break in v1, same rule on both
// sides — design §6 step 3) is silently outside the buffer and never counted.
// The browser's DOM has no such implicit bound — getClientRects()/canvas ink
// report the FULL, untruncated geometry regardless of RichText.jsx's own
// `overflow: hidden` stage (that clips PAINTING, not layout/geometry
// queries) — so this measurement has to clip itself the same way, or an
// overflowing word (e.g. playfair's "MIDFIELDER" at 1080x1920, an
// 1100+px word inside a 1080px frame) reports a much wider box than the
// backend ever could. Diagnosed via T5180 parity.
async function measureTightInkBBox(page, w, h) {
  return page.evaluate(
    ([frameW, frameH]) => {
    const el = document.querySelector('[data-baseline-y]');
    const style = window.getComputedStyle(el);
    const fontPx = parseFloat(style.fontSize);
    const fontWeight = style.fontWeight;
    const fontFamily = style.fontFamily;

    const textNode = el.firstChild;
    const len = textNode.textContent.length;
    const range = document.createRange();
    const tops = [];
    for (let i = 0; i < len; i++) {
      range.setStart(textNode, i);
      range.setEnd(textNode, i + 1);
      const rects = range.getClientRects();
      tops.push(rects.length ? rects[0].top : tops[tops.length - 1] ?? 0);
    }
    const boundaries = [0];
    for (let i = 1; i < len; i++) {
      if (Math.abs(tops[i] - tops[i - 1]) > 1) boundaries.push(i);
    }
    boundaries.push(len);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${fontWeight} ${fontPx}px ${fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < boundaries.length - 1; k++) {
      range.setStart(textNode, boundaries[k]);
      range.setEnd(textNode, boundaries[k + 1]);
      // .trim() drops the collapsed wrap-point space (white-space: pre-line,
      // like 'normal', doesn't render it, but it's still a DOM character in
      // this Range) so it never inflates the measured line's ink width.
      const lineText = range.toString().trim();
      if (!lineText) continue;
      const lineRects = Array.from(range.getClientRects());
      if (!lineRects.length) continue;
      const lineLeft = Math.min(...lineRects.map((r) => r.left));
      const lineTop = Math.min(...lineRects.map((r) => r.top));

      const m = ctx.measureText(lineText);
      const baseline = lineTop + m.fontBoundingBoxAscent;
      minX = Math.min(minX, lineLeft - m.actualBoundingBoxLeft);
      maxX = Math.max(maxX, lineLeft + m.actualBoundingBoxRight);
      minY = Math.min(minY, baseline - m.actualBoundingBoxAscent);
      maxY = Math.max(maxY, baseline + m.actualBoundingBoxDescent);
    }
    if (minX === Infinity) return null;
    // Clip to the frame — see the function docstring above.
    const clampedMinX = Math.max(minX, 0);
    const clampedMaxX = Math.min(maxX, frameW);
    const clampedMinY = Math.max(minY, 0);
    const clampedMaxY = Math.min(maxY, frameH);
    return {
      x: clampedMinX,
      y: clampedMinY,
      width: clampedMaxX - clampedMinX,
      height: clampedMaxY - clampedMinY,
    };
    },
    [w, h]
  );
}

async function mountRichTextAndMeasure(page, spec, w, h) {
  const url = `/debug/rich-text?spec=${encodeURIComponent(JSON.stringify(spec))}&boxWidth=${w}&boxHeight=${h}`;
  await page.setViewportSize({ width: w, height: h });
  await page.goto(url);
  // Located via the data-baseline-y attribute (not getByText) — RichText.jsx
  // inserts an invisible WORD JOINER after in-word hyphens for wrap parity
  // (design §8 note), so the rendered text no longer contains the spec's
  // literal string as a substring.
  const textEl = page.locator('[data-baseline-y]').first();
  await expect(textEl).toBeVisible();
  // The @font-face rule is injected by a fetch of fonts.json (RichText.jsx's
  // useFontFaces), so the FIRST paint can land before the real TTF has
  // downloaded/parsed — the browser measures against its fallback font until
  // then, producing a different wrap/width than the backend's Pillow render.
  // Wait for the font set to finish loading before measuring (mirrors the
  // backend, which only ever measures the real face).
  //
  // `document.fonts.ready` alone isn't sufficient for BASELINE parity,
  // though: Canvas 2D measureText() (RichText.jsx's measureAscentPx, which
  // computes data-baseline-y) returns an approximate ascent for SOME NUMBER
  // of animation frames even after fonts.ready resolves — confirmed
  // empirically (T5180 diagnosis) by measuring Anton@154px repeatedly:
  // ~137px immediately after fonts.ready, settling to the accurate ~181px
  // (matching Pillow's font.getmetrics() ascent of 182px), but NOT after a
  // fixed frame count — it varied run to run. RichText.jsx's own
  // useSettledAscentPx hook handles this by polling every frame until two
  // consecutive measurements agree, then commits; mirror that here instead
  // of guessing a frame count — poll the DOM attribute until it stops
  // changing across frames, exactly like the hook does internally.
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    const el = document.querySelector('[data-baseline-y]');
    let previous = null;
    for (let frame = 0; frame < 30; frame++) {
      await new Promise(requestAnimationFrame);
      const current = el.getAttribute('data-baseline-y');
      if (current === previous) return;
      previous = current;
    }
  });
  const box = await measureTightInkBBox(page, w, h);
  const computed = await textEl.evaluate((el) => {
    const style = window.getComputedStyle(el);
    return {
      textShadow: style.textShadow,
      webkitTextStroke: style.webkitTextStrokeWidth || style.WebkitTextStrokeWidth,
      fontSize: parseFloat(style.fontSize),
    };
  });
  return { box, computed };
}

// T6640 round 3 — card-level collision regression (design §4, extends this
// spec per rounds-1-2 §2c). Root cause (design §1): the card preview computed
// a title's wrapped line count TWICE — once in
// introCardPreviewElements.js::layout (to RESERVE height for the block below
// it) and once again inside RichText.jsx (to actually DRAW the glyphs) — with
// different font-family strings and independent settle loops. At the
// `broadcast` composition's title size (0.068, right at the wrap boundary),
// the two disagreed: layout() reserved 1 line while RichText drew 2, so the
// title's second line landed on top of the primary fact below it.
//
// The fix (design §2 Option 1, shipped by Stage 4): layout() emits the
// ALREADY-COMPUTED `lines` into each element's TextSpec; RichText renders
// those verbatim instead of re-deriving them — ONE wrap decision now feeds
// BOTH the reserved height and the drawn glyphs, so the two can no longer
// disagree.
//
// This must run in a REAL BROWSER (not jsdom — see design §0 "what the matrix
// does NOT prove" and T5380/T6610–T6480 false-green precedent: jsdom has no
// FontFaceSet and canvas metrics never settle, so it cannot exhibit the
// font-settle race this bug is made of).
//
// No existing route mounts the full <IntroCardPreview> card component for
// Playwright (only /debug/rich-text mounts a bare <RichText>, T5180's seam).
// Rather than inventing a new debug route (a production-code change, out of
// scope for the Tester phase), this reuses the EXISTING /debug/rich-text seam
// twice — once per element — with specs computed by the REAL
// introCardPreviewElements.layout() mirror (imported in-page via Vite's dev
// `/src/...` module path, same pattern T4100-dedup-honest-message.spec.js
// uses for in-page store imports), so the title/fact1 specs under test are
// byte-identical to what the actual card preview would produce for the exact
// live-repro parameters (broadcast composition, 9:16, a wrapping two-word
// name) — not hand-rolled positions that could drift from the real layout.
test.describe('T6640 round 3 — card title/fact collision (real browser, broadcast composition)', () => {
  skipOnDeployedTarget(
    test,
    "import()s /src/components/introcards/introCardPreviewElements.js (Vite-dev path; 404s on a deployed build)"
  );

  // Invented name (no PII), matching the design's exact live-repro composition
  // (broadcast) and aspect (9:16) — the one combination where rounds-1-2 left
  // the residual overlap (recruiting already agreed on 2 lines both sides).
  const CARD = { treatment: 'gold', shown_fields: ['position'] };
  const PROFILE = { full_name: 'Anastasia Wintergreen', position: 'Midfielder' };
  const COMPOSITION = 'broadcast';
  const ASPECT = '9:16';
  const { w: FRAME_W, h: FRAME_H } = RESOLUTIONS[0]; // 1080x1920 (9:16 canonical)

  test('title and primary-fact ink boxes never intersect (the exact reported collision)', async ({ page }) => {
    await authenticateForSeams(page);

    // Compute the REAL layout()-produced specs for this card, in-page (needs
    // the browser's canvas for wrapLines/measureFontMetricsPx — see
    // introCardPreviewElements.js — so this can't run in the Node test body).
    const { titleSpec, fact1Spec } = await page.evaluate(
      async ({ card, profile, composition, aspect, frameW, frameH }) => {
        const { buildPreviewElements } = await import(
          '/src/components/introcards/introCardPreviewElements.js'
        );
        const els = buildPreviewElements(card, profile, composition, aspect, frameW, frameH);
        return {
          titleSpec: els.find((e) => e.slot === 'title')?.spec ?? null,
          fact1Spec: els.find((e) => e.slot === 'fact1')?.spec ?? null,
        };
      },
      { card: CARD, profile: PROFILE, composition: COMPOSITION, aspect: ASPECT, frameW: FRAME_W, frameH: FRAME_H }
    );

    expect(titleSpec, 'layout() must produce a title element for this card').not.toBeNull();
    expect(fact1Spec, 'layout() must produce a fact1 element for this card').not.toBeNull();

    const { box: titleBox } = await mountRichTextAndMeasure(page, titleSpec, FRAME_W, FRAME_H);
    const { box: factBox } = await mountRichTextAndMeasure(page, fact1Spec, FRAME_W, FRAME_H);

    expect(titleBox, 'title did not render a measurable ink box').not.toBeNull();
    expect(factBox, 'fact1 did not render a measurable ink box').not.toBeNull();

    // Sanity check this IS the wrap-boundary repro (RichText actually drew 2
    // lines for the title) — otherwise this test would pass vacuously even
    // with the pre-fix bug, since a single-line title never had anywhere to
    // collide. Checked against the ACTUAL RENDERED box (not layout()'s
    // not-yet-existent `lines` field, which is exactly what this test is
    // proving is missing pre-fix) — a 2-line title's ink box is well over
    // one line height tall.
    const titleFontPxApprox = titleSpec.size * FRAME_H;
    expect(
      titleBox.height,
      'expected the long two-word name to actually render as 2 lines at the broadcast composition\'s ' +
        'title size (the exact wrap-boundary condition from design §1) — a single-line box would be ' +
        'roughly one line height tall, not this'
    ).toBeGreaterThan(titleFontPxApprox * 1.3);

    // No vertical overlap between the two ink boxes — this is the reserved
    // height (layout()'s `lines`) agreeing with the rendered height
    // (RichText's drawn `lines`), the collision made structurally impossible
    // by construction once both read the SAME `lines` array (design §2).
    const titleBottom = titleBox.y + titleBox.height;
    const factTop = factBox.y;
    expect(
      titleBottom,
      `title ink box (y=${titleBox.y}, h=${titleBox.height}, bottom=${titleBottom}) must not extend past ` +
        `fact1's ink box top (y=${factTop}) — a positive gap means no collision`
    ).toBeLessThanOrEqual(factTop);
  });
});

test.describe('T5180 text engine parity — backend renderer vs RichText.jsx', () => {
  for (const font of FONT_KEYS) {
    for (const { w, h } of RESOLUTIONS) {
      test(`box/baseline parity (fill-only) — font=${font} ${w}x${h}`, async ({ page }) => {
        await authenticateForSeams(page);
        const spec = fillSpec(font);

        const backend = await backendRenderBbox(page, spec, w, h);
        const [bMinX, bMinY, bMaxX, bMaxY] = backend.bbox;
        const backendWidth = bMaxX - bMinX;
        const backendHeight = bMaxY - bMinY;
        const backendBaseline = backend.baseline_y;

        const { box: frontendBox } = await mountRichTextAndMeasure(page, spec, w, h);
        expect(frontendBox, 'RichText did not render a measurable box').not.toBeNull();

        // Baseline on the frontend: approximate as the text box's top + the font's
        // ascent proportion. Per design §7/§6 both sides derive line box from font
        // metrics, so this should land within TOL_BASELINE_FRACTION of the backend's
        // metrics-derived baseline. The exact DOM read is an Implementor judgment call
        // (e.g. exposing a data-baseline-y attribute), flagged here rather than invented.
        const frontendBaseline = await page
          .locator('[data-baseline-y]')
          .first()
          .evaluate((el) => {
            const attr = el.getAttribute('data-baseline-y');
            return attr !== null ? parseFloat(attr) : null;
          });
        expect(
          frontendBaseline,
          'RichText must expose its computed baseline (e.g. data-baseline-y) for parity measurement — see design §7/§8'
        ).not.toBeNull();

        expect(Math.abs(backendWidth - frontendBox.width)).toBeLessThanOrEqual(TOL_BOX_FRACTION * w);
        expect(Math.abs(backendHeight - frontendBox.height)).toBeLessThanOrEqual(TOL_BOX_FRACTION * h);
        expect(Math.abs(backendBaseline - frontendBaseline)).toBeLessThanOrEqual(TOL_BASELINE_FRACTION * h);
      });

      test(`shadow presence/geometry (separate from box tolerance) — font=${font} ${w}x${h}`, async ({
        page,
      }) => {
        await authenticateForSeams(page);
        const spec = shadowSpec(font);

        const backend = await backendRenderBbox(page, spec, w, h);
        expect(
          backend.shadow_halo_bbox,
          'shadow.blur > 0 must produce a halo bbox larger than the fill-only bbox'
        ).not.toBeNull();
        const [fMinX, fMinY, fMaxX, fMaxY] = backend.bbox; // fill-only bbox, same endpoint
        const [sMinX, sMinY, sMaxX, sMaxY] = backend.shadow_halo_bbox;
        expect(sMaxX - sMinX).toBeGreaterThan(fMaxX - fMinX);
        expect(sMaxY - sMinY).toBeGreaterThan(fMaxY - fMinY);

        const { computed } = await mountRichTextAndMeasure(page, spec, w, h);
        expect(computed.textShadow).not.toBe('none');
        expect(computed.textShadow).toMatch(/rgba?\(/);
      });

      test(`stroke presence/geometry (separate from box tolerance) — font=${font} ${w}x${h}`, async ({
        page,
      }) => {
        await authenticateForSeams(page);
        const spec = strokeSpec(font);

        const backend = await backendRenderBbox(page, spec, w, h);
        expect(
          backend.stroke_extent_px,
          'stroke.width > 0 must report a positive glyph-edge extension'
        ).toBeGreaterThan(0);

        const { computed } = await mountRichTextAndMeasure(page, spec, w, h);
        const strokePx = parseFloat(computed.webkitTextStroke || '0');
        expect(strokePx).toBeGreaterThan(0);
        // Em-relative: strokePx = spec.stroke.width * fontPx (gate Q1, design §7).
        const expectedStrokePx = spec.stroke.width * computed.fontSize;
        expect(Math.abs(strokePx - expectedStrokePx)).toBeLessThanOrEqual(1); // 1px rounding slack
      });

      test(`wrapping title — identical line breaks (T6640 §2c) — font=${font} ${w}x${h}`, async ({ page }) => {
        // The load-bearing runtime check for T6640: both renderers must wrap
        // "Anastasia Wintergreen" to the SAME line count at the SAME word
        // boundary. A divergence (e.g. one side breaking after "Anastasia",
        // the other overflowing on one line, or breaking mid-word) inflates
        // the aggregate tight-ink bbox width AND/OR height well past
        // TOL_BOX_FRACTION -- this is the SAME box/baseline machinery the
        // fill-only test above uses, just with text that forces a real wrap
        // instead of staying on one line.
        await authenticateForSeams(page);
        const spec = wrappingTitleSpec(font);

        const backend = await backendRenderBbox(page, spec, w, h);
        const [bMinX, bMinY, bMaxX, bMaxY] = backend.bbox;
        const backendWidth = bMaxX - bMinX;
        const backendHeight = bMaxY - bMinY;
        const backendBaseline = backend.baseline_y;

        const { box: frontendBox } = await mountRichTextAndMeasure(page, spec, w, h);
        expect(frontendBox, 'RichText did not render a measurable box').not.toBeNull();
        const frontendBaseline = await page
          .locator('[data-baseline-y]')
          .first()
          .evaluate((el) => parseFloat(el.getAttribute('data-baseline-y')));

        // A single line at this size/font would be roughly HALF this height
        // (sanity check that the wrap actually happened on BOTH sides, not
        // just that the two sides happen to agree on some other failure mode).
        const fontPxApprox = spec.size * h;
        expect(backendHeight).toBeGreaterThan(fontPxApprox * 1.3);
        expect(frontendBox.height).toBeGreaterThan(fontPxApprox * 1.3);

        expect(Math.abs(backendWidth - frontendBox.width)).toBeLessThanOrEqual(TOL_BOX_FRACTION * w);
        expect(Math.abs(backendHeight - frontendBox.height)).toBeLessThanOrEqual(TOL_BOX_FRACTION * h);
        expect(Math.abs(backendBaseline - frontendBaseline)).toBeLessThanOrEqual(TOL_BASELINE_FRACTION * h);
      });
    }
  }
});
