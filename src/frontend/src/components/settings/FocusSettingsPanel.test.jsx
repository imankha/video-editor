import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import FocusSettingsPanel from './FocusSettingsPanel';
import { EDITOR_PANELS } from '../../config/displayNames';

// T12180: Focus settings in plain labels. T17870: 'Fix a tilted camera' shows
// directly on desktop (no 'More options' disclosure), and the dim setting is gone.

afterEach(cleanup);

const props = {
  globalAspectRatio: '9:16',
  onAspectRatioChange: vi.fn(),
  includeAudio: true,
  onIncludeAudioChange: vi.fn(),
  straightenVisible: false,
  onToggleStraighten: vi.fn(),
};

describe('FocusSettingsPanel (T12180, T17870)', () => {
  it('T17870:C1 shows Fix a tilted camera without a click and has no More options control', () => {
    render(<FocusSettingsPanel {...props} />);
    expect(screen.getByText('Fix a tilted camera')).toBeTruthy();
    expect(screen.getByText('Drag along a straight line on the field to level it.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fix a tilted camera' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /more options/i })).toBeNull();
    expect(screen.queryByText(/more options/i)).toBeNull();
  });

  it('T17870:C3 has no dim row and no dim copy', () => {
    const { container } = render(<FocusSettingsPanel {...props} />);
    expect(container.textContent).not.toMatch(/dim outside|darken/i);
    expect(Object.keys(EDITOR_PANELS).filter((k) => /^DARKEN|^MORE_OPT/.test(k))).toEqual([]);
  });

  it('never shows the retired jargon headings', () => {
    const { container } = render(<FocusSettingsPanel {...props} />);
    for (const word of ['Advanced editing', 'This highlight', 'View only', 'Straighten']) {
      expect(container.textContent).not.toContain(word);
    }
  });

  it('T17870:C2 still drives the straighten handler and shows its state', () => {
    const onToggleStraighten = vi.fn();
    const { rerender } = render(<FocusSettingsPanel {...props} onToggleStraighten={onToggleStraighten} />);
    const button = screen.getByRole('button', { name: 'Fix a tilted camera' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(onToggleStraighten).toHaveBeenCalledTimes(1);
    rerender(<FocusSettingsPanel {...props} straightenVisible onToggleStraighten={onToggleStraighten} />);
    expect(screen.getByRole('button', { name: 'Fix a tilted camera' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('T17870:C4 on mobile (desktopOnly false) shows Shape and Include audio only, as before', () => {
    render(<FocusSettingsPanel {...props} desktopOnly={false} />);
    expect(screen.getByText('Shape')).toBeTruthy();
    expect(screen.getByText('Include audio')).toBeTruthy();
    expect(screen.queryByText('Fix a tilted camera')).toBeNull();
    expect(screen.queryByRole('button', { name: /more options/i })).toBeNull();
  });
});
