import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import GuidanceToggle from './GuidanceToggle';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';

afterEach(() => { cleanup(); document.body.innerHTML = ''; useSettingsStore.getState().reset(); vi.useRealTimers(); });

// T13700:C3 (bug 25): jsdom has no layout, so assert the sizing contract. At 390 the Frame header
// row left the switch (113px) touching the crop-status badge; phones get tighter padding, gap and
// track so it is ~10px narrower, while sm+ keeps its spacing.
describe('GuidanceToggle phone width (T13700:C3)', () => {
  it('uses tight padding/gap below sm and the roomy ones from sm', () => {
    useAuthStore.setState({ isAuthenticated: true });
    render(<GuidanceToggle />);
    const cls = screen.getByTestId('guidance-toggle').className.split(/\s+/);
    expect(cls).toContain('px-1.5');
    expect(cls).toContain('gap-1');
    expect(cls).toContain('sm:px-3');
    expect(cls).toContain('sm:gap-2');
    expect(cls).not.toContain('px-2');
  });
});

// T13700:C1 (bug 20): the landscape cockpit is a full-bleed surface that covers the header, so the
// header's Guidance slot is not a visible place. The body-level layer must not paint over it.
describe('GuidanceToggle under the landscape cockpit (T13700:C1)', () => {
  it('hides its layer while an element marked data-covers-header is mounted, and returns after', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    useAuthStore.setState({ isAuthenticated: true });
    render(<GuidanceToggle />);
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(screen.getByTestId('guidance-toggle-layer').style.visibility).not.toBe('hidden');
    const cover = document.createElement('div');
    cover.setAttribute('data-covers-header', '');
    document.body.appendChild(cover);
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(screen.getByTestId('guidance-toggle-layer').style.visibility).toBe('hidden');
    cover.remove();
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(screen.getByTestId('guidance-toggle-layer').style.visibility).not.toBe('hidden');
  });
});
