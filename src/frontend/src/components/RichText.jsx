// T5180 rich text engine — THE ONE frontend preview.
//
// Design: docs/plans/tasks/T5180-design.md §7. Pure presentational (MVC rule):
// props in, no store access, no fetching of app data. The one-time
// `fonts.json` manifest fetch (useFontFaces below) is a static-asset read,
// not app state — it injects @font-face rules into the document, it does not
// touch a Zustand store or persist anything.
//
// <RichText spec={TextSpec} boxWidth={px} boxHeight={px} />
//   fontPx      = spec.size     * boxHeight
//   maxWidth    = spec.maxWidth * boxWidth   (px)
//   left/top    = spec.position.x * boxWidth, spec.position.y * boxHeight
//   textAlign   = spec.align
//   blurPx      = spec.shadow.blur  * fontPx   (EM-RELATIVE — fraction of the
//                 RESOLVED fontPx, NOT of boxHeight directly; gate decision Q1)
//   strokePx    = spec.stroke.width * fontPx   (same em-relative resolution)
//   fontFamily  = spec.font (the @font-face family injected from fonts.json)
//
// No data guard needed inside — parent guarantees `spec` exists (data-always-ready).

import { useEffect, useState } from 'react';

import { resolveApiUrl } from '../config';

// MUST go through resolveApiUrl. A bare '/api/...' resolves against the FRONTEND
// origin, which in staging/prod is Cloudflare Pages, not the API — the SPA
// catch-all then answers with index.html (HTTP 200, text/html). The manifest
// fetch silently yields non-JSON and NO @font-face rules get injected, so every
// face falls back to the same default and the font picker appears to do nothing.
// Local dev hides this because Vite proxies /api to the backend.
const FONTS_MANIFEST_URL = resolveApiUrl('/api/fonts/fonts.json');

// Module-level so @font-face rules are injected at most once per manifest,
// regardless of how many RichText instances mount (one-time static-asset
// read, not per-instance state).
let fontFacesInjected = false;
let fontFacesPromise = null;

// Oswald + Playfair ship as `wght`-axis VARIABLE TTFs (no static instance
// exists upstream — T5180 supervisor decision). `font-weight` on a variable
// @font-face must be declared as a RANGE (its full variationRange), not the
// single pinned value, or the browser only registers the face for that one
// weight and ignores font-variation-settings-based interpolation. The actual
// pinned instance is set per-element via `font-variation-settings: 'wght' N`
// (textStyle below) — `fonts.json`'s `weight` is the single source of truth
// for N on BOTH sides (backend: `fonts.py::load_font_for_render`).
function injectFontFaces(manifest) {
  if (fontFacesInjected) return;
  fontFacesInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-rich-text-font-faces', 'true');
  const rules = Object.entries(manifest)
    .map(([key, entry]) => {
      const format = entry.isVariable ? 'truetype-variations' : 'truetype';
      const weightDescriptor = entry.isVariable
        ? `${entry.variationRange[0]} ${entry.variationRange[1]}`
        : entry.weight || 400;
      return `@font-face {
        font-family: "${key}";
        src: url("${resolveApiUrl(`/api/fonts/${entry.file}`)}") format("${format}");
        font-weight: ${weightDescriptor};
        font-style: ${entry.style || 'normal'};
      }`;
    })
    .join('\n');
  style.textContent = rules;
  document.head.appendChild(style);
  // Stash the full manifest on the module so resolveFontFamily/consumers can
  // read fallback chains + weight/variation info without a second fetch.
  injectFontFaces._manifest = manifest;
}

/**
 * Fetches /api/fonts/fonts.json ONCE (module-level dedup) and injects one
 * @font-face rule per catalogue entry. This is a one-time read of a static
 * asset into the DOM (design §5) — not persistence, not reactive app-state
 * sync, so a plain useEffect fetch is the sanctioned pattern here.
 */
