// T5205 — the card rail's opt-in extensions to the SHARED TextSpecEditor
// (colour swatches, and hiding the text/size/align controls because a card's
// text comes from title_text/profile and size/align are layout-owned by the
// T5210 geometry contract). T5225's defaults are unchanged and covered by
// TextSpecEditor.test.jsx.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TextSpecEditor } from './TextSpecEditor';
import { Align, FontKey } from '../../constants/textSpec';
import { COLOR_SWATCHES } from '../introcards/introCardEditorConstants';

afterEach(cleanup);

function baseSpec(overrides = {}) {
  return {
    text: '', font: FontKey.ANTON, size: 0.06, color: '#FFFFFF', align: Align.CENTER,
    position: { x: 0.5, y: 0.5 }, maxWidth: 0.8,
    shadow: { blur: 0, color: '#000000', opacity: 0 }, stroke: { width: 0, color: '#000000' },
    animation: 'none', ...overrides,
  };
}

describe('TextSpecEditor — T5205 card-rail extensions', () => {
  it('hideText / hideSize / hideAlign omit those controls (layout is composition-owned)', () => {
    render(<TextSpecEditor spec={baseSpec()} onChange={() => {}} hideText hideSize hideAlign />);
    expect(screen.queryByText('Text')).toBeNull();
    expect(screen.queryByLabelText('Size')).toBeNull();
    expect(screen.queryByLabelText('Align')).toBeNull();
    // Font + colour (the actual card styling) remain.
    expect(screen.getByLabelText(/font/i)).toBeTruthy();
    expect(screen.getByLabelText('Custom color')).toBeTruthy();
  });

  it('colour swatches emit the swatch hex, leaving the rest of the spec intact', () => {
    const onChange = vi.fn();
    render(<TextSpecEditor spec={baseSpec()} onChange={onChange} colorSwatches={COLOR_SWATCHES} />);
    fireEvent.click(screen.getByLabelText(`Color ${COLOR_SWATCHES[2]}`));
    const next = onChange.mock.calls.at(-1)[0];
    expect(next.color.toUpperCase()).toBe(COLOR_SWATCHES[2].toUpperCase());
    expect(next.font).toBe(FontKey.ANTON);
  });

  it('hideFooterNote suppresses the overlay-specific note', () => {
    render(<TextSpecEditor spec={baseSpec()} onChange={() => {}} hideFooterNote />);
    expect(screen.queryByText(/burned into the exported video/i)).toBeNull();
  });

  it('default (T5225) still shows size + align controls', () => {
    render(<TextSpecEditor spec={baseSpec()} onChange={() => {}} />);
    expect(screen.getByLabelText('Size')).toBeTruthy();
    expect(screen.getByLabelText('Align')).toBeTruthy();
  });

  it('default (T5225 overlay host) keeps Shadow/Stroke INLINE — no Effects disclosure', () => {
    // The overlay host passes no collapseEffects, so the expert dials must stay
    // visible exactly as before. Key on the ABSENCE of the "Effects" summary
    // (jsdom keeps <details> children in the DOM regardless of open state, so
    // asserting the input alone can't distinguish inline from collapsed).
    render(<TextSpecEditor spec={baseSpec()} onChange={() => {}} />);
    expect(screen.queryByText('Effects')).toBeNull();
    expect(screen.getByLabelText('Shadow blur')).toBeTruthy();
    expect(screen.getByLabelText('Stroke width')).toBeTruthy();
  });

  it('collapseEffects tucks Shadow/Stroke behind an "Effects" disclosure (card rail opt-in)', () => {
    render(<TextSpecEditor spec={baseSpec()} onChange={() => {}} collapseEffects />);
    // The disclosure summary is present; the controls still exist within it.
    expect(screen.getByText('Effects')).toBeTruthy();
    expect(screen.getByLabelText('Shadow blur')).toBeTruthy();
    expect(screen.getByLabelText('Stroke width')).toBeTruthy();
  });
});
