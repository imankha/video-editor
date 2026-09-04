import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineSportSelect, INLINE_SPORT_OTHER, SPORT_OPTION_STYLE } from '../InlineSportSelect';
import { NO_SPORT } from '../../../modes/annotate/constants/tagRegistry';

// T8710: the native <select> popup rendered its light-colored dark-theme text on a
// near-white system background (unreadable). The fix forces a dark native popup via
// `color-scheme: dark` on the <select> plus explicit dark bg / light text on every
// <option>. These tests lock in that styling AND guard the pre-existing behavior.
describe('InlineSportSelect — dropdown contrast (T8710)', () => {
  it('renders the <select> with a dark color-scheme so the native popup is dark', () => {
    render(<InlineSportSelect sport="soccer" onChange={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: /change sport/i });
    // Tailwind arbitrary property -> `color-scheme: dark`.
    expect(select.className).toContain('[color-scheme:dark]');
  });

  it('paints every <option> with the explicit dark bg / light text style', () => {
    render(<InlineSportSelect sport="soccer" onChange={vi.fn()} onPickOther={vi.fn()} />);
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(1);
    for (const opt of options) {
      expect(opt.style.backgroundColor).toBe('rgb(31, 41, 55)'); // #1f2937 gray-800
      expect(opt.style.color).toBe('rgb(249, 250, 251)'); // #f9fafb gray-50
    }
  });

  it('exposes a >= 4.5:1 (WCAG AA) contrast ratio for option text', () => {
    // gray-50 (#f9fafb) on gray-800 (#1f2937): computed straight from the constant so
    // a future tweak that quietly lowers contrast fails here.
    const ratio = contrastRatio(SPORT_OPTION_STYLE.color, SPORT_OPTION_STYLE.backgroundColor);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

describe('InlineSportSelect — behavior preserved', () => {
  it('fires onChange with the picked sport id', () => {
    const onChange = vi.fn();
    render(<InlineSportSelect sport={NO_SPORT} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox', { name: /change sport/i }), {
      target: { value: 'soccer' },
    });
    expect(onChange).toHaveBeenCalledWith('soccer');
  });

  it('routes the "Other..." sentinel to onPickOther, not onChange', () => {
    const onChange = vi.fn();
    const onPickOther = vi.fn();
    render(<InlineSportSelect sport="soccer" onChange={onChange} onPickOther={onPickOther} />);
    fireEvent.change(screen.getByRole('combobox', { name: /change sport/i }), {
      target: { value: INLINE_SPORT_OTHER },
    });
    expect(onPickOther).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps a custom (unsupported) sport selectable', () => {
    render(<InlineSportSelect sport="underwater-hockey" onChange={vi.fn()} />);
    const custom = screen
      .getAllByRole('option')
      .find(o => o.value === 'underwater-hockey');
    expect(custom).toBeTruthy();
    expect(custom.style.backgroundColor).toBe('rgb(31, 41, 55)');
  });
});

// Minimal WCAG 2.x relative-luminance contrast, hex in -> ratio out.
function contrastRatio(hexA, hexB) {
  const lum = (hex) => {
    const [r, g, b] = hex
      .replace('#', '')
      .match(/.{2}/g)
      .map((h) => {
        const c = parseInt(h, 16) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const l1 = lum(hexA);
  const l2 = lum(hexB);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
