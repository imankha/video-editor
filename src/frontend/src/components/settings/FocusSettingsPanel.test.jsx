import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import FocusSettingsPanel from './FocusSettingsPanel';

// T12180: Focus settings in plain labels. One collapsed 'More options' disclosure
// holds 'Fix a tilted camera' and 'Darken outside the box'.

afterEach(cleanup);

const props = {
  globalAspectRatio: '9:16',
  onAspectRatioChange: vi.fn(),
  includeAudio: true,
  onIncludeAudioChange: vi.fn(),
  straightenVisible: false,
  onToggleStraighten: vi.fn(),
  dimOpacity: 0.5,
  onToggleDim: vi.fn(),
};

describe('FocusSettingsPanel (T12180)', () => {
  it('collapses the extras behind a More options disclosure by default', () => {
    render(<FocusSettingsPanel {...props} />);
    const toggle = screen.getByRole('button', { name: /more options/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Fix a tilted camera')).toBeNull();
    expect(screen.queryByText('Darken outside the box')).toBeNull();
  });

  it('opens to plain-language rows with the agreed values', () => {
    render(<FocusSettingsPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));
    expect(screen.getByText('Fix a tilted camera')).toBeTruthy();
    expect(screen.getByText('Drag along a straight line on the field to level it.')).toBeTruthy();
    expect(screen.getByText('Darken outside the box')).toBeTruthy();
    expect(screen.getByText('Editing view only. Your highlight is not changed.')).toBeTruthy();
  });

  it('never shows the retired jargon headings', () => {
    const { container } = render(<FocusSettingsPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));
    for (const word of ['Advanced editing', 'This highlight', 'View only', 'Straighten', 'Dim']) {
      expect(container.textContent).not.toContain(word);
    }
  });

  it('still drives the straighten and darken handlers', () => {
    const onToggleStraighten = vi.fn();
    const onToggleDim = vi.fn();
    render(<FocusSettingsPanel {...props} onToggleStraighten={onToggleStraighten} onToggleDim={onToggleDim} />);
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Fix a tilted camera' }));
    fireEvent.click(screen.getByRole('button', { name: 'Darken outside the box' }));
    expect(onToggleStraighten).toHaveBeenCalledTimes(1);
    expect(onToggleDim).toHaveBeenCalledTimes(1);
  });

  it('drops the whole disclosure on mobile (desktopOnly false)', () => {
    render(<FocusSettingsPanel {...props} desktopOnly={false} />);
    expect(screen.queryByRole('button', { name: /more options/i })).toBeNull();
  });
});
