import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import FocusSettingsPanel from './FocusSettingsPanel';

// T17230: Settings holds the one lasting shape control, labeled "Shape", and a switch
// with positions placed asks first (the same confirm the first-run chooser used).

afterEach(cleanup);

const base = {
  globalAspectRatio: '9:16',
  includeAudio: true,
  onIncludeAudioChange: vi.fn(),
  straightenVisible: false,
  onToggleStraighten: vi.fn(),
  dimOpacity: 0.2,
  onToggleDim: vi.fn(),
};

const landscapeButton = () => within(screen.getByRole('group', { name: /shape/i }))
  .getByRole('button', { name: /landscape/i });

describe('T17230 FocusSettingsPanel: one Shape control', () => {
  it('labels the row "Shape" with "Portrait (9:16)" and never says "Aspect ratio"', () => {
    const { container } = render(<FocusSettingsPanel {...base} onAspectRatioChange={vi.fn()} />);
    expect(screen.getByText('Shape')).toBeTruthy();
    expect(screen.getByText('Portrait (9:16)')).toBeTruthy();
    expect(container.textContent).not.toMatch(/aspect ratio/i);
  });

  it('no positions yet: switching shape applies at once', () => {
    const onAspectRatioChange = vi.fn();
    render(<FocusSettingsPanel {...base} hasPositions={false} onAspectRatioChange={onAspectRatioChange} />);
    fireEvent.click(landscapeButton());
    expect(onAspectRatioChange).toHaveBeenCalledWith('16:9');
    expect(screen.queryByTestId('focus-shape-switch-confirm')).toBeNull();
  });

  it('positions exist: switching shape asks first, Switch applies it', () => {
    const onAspectRatioChange = vi.fn();
    render(<FocusSettingsPanel {...base} hasPositions onAspectRatioChange={onAspectRatioChange} />);
    fireEvent.click(landscapeButton());
    expect(onAspectRatioChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('focus-shape-switch-confirm')).toBeTruthy();
    fireEvent.click(screen.getByTestId('focus-shape-switch-confirm-button'));
    expect(onAspectRatioChange).toHaveBeenCalledWith('16:9');
    expect(screen.queryByTestId('focus-shape-switch-confirm')).toBeNull();
  });

  it('positions exist: Keep dismisses without changing the shape', () => {
    const onAspectRatioChange = vi.fn();
    render(<FocusSettingsPanel {...base} hasPositions onAspectRatioChange={onAspectRatioChange} />);
    fireEvent.click(landscapeButton());
    fireEvent.click(screen.getByTestId('focus-shape-switch-keep'));
    expect(onAspectRatioChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('focus-shape-switch-confirm')).toBeNull();
  });
});
