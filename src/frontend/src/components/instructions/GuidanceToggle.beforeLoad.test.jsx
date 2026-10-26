import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import GuidanceToggle from './GuidanceToggle';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore, useGuidanceSettings } from '../../stores/settingsStore';

afterEach(() => { cleanup(); useSettingsStore.getState().reset(); vi.restoreAllMocks(); });

function Probe() {
  const { coachEnabled } = useGuidanceSettings();
  return <span data-testid="probe">{String(coachEnabled)}</span>;
}

// T13420:C1/C2 before settings load the switch must not read On (the DEFAULT) and must not be
// tappable: a tap there flips the default and saves the opposite of what the user had saved.
describe('Guidance switch before settings load (T13420)', () => {
  it('C1: reads Off and the coach flag is false until settings arrive, then follows the saved value', async () => {
    useAuthStore.setState({ isAuthenticated: true });
    render(<><GuidanceToggle /><Probe /></>);
    expect(screen.getByTestId('guidance-toggle').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('probe').textContent).toBe('false');
    await act(async () => { useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } }); });
    expect(screen.getByTestId('guidance-toggle').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('probe').textContent).toBe('true');
  });

  it('C2: the switch is disabled and a tap saves nothing before settings load', async () => {
    useAuthStore.setState({ isAuthenticated: true });
    const save = vi.fn().mockResolvedValue({});
    useSettingsStore.setState({ saveSettings: save });
    render(<GuidanceToggle />);
    const sw = screen.getByTestId('guidance-toggle');
    expect(sw.disabled).toBe(true);
    await act(async () => { sw.click(); });
    expect(save).not.toHaveBeenCalled();
  });

  it('C2: enabled once settings have loaded', async () => {
    useAuthStore.setState({ isAuthenticated: true });
    useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: false } });
    render(<GuidanceToggle />);
    expect(screen.getByTestId('guidance-toggle').disabled).toBe(false);
  });
});
