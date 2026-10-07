import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { NavigationGateOverlay } from './NavigationGateOverlay';
import { useNavigationGateStore } from '../stores/navigationGateStore';

describe('NavigationGateOverlay', () => {
  beforeEach(() => useNavigationGateStore.setState({ pending: 0 }));

  it('renders nothing until writes are tracked, then blocks until they settle', async () => {
    render(<NavigationGateOverlay />);
    expect(screen.queryByTestId('navigation-gate-overlay')).toBeNull();
    let resolve;
    const writes = new Promise((r) => { resolve = r; });
    act(() => { useNavigationGateStore.getState().track(writes); });
    expect(screen.getByTestId('navigation-gate-overlay')).toBeTruthy();
    await act(async () => { resolve(); await writes; });
    expect(screen.queryByTestId('navigation-gate-overlay')).toBeNull();
  });
});
