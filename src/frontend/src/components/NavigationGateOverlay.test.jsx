import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { NavigationGateOverlay } from './NavigationGateOverlay';
import { useNavigationGateStore } from '../stores/navigationGateStore';
import { useEditorStore, EDITOR_MODES } from '../stores/editorStore';

describe('NavigationGateOverlay', () => {
  beforeEach(() => {
    useNavigationGateStore.setState({ pending: 0 });
    useEditorStore.setState({ editorMode: EDITOR_MODES.ANNOTATE });
  });

  it.each([EDITOR_MODES.FRAMING, EDITOR_MODES.OVERLAY])(
    'releases pointer and keyboard input in %s while progress saves are pending',
    (editorMode) => {
      useNavigationGateStore.setState({ pending: 1 });
      render(<NavigationGateOverlay />);
      expect(screen.getByTestId('navigation-gate-overlay')).toBeTruthy();
      const before = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
      window.dispatchEvent(before);
      expect(before.defaultPrevented).toBe(true);
      act(() => useEditorStore.setState({ editorMode }));
      expect(screen.queryByTestId('navigation-gate-overlay')).toBeNull();
      const after = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
      window.dispatchEvent(after);
      expect(after.defaultPrevented).toBe(false);
      expect(useNavigationGateStore.getState().pending).toBe(1);
    },
  );

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
