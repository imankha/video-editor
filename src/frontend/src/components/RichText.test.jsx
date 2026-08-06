// T5180 -- rich text engine: the ONE frontend preview.
//
// Design: docs/plans/tasks/T5180-design.md (APPROVED 2026-08-04), section 7.
//   <RichText spec={TextSpec} boxWidth={px} boxHeight={px} />
//   - Pure presentational: props in, no store, no fetch of app data (fonts.json manifest
//     fetch is a one-time static-asset read, not app-state -- still no Zustand import).
//   - fontPx    = spec.size     * boxHeight
//   - maxWidth  = spec.maxWidth * boxWidth
//   - left/top  = spec.position.x * boxWidth, spec.position.y * boxHeight
//   - textAlign = spec.align
//   - blurPx    = spec.shadow.blur  * fontPx   (em-relative -- fraction of the RESOLVED
//                 fontPx, NOT of boxHeight directly; gate decision Q1)
//   - strokePx  = spec.stroke.width * fontPx   (same em-relative resolution)
//   - fontFamily = spec.font (the @font-face family injected from fonts.json)
//
// `RichText.jsx` and `src/constants/textSpec.js` (Align/Animation/FontKey as-const maps +
// TextSpec JSDoc typedef) do not exist yet -- this file is expected to fail on import
// (Stage 3 RED). The Implementor (Stage 4) builds both to satisfy this contract.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RichText } from './RichText';
import { Align, FontKey } from '../constants/textSpec';

const BOX_WIDTH = 1080;
const BOX_HEIGHT = 1920;

function baseSpec(overrides = {}) {
  return {
    text: 'MIDFIELDER  6 - 8 - 10',
    font: FontKey.ANTON,
    size: 0.08,
    color: '#FFD66B',
    align: Align.LEFT,
    position: { x: 0.08, y: 0.4 },
    maxWidth: 0.84,
    shadow: { blur: 0, color: '#000000', opacity: 0 },
    stroke: { width: 0, color: '#000000' },
    animation: 'none',
    ...overrides,
  };
}