function useFontFaces() {
  const [manifest, setManifest] = useState(injectFontFaces._manifest || null);

  useEffect(() => {
    if (fontFacesInjected) {
      setManifest(injectFontFaces._manifest || null);
      return;
    }
    if (!fontFacesPromise) {
      fontFacesPromise = fetch(FONTS_MANIFEST_URL)
        .then((res) => (res.ok ? res.json() : null))
        .then((loadedManifest) => {
          if (loadedManifest) injectFontFaces(loadedManifest);
          return loadedManifest;
        })
        .catch(() => null);
    }
    let cancelled = false;
    fontFacesPromise.then(() => {
      if (!cancelled) setManifest(injectFontFaces._manifest || null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return manifest;
}

function resolveFontFamily(fontKey, manifest) {
  const chain = (manifest && manifest[fontKey] && manifest[fontKey].fallback) || [];
  return [`"${fontKey}"`, ...chain].join(', ');
}

/**
 * Ascent/descent for the baseline offset AND the line-height (design §7/§8).
 * Browsers don't expose exact per-element font-metrics through CSS, so this
 * measures the SAME font-family/size via a hidden canvas
 * (`measureText().fontBoundingBox{Ascent,Descent}`), which mirrors what the
 * backend derives from `font.getmetrics()`.
 *
 * Both values matter, not just ascent: the backend positions line N+1 at
 * `y + N * (ascent + descent)` (design §6 step 2 — line advance from the
 * face's own metrics, never a hard-coded multiplier). Diagnosed via T5180
 * parity (font=graduate, 1080x1920): the browser's own `line-height: normal`
 * measured 230px between lines, but backend ascent+descent was only 176px —
 * a real per-font divergence (CSS's "normal" line-height algorithm doesn't
 * always equal hhea ascent+descent; it can fold in extra leading from other
 * metrics tables the font ships). Left alone, that makes the frontend
 * consistently taller/multi-line text mis-spaced relative to the backend.
 * Setting the SAME two numbers as an explicit `line-height` in RichText's
 * textStyle (below) forces the browser's line box advance to match the
 * backend's, instead of trusting the browser's own "normal" guess.
 */
function measureFontMetricsPx(fontFamily, fontPx, fontWeight = 400) {
  try {
    // Fresh canvas/context per call (cheap relative to a text layout) — no
    // reason to memoize one across renders.
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    // Canvas 2D's `font` shorthand has no font-variation-settings equivalent,
    // but it DOES parse a numeric weight and resolves it against the
    // registered @font-face — including a variable face's weight RANGE — so
    // passing the pinned weight here selects the same instance as the CSS
    // `font-variation-settings` on the actual text element.
    ctx.font = `${fontWeight} ${fontPx}px ${fontFamily}`;
    const metrics = ctx.measureText('Mg');
    if (typeof metrics.fontBoundingBoxAscent === 'number' && typeof metrics.fontBoundingBoxDescent === 'number') {
      return { ascentPx: metrics.fontBoundingBoxAscent, descentPx: metrics.fontBoundingBoxDescent };
    }
    if (typeof metrics.actualBoundingBoxAscent === 'number' && typeof metrics.actualBoundingBoxDescent === 'number') {
      return { ascentPx: metrics.actualBoundingBoxAscent, descentPx: metrics.actualBoundingBoxDescent };
    }
  } catch {
    // Canvas measurement unavailable (e.g. some test environments) — fall
    // through to the approximation below.
  }
  // Reasonable approximation when canvas metrics aren't available: most
  // Latin faces have an ascent around 0.8 of the em size, descent 0.2.
  return { ascentPx: fontPx * 0.8, descentPx: fontPx * 0.2 };
}

// Canvas 2D measureText() against a custom @font-face returns APPROXIMATE
// metrics (Anton@154px measured fontBoundingBoxAscent=137) for SOME NUMBER
// of animation frames even AFTER `document.fonts.ready` has resolved and
// `document.fonts.check(...)` reports true — the accurate metric (=181px,
// matching Pillow's font.getmetrics() ascent of 182px) only shows up once
// the browser has actually settled on that face for metrics purposes.
// `document.fonts.ready` tracks the font FILE finishing download/parse, not
// this later "warmed up" point, and — confirmed empirically via T5180
// parity diagnosis — the number of frames that takes is NOT a fixed
// constant (varied between 0 and 2+ across runs), so a single
// re-measurement after a fixed rAF count is not reliable: it can still land
// on the stale value and this hook only ever gets one shot, since nothing
// else re-renders RichText afterward. Instead, poll frame by frame and only
// accept the measurement once it's IDENTICAL across two consecutive frames
// (i.e. it has stopped changing) — genuinely stable, not just "waited long
// enough". `maxFrames` bounds it in case a family never stabilizes (e.g.
// canvas unavailable), so this can't hang forever.
function useSettledFontMetricsPx(fontFamily, fontPx, fontWeight, maxFrames = 30) {
  const [metrics, setMetrics] = useState(() => measureFontMetricsPx(fontFamily, fontPx, fontWeight));

  useEffect(() => {
    // jsdom (unit tests) has no FontFaceSet API — the initial measurement
    // from useState's initializer (already canvas-guarded, see
    // measureFontMetricsPx) is as good as this hook can do there.
    if (typeof document === 'undefined' || !document.fonts) return undefined;
    let cancelled = false;
    let rafId;
    document.fonts.ready.then(() => {
      let previous = null;
      let frame = 0;
      const step = () => {
        if (cancelled) return;
        const current = measureFontMetricsPx(fontFamily, fontPx, fontWeight);
        const key = `${current.ascentPx}:${current.descentPx}`;
        if (key === previous || frame >= maxFrames) {
          setMetrics(current);
          return;
        }
        previous = key;
        frame += 1;
        rafId = requestAnimationFrame(step);
      };
      rafId = requestAnimationFrame(step);
    });
    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [fontFamily, fontPx, fontWeight, maxFrames]);

  return metrics;
}

export function RichText({ spec, boxWidth, boxHeight }) {
  const manifest = useFontFaces();
  const fontEntry = manifest && manifest[spec.font];

  const fontPx = spec.size * boxHeight;
  const maxWidthPx = spec.maxWidth * boxWidth;
  const leftPx = spec.position.x * boxWidth;
  const topPx = spec.position.y * boxHeight;
  const blurPx = spec.shadow.blur * fontPx;
  const strokePx = spec.stroke.width * fontPx;
  const fontFamily = resolveFontFamily(spec.font, manifest);
  // Variable faces (oswald, playfair) need the exact pinned instance set via
  // font-variation-settings — the @font-face weight RANGE alone only tells
  // the browser the face IS variable across that range, it does not pick an
  // instance. fonts.json's `weight` is the single pinned value on both sides.
  const fontWeight = fontEntry ? fontEntry.weight : 400;
  const fontVariationSettings = fontEntry && fontEntry.isVariable ? `'wght' ${fontEntry.weight}` : undefined;

  const shadowRgba = hexToRgba(spec.shadow.color, spec.shadow.opacity);
  const textShadow = spec.shadow.opacity > 0 ? `0 0 ${blurPx}px ${shadowRgba}` : 'none';

  const { ascentPx, descentPx } = useSettledFontMetricsPx(fontFamily, fontPx, fontWeight);
  const baselineY = topPx + ascentPx;
  // Matches the backend's line advance exactly (design §6 step 2:
  // `line_advance = ascent + descent`, never the browser's own guess at
  // "normal" line-height — see measureFontMetricsPx's docstring for the
  // per-font divergence this was diagnosed against).
  const lineHeightPx = ascentPx + descentPx;

  // anchor per align: left -> left edge at leftPx, center -> centered on
  // leftPx, right -> right edge at leftPx. Mirrors the backend's anchor
  // resolution (design §6 step 4).
  const wrapperStyle = {
    position: 'absolute',
    top: `${topPx}px`,
    maxWidth: `${maxWidthPx}px`,
    textAlign: spec.align,
    fontFamily,
    ...(spec.align === 'left' && { left: `${leftPx}px` }),
    ...(spec.align === 'right' && { right: `${boxWidth - leftPx}px` }),
    ...(spec.align === 'center' && {
      left: `${leftPx}px`,
      transform: 'translateX(-50%)',
    }),
  };

  // display:inline (not inline-block) + whiteSpace:pre-line (not pre-wrap) —
  // T5180 parity-test diagnosis. The wrapper div's `maxWidth` makes it
  // shrink-to-fit at whatever's SMALLER of the content's natural width and
  // maxWidth; once the text needs to wrap, the CSS shrink-to-fit formula
  // (min(max(min-content, available), max-content)) resolves to the full
  // available width, NOT the widest actually-rendered line — so an
  // inline-block span measured via getBoundingClientRect reports the
  // CONTAINER's width, not the text's. A plain `inline` span instead lets
  // getClientRects()/getBoundingClientRect() report the tight union of the
  // real per-line fragment boxes (still wraps at the parent's maxWidth,
  // same visual layout). `pre-wrap` also visibly preserves the space that
  // caused a soft wrap as its own trailing fragment on the line before it,
  // inflating that union box further; `pre-line` collapses it like `normal`
  // (while still honouring explicit \n, which is all this component needs
  // whitespace preservation for).
  const textStyle = {
    fontSize: `${fontPx}px`,
    fontWeight,
    fontStyle: (fontEntry && fontEntry.style) || 'normal',
    ...(fontVariationSettings && { fontVariationSettings }),
    color: spec.color,
    textShadow,
    WebkitTextStroke: `${strokePx}px ${spec.stroke.color}`,
    whiteSpace: 'pre-line',
    margin: 0,
    display: 'inline',
    lineHeight: `${lineHeightPx}px`,
  };

  // The outer box is exactly boxWidth x boxHeight with overflow:hidden — the
  // DOM equivalent of the backend's Pillow canvas, which is physically
  // frame_w x frame_h and can't draw a pixel past that edge (ink beyond it
  // is simply outside the buffer). Without this, an overflowing WORD (no
  // mid-word break in v1, same on both sides — design §6 step 3) is clipped
  // on the backend but rendered in full by the browser, which has no
  // implicit bound; diagnosed via T5180 parity (playfair @
  // 1080x1920, where "MIDFIELDER" alone is wider than the frame) as a
  // genuine renderer mismatch, not a measurement issue.
  const stageStyle = {
    position: 'relative',
    width: `${boxWidth}px`,
    height: `${boxHeight}px`,
    overflow: 'hidden',
  };

  return (
    <div style={stageStyle}>
      <div style={wrapperStyle}>
        <span style={textStyle} data-baseline-y={baselineY}>
          {suppressInWordBreaks(spec.text)}
        </span>
      </div>
    </div>
  );
}

// The backend's greedy word-wrap (text_render.py) only ever breaks on
// whitespace — a token like "6-8-10" is one unbreakable unit. The browser's
// default UAX#14 line breaking additionally allows a break AFTER a hyphen,
// so plain text would wrap "MIDFIELDER 6-" / "8-10" where the backend wraps
// "MIDFIELDER" / "6-8-10" — a real parity divergence, not a tolerance
// rounding difference (design §8). Inserting a zero-width WORD JOINER
// (U+2060) after every in-word hyphen suppresses that break opportunity
// while leaving actual whitespace breaks (and the DOM/text-node structure —
// still one text node, no extra elements) untouched.
function suppressInWordBreaks(text) {
  return text.replace(/-(?=\S)/g, '-⁠');
}

function hexToRgba(hex, opacity) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export default RichText;
