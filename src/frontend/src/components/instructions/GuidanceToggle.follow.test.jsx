import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import GuidanceToggle from './GuidanceToggle';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';

afterEach(() => { cleanup(); useSettingsStore.getState().reset(); vi.restoreAllMocks(); vi.useRealTimers(); });

// T13460:C1 the fixed switch layer must land exactly over its header slot even when the slot moves
// WITHOUT resizing itself or its parent (a sibling appears/disappears, a banner mounts, fonts load):
// no resize/scroll event fires, so only continuous tracking keeps it off the logo/icons beside it.
describe('GuidanceToggle follows its header slot (T13460)', () => {
  it('re-pins the layer when the slot moves with no resize or scroll event', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    let slotLeft = 100;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const left = this.getAttribute('aria-hidden') === 'true' ? slotLeft : 0;
      return { left, top: 8, right: left + 100, bottom: 52, width: 100, height: 44, x: left, y: 8, toJSON() {} };
    });
    useAuthStore.setState({ isAuthenticated: true });
    render(<GuidanceToggle />);
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(screen.getByTestId('guidance-toggle-layer').style.left).toBe('100px');
    slotLeft = 260;
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(screen.getByTestId('guidance-toggle-layer').style.left).toBe('260px');
  });
});
