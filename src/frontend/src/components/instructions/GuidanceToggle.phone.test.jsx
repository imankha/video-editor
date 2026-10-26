import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import GuidanceToggle from './GuidanceToggle';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';

afterEach(() => { cleanup(); useSettingsStore.getState().reset(); });

// T12530:C1 jsdom has no layout, so assert the responsive contract: Tailwind's `hidden`
// (display:none) must not apply to the label at base width, and the On/Off word, which
// duplicates the switch track, is what gives way on phones.
describe('GuidanceToggle on phones (T12530)', () => {
  it('always shows its name, never a bare "On"', () => {
    useAuthStore.setState({ isAuthenticated: true });
    render(<GuidanceToggle />);
    const label = within(screen.getByRole('switch')).getByText('Guidance');
    expect(label.className.split(/\s+/)).not.toContain('hidden');
  });

  it('drops the redundant On/Off word below sm so the header fits 320', () => {
    useAuthStore.setState({ isAuthenticated: true });
    useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
    render(<GuidanceToggle />);
    const state = within(screen.getByRole('switch')).getByText('On');
    expect(state.className.split(/\s+/)).toContain('hidden');
    expect(state.className).toMatch(/sm:inline/);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });
});

describe('T12720: whole toggle reads as one button', () => {
  it('has a pointer cursor and no selectable text', async () => {
    const { render, screen } = await import('@testing-library/react');
    const { default: GuidanceToggle } = await import('./GuidanceToggle');
    const { useAuthStore } = await import('../../stores/authStore');
    useAuthStore.setState({ isAuthenticated: true });
    render(<GuidanceToggle />);
    const cls = screen.getByTestId('guidance-toggle').className;
    expect(cls).toContain('cursor-pointer');
    expect(cls).toContain('select-none');
  });
});