describe('RichText', () => {
  it('renders the given text', () => {
    render(<RichText spec={baseSpec({ text: 'GOAL' })} boxWidth={BOX_WIDTH} boxHeight={BOX_HEIGHT} />);
    expect(screen.getByText('GOAL')).toBeTruthy();
  });

  it('is pure presentational: same props produce the same output, no provider needed', () => {
    // No store/context provider wraps this render -- if RichText secretly reached into a
    // Zustand store or fetched app state, this would throw or render blank.
    const spec = baseSpec({ text: 'PURE' });
    const { container: containerA } = render(
      <RichText spec={spec} boxWidth={BOX_WIDTH} boxHeight={BOX_HEIGHT} />
    );
    const { container: containerB } = render(
      <RichText spec={spec} boxWidth={BOX_WIDTH} boxHeight={BOX_HEIGHT} />
    );
    expect(containerA.textContent).toBe(containerB.textContent);
    expect(containerA.textContent).toContain('PURE');
  });

  it('maps size to fontSize = spec.size * boxHeight', () => {
    const spec = baseSpec({ text: 'SIZED', size: 0.1 });
    render(<RichText spec={spec} boxWidth={BOX_WIDTH} boxHeight={BOX_HEIGHT} />);
    const el = screen.getByText('SIZED');
    const expectedPx = spec.size * BOX_HEIGHT; // 192px
    expect(el.style.fontSize).toBe(`${expectedPx}px`);
  });

  it('maps maxWidth to a pixel maxWidth = spec.maxWidth * boxWidth', () => {
    const spec = baseSpec({ text: 'WRAPPED', maxWidth: 0.5 });
    render(<RichText spec={spec} boxWidth={BOX_WIDTH} boxHeight={BOX_HEIGHT} />);
    const el = screen.getByText('WRAPPED');
    // maxWidth may be set on the text node itself or an ancestor wrapper -- walk up to find it.
    let node = el;
    let foundMaxWidth = null;
    while (node && foundMaxWidth === null) {
      if (node.style && node.style.maxWidth) foundMaxWidth = node.style.maxWidth;
      node = node.parentElement;
    }
    expect(foundMaxWidth).toBe(`${spec.maxWidth * BOX_WIDTH}px`);
  });

  it('maps position.x/y into left/top pixel offsets scaled by boxWidth/boxHeight', () => {
    const spec = baseSpec({ text: 'POSITIONED', position: { x: 0.25, y: 0.6 } });
    render(<RichText spec={spec} boxWidth={BOX_WIDTH} boxHeight={BOX_HEIGHT} />);
    const el = screen.getByText('POSITIONED');
    let node = el;
    let left = null;
    let top = null;
    while (node && (left === null || top === null)) {
      if (node.style) {
        if (left === null && node.style.left) left = node.style.left;
        if (top === null && node.style.top) top = node.style.top;
      }
      node = node.parentElement;
    }
    expect(left).toBe(`${spec.position.x * BOX_WIDTH}px`);
    expect(top).toBe(`${spec.position.y * BOX_HEIGHT}px`);
  });

  it.each([
    [Align.LEFT, 'left'],
    [Align.CENTER, 'center'],
    [Align.RIGHT, 'right'],
  ])('applies align=%s as textAlign=%s', (align, expectedCss) => {
    const spec = baseSpec({ text: 'ALIGNED', align });
    render(<RichText spec={spec} boxWidth={BOX_WIDTH} boxHeight={BOX_HEIGHT} />);
    const el = screen.getByText('ALIGNED');
    let node = el;
    let textAlign = null;
    while (node && textAlign === null) {
      if (node.style && node.style.textAlign) textAlign = node.style.textAlign;
      node = node.parentElement;
    }
    expect(textAlign).toBe(expectedCss);
  });

  it('wires font-family to the spec.font key (for @font-face resolution from fonts.json)', () => {
    const spec = baseSpec({ text: 'FONTED', font: FontKey.PLAYFAIR });
    render(<RichText spec={spec} boxWidth={BOX_WIDTH} boxHeight={BOX_HEIGHT} />);
    const el = screen.getByText('FONTED');
    let node = el;
    let fontFamily = null;
    while (node && fontFamily === null) {
      if (node.style && node.style.fontFamily) fontFamily = node.style.fontFamily;
      node = node.parentElement;
    }
    expect(fontFamily).toContain(FontKey.PLAYFAIR);
  });

  it('resolves blurPx from fontPx (em-relative), not from boxHeight directly', () => {
    // blurPx = spec.shadow.blur * fontPx, where fontPx = spec.size * boxHeight.
    // A frame-relative bug would compute blur = spec.shadow.blur * boxHeight instead --
    // this test's two cases (same size, different boxHeight) or (different size, same
    // boxHeight) must disambiguate. We vary `size` at a FIXED boxHeight: an em-relative
    // resolution scales the textShadow blur radius with size; a frame-relative bug would
    // hold it constant.
    const smallSpec = baseSpec({
      text: 'SMALL',
      size: 0.04,
      shadow: { blur: 0.1, color: '#000000', opacity: 0.5 },
    });
    const largeSpec = baseSpec({
      text: 'LARGE',
      size: 0.08,
      shadow: { blur: 0.1, color: '#000000', opacity: 0.5 },
    });

    const { unmount: unmountSmall } = render(
      <RichText spec={smallSpec} boxWidth={BOX_WIDTH} boxHeight={BOX_HEIGHT} />
    );
    const smallEl = screen.getByText('SMALL');
    const smallFontPx = smallSpec.size * BOX_HEIGHT;
    const expectedSmallBlurPx = smallSpec.shadow.blur * smallFontPx;
    expect(smallEl.style.textShadow).toContain(`${expectedSmallBlurPx}px`);
    unmountSmall();

    render(<RichText spec={largeSpec} boxWidth={BOX_WIDTH} boxHeight={BOX_HEIGHT} />);
    const largeEl = screen.getByText('LARGE');
    const largeFontPx = largeSpec.size * BOX_HEIGHT;
    const expectedLargeBlurPx = largeSpec.shadow.blur * largeFontPx;
    expect(largeEl.style.textShadow).toContain(`${expectedLargeBlurPx}px`);

    // Doubling size must double the resolved blur px (em-relative invariant).
    expect(expectedLargeBlurPx).toBeCloseTo(expectedSmallBlurPx * 2, 5);
  });

  it('T6620: blur implies a shadow — blur>0 with opacity 0 still draws a shadow', () => {
    // The Overlay rail exposes only a blur slider; a new block defaults to
    // opacity 0. Dragging blur must not be inert: the effective opacity resolves
    // to the shared default (0.6), so a textShadow is emitted.
    const spec = baseSpec({ text: 'BLURSHADOW', size: 0.08, shadow: { blur: 0.1, color: '#000000', opacity: 0 } });
    render(<RichText spec={spec} boxWidth={BOX_WIDTH} boxHeight={BOX_HEIGHT} />);
    const el = screen.getByText('BLURSHADOW');
    expect(el.style.textShadow).not.toBe('none');
    expect(el.style.textShadow).toContain('rgba(0, 0, 0, 0.6)'); // default opacity applied
    const fontPx = spec.size * BOX_HEIGHT;
    expect(el.style.textShadow).toContain(`${spec.shadow.blur * fontPx}px`);
  });

  it('T6620: no shadow when both blur and opacity are 0 (unchanged default)', () => {
    const spec = baseSpec({ text: 'NOSHADOW', shadow: { blur: 0, color: '#000000', opacity: 0 } });
    render(<RichText spec={spec} boxWidth={BOX_WIDTH} boxHeight={BOX_HEIGHT} />);
    expect(screen.getByText('NOSHADOW').style.textShadow).toBe('none');
  });

  it('resolves strokePx from fontPx (em-relative), not from boxHeight directly', () => {
    const smallSpec = baseSpec({
      text: 'SMALLSTROKE',
      size: 0.04,
      stroke: { width: 0.06, color: '#FF0000' },
    });
    const largeSpec = baseSpec({
      text: 'LARGESTROKE',
      size: 0.08,
      stroke: { width: 0.06, color: '#FF0000' },
    });

    const { unmount: unmountSmall } = render(
      <RichText spec={smallSpec} boxWidth={BOX_WIDTH} boxHeight={BOX_HEIGHT} />
    );
    const smallEl = screen.getByText('SMALLSTROKE');
    const smallFontPx = smallSpec.size * BOX_HEIGHT;
    const expectedSmallStrokePx = smallSpec.stroke.width * smallFontPx;
    expect(smallEl.style.webkitTextStroke || smallEl.style.WebkitTextStroke).toContain(
      `${expectedSmallStrokePx}px`
    );
    unmountSmall();

    render(<RichText spec={largeSpec} boxWidth={BOX_WIDTH} boxHeight={BOX_HEIGHT} />);
    const largeEl = screen.getByText('LARGESTROKE');
    const largeFontPx = largeSpec.size * BOX_HEIGHT;
    const expectedLargeStrokePx = largeSpec.stroke.width * largeFontPx;
    expect(largeEl.style.webkitTextStroke || largeEl.style.WebkitTextStroke).toContain(
      `${expectedLargeStrokePx}px`
    );

    expect(expectedLargeStrokePx).toBeCloseTo(expectedSmallStrokePx * 2, 5);
  });
});
