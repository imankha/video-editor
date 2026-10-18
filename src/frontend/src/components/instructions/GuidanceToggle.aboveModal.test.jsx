import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import GuidanceToggle from './GuidanceToggle';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';

afterEach(() => { cleanup(); useSettingsStore.getState().reset(); });

describe('Guidance switch is always above a modal', () => {
  it('renders the one real switch in a body-level layer above the modal rung, keeping a same-size slot in the header', () => {
    useAuthStore.setState({ isAuthenticated: true });
    const { container } = render(<div className="fixed inset-0 z-50" data-testid="modal"><div data-testid="header-slot"><GuidanceToggle /></div></div>);
    const toggles = screen.getAllByTestId('guidance-toggle');
    expect(toggles).toHaveLength(1);
    const layer = toggles[0].closest('[data-testid="guidance-toggle-layer"]');
    expect(layer.parentElement).toBe(document.body);
    expect(layer.className).toMatch(/\bfixed\b/);
    expect(layer.className).toContain('z-[100]');
    expect(container.contains(layer)).toBe(false);
    // the in-flow slot is invisible (reserves the width) and carries no focusable duplicate
    const slot = screen.getByTestId('header-slot').firstElementChild;
    expect(slot.className).toContain('invisible');
    expect(slot.querySelector('button')).toBeNull();
  });
});
