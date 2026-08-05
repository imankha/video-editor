// T5205 — the card editor's opt-in extensions to the SHARED TextSpecEditor
// (size presets, colour swatches, hidden text field). T5225's defaults are
// unchanged and covered by TextSpecEditor.test.jsx.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TextSpecEditor } from './TextSpecEditor';
import { Align, FontKey } from '../../constants/textSpec';
import { SIZE_PRESETS, COLOR_SWATCHES } from '../introcards/introCardEditorConstants';

afterEach(cleanup);

function baseSpec(overrides = {}) {
  return {
    text: '', font: FontKey.ANTON, size: 0.06, color: '#FFFFFF', align: Align.CENTER,
    position: { x: 0.5, y: 0.5 }, maxWidth: 0.8,
    shadow: { blur: 0, color: '#000000', opacity: 0 }, stroke: { width: 0, color: '#000000' },
    animation: 'none', ...overrides,
  };
}

describe('TextSpecEditor — T5205 rail extensions', () => {
  it('hideText omits the Text field', () => {
    render(<TextSpecEditor spec={baseSpec()} onChange={() => {}} hideText />);
    expect(screen.queryByText('Text')).toBeNull();
  });

  it('size presets replace the raw range and emit the preset value', () => {
    const onChange = vi.fn();
    render(<TextSpecEditor spec={baseSpec({ size: 0.04 })} onChange={onChange} sizePresets={SIZE_PRESETS} />);
    const xl = SIZE_PRESETS.find((p) => p.key === 'XL');
    fireEvent.click(screen.getByLabelText(`Size ${xl.label}`));
    const next = onChange.mock.calls.at(-1)[0];
    expect(next.size).toBeCloseTo(xl.value, 5);
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
});
