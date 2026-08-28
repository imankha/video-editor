// T5225 -- Stage 3 (test-first). `TextSpecEditor.jsx` does not exist yet.
//
// Design: docs/plans/tasks/T5225-design.md §4.1. Pure presentational, store-free,
// API-free (same posture as RichText, T5180 -- see RichText.test.jsx for contrast).
// Contract:
//   <TextSpecEditor spec={spec} onChange={(nextSpec) => …} fonts={FONT_CATALOGUE} />
// Editing ANY field must call onChange with a COMPLETE, valid TextSpec (never a
// delta) -- the host owns persistence; this component must not call fetch/axios
// or reach into any store.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TextSpecEditor } from './TextSpecEditor';
import { Align, FontKey } from '../../constants/textSpec';

function baseSpec(overrides = {}) {
  return {
    text: 'GOAL',
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

const FONT_CATALOGUE = [FontKey.ANTON, FontKey.OSWALD, FontKey.GRADUATE, FontKey.PLAYFAIR];

function isValidTextSpec(spec) {
  return (
    typeof spec === 'object' && spec !== null &&
    typeof spec.text === 'string' &&
    typeof spec.font === 'string' &&
    typeof spec.size === 'number' &&
    typeof spec.color === 'string' &&
    typeof spec.align === 'string' &&
    typeof spec.position === 'object' &&
    typeof spec.position.x === 'number' &&
    typeof spec.position.y === 'number' &&
    typeof spec.maxWidth === 'number' &&
    typeof spec.shadow === 'object' &&
    typeof spec.stroke === 'object'
  );
}

let fetchSpy;
beforeEach(() => {
  fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => {
    throw new Error('TextSpecEditor must never call fetch -- it is store/API-free');
  });
});
afterEach(() => {
  fetchSpy.mockRestore();
  cleanup();
});

describe('TextSpecEditor - pure presentational contract (T5225 design §4.1)', () => {
  it('renders the current spec text in an editable control', () => {
    render(<TextSpecEditor spec={baseSpec()} onChange={() => {}} fonts={FONT_CATALOGUE} />);
    expect(screen.getByDisplayValue('GOAL')).toBeTruthy();
  });

  it('editing the text field calls onChange with a COMPLETE valid TextSpec (not a delta)', () => {
    const onChange = vi.fn();
    render(<TextSpecEditor spec={baseSpec()} onChange={onChange} fonts={FONT_CATALOGUE} />);

    const textInput = screen.getByDisplayValue('GOAL');
    fireEvent.change(textInput, { target: { value: 'CHAMPIONS' } });

    expect(onChange).toHaveBeenCalled();
    const nextSpec = onChange.mock.calls.at(-1)[0];
    expect(isValidTextSpec(nextSpec)).toBe(true);
    expect(nextSpec.text).toBe('CHAMPIONS');
    // Unrelated fields carried through unchanged -- a whole spec, not a partial patch.
    expect(nextSpec.font).toBe(baseSpec().font);
    expect(nextSpec.color).toBe(baseSpec().color);
    expect(nextSpec.position).toEqual(baseSpec().position);
  });

  it('changing the font picker calls onChange with the new font and the rest of the spec intact', () => {
    const onChange = vi.fn();
    render(<TextSpecEditor spec={baseSpec()} onChange={onChange} fonts={FONT_CATALOGUE} />);

    const fontSelect = screen.getByLabelText(/font/i);
    fireEvent.change(fontSelect, { target: { value: FontKey.PLAYFAIR } });

    const nextSpec = onChange.mock.calls.at(-1)[0];
    expect(isValidTextSpec(nextSpec)).toBe(true);
    expect(nextSpec.font).toBe(FontKey.PLAYFAIR);
    expect(nextSpec.text).toBe(baseSpec().text);
  });

  // T6500: the picker shows ONLY the curated `fonts` set, so the split catalogue
  // (overlay set vs intro-card set) is honoured per host — a face absent from the
  // passed list must not appear as an option.
  it('renders exactly the faces in the `fonts` prop, with their catalogue labels', () => {
    const overlaySet = [FontKey.INTER, FontKey.ARCHIVOBLACK, FontKey.OSWALD];
    render(<TextSpecEditor spec={baseSpec()} onChange={() => {}} fonts={overlaySet} />);

    const options = Array.from(screen.getByLabelText(/font/i).querySelectorAll('option'));
    expect(options.map((o) => o.value)).toEqual(overlaySet);
    // New faces surface human labels, not raw keys.
    expect(options.map((o) => o.textContent)).toEqual(['Inter', 'Archivo Black', 'Oswald']);
    // An intro-card-only face is not offered here.
    expect(options.map((o) => o.value)).not.toContain(FontKey.GRADUATE);
  });

  it('changing the color control calls onChange with the new color, spec otherwise intact', () => {
    const onChange = vi.fn();
    render(<TextSpecEditor spec={baseSpec()} onChange={onChange} fonts={FONT_CATALOGUE} />);

    // The colour control is now quick-pick swatches PLUS a custom picker, so
    // /color/i is ambiguous; target the picker explicitly.
    const colorInput = screen.getByLabelText('Custom color');
    fireEvent.change(colorInput, { target: { value: '#00FF00' } });

    const nextSpec = onChange.mock.calls.at(-1)[0];
    expect(isValidTextSpec(nextSpec)).toBe(true);
    expect(nextSpec.color.toUpperCase()).toBe('#00FF00');
  });

  it('changing alignment calls onChange with a full spec carrying the new align value', () => {
    const onChange = vi.fn();
    render(<TextSpecEditor spec={baseSpec()} onChange={onChange} fonts={FONT_CATALOGUE} />);

    const alignControl = screen.getByLabelText(/align/i);
    fireEvent.change(alignControl, { target: { value: Align.CENTER } });

    const nextSpec = onChange.mock.calls.at(-1)[0];
    expect(isValidTextSpec(nextSpec)).toBe(true);
    expect(nextSpec.align).toBe(Align.CENTER);
  });

  it('changing size calls onChange with the numeric size updated and the rest of the spec intact', () => {
    const onChange = vi.fn();
    render(<TextSpecEditor spec={baseSpec()} onChange={onChange} fonts={FONT_CATALOGUE} />);

    const sizeControl = screen.getByLabelText(/size/i);
    fireEvent.change(sizeControl, { target: { value: '0.12' } });

    const nextSpec = onChange.mock.calls.at(-1)[0];
    expect(isValidTextSpec(nextSpec)).toBe(true);
    expect(nextSpec.size).toBeCloseTo(0.12, 5);
  });

  it('never calls fetch/axios as a side effect of rendering or editing (store/API-free)', () => {
    const onChange = vi.fn();
    render(<TextSpecEditor spec={baseSpec()} onChange={onChange} fonts={FONT_CATALOGUE} />);
    const textInput = screen.getByDisplayValue('GOAL');
    fireEvent.change(textInput, { target: { value: 'NO NETWORK' } });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
