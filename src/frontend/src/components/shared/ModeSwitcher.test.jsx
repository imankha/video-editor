import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModeSwitcher } from './ModeSwitcher';
import { AppStateProvider } from '../../contexts';
import { useToastStore } from './Toast';
import { LEGACY_MULTICLIP_REFRAME_MESSAGE } from '../../utils/reelReEditable';

// T8480: a locked tab tap must explain itself visibly (toast), because the
// native title tooltip is hover-only and unreachable on touch devices.

const renderSwitcher = (props = {}, appState = { selectedProject: null }) =>
  render(
    <AppStateProvider value={appState}>
      <ModeSwitcher
        mode="annotate"
        hasAnnotateVideo
        onModeChange={() => {}}
        {...props}
      />
    </AppStateProvider>
  );

const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title);

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe('ModeSwitcher locked-tab explanations (T8480)', () => {
  it('tapping the locked Focus tab fires an info toast instead of silently ignoring the tap', () => {
    const onModeChange = vi.fn();
    renderSwitcher({ onModeChange });

    fireEvent.click(screen.getByTestId('mode-framing'));

    expect(onModeChange).not.toHaveBeenCalled();
    expect(toastTitles()).toEqual(['Rate a play Highlight, then choose Make Highlight Now.']);
    expect(useToastStore.getState().toasts[0].type).toBe('info');
  });

  it('tapping the locked Overlay tab with a project selected explains the export prerequisite', () => {
    const onModeChange = vi.fn();
    renderSwitcher({ onModeChange, hasProject: true, hasWorkingVideo: false });

    fireEvent.click(screen.getByTestId('mode-overlay'));

    expect(onModeChange).not.toHaveBeenCalled();
    expect(toastTitles()).toEqual(['Generate Highlight to unlock Spotlight.']);
  });

  it('uses action labels on desktop and mobile instead of renaming shared mode nouns', () => {
    renderSwitcher({ hasProject: true, hasWorkingVideo: true });

    expect(screen.getByText('Frame Highlight')).toBeTruthy();
    expect(screen.getByText('Add Spotlight')).toBeTruthy();
  });

  it('explains that a play must be selected before framing can unlock', () => {
    renderSwitcher({ hasSelectedPlay: false });

    fireEvent.click(screen.getByTestId('mode-framing'));

    expect(toastTitles()).toEqual(['Select a Highlight play to frame it.']);
  });

  it('repeat taps dedupe to a single toast instead of stacking', () => {
    renderSwitcher();

    fireEvent.click(screen.getByTestId('mode-framing'));
    fireEvent.click(screen.getByTestId('mode-framing'));

    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('an available Focus tab still switches modes with no toast', () => {
    const onModeChange = vi.fn();
    renderSwitcher({ onModeChange, hasProject: true });

    fireEvent.click(screen.getByTestId('mode-framing'));

    expect(onModeChange).toHaveBeenCalledWith('framing');
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('locked tabs are aria-disabled, not natively disabled (taps must reach onClick)', () => {
    renderSwitcher();

    const focusTab = screen.getByTestId('mode-framing');
    expect(focusTab.disabled).toBe(false);
    expect(focusTab.getAttribute('aria-disabled')).toBe('true');
  });

  it('the globally disabled switcher ignores taps without toasting', () => {
    const onModeChange = vi.fn();
    renderSwitcher({ onModeChange, disabled: true, hasProject: true });

    // The disabled attribute swallows the click in real browsers; fire on the
    // handler path anyway to pin that the guard exists even if it fires.
    fireEvent.click(screen.getByTestId('mode-framing'));

    expect(onModeChange).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

// T11220: the header Focus tab is an AVAILABLE (unlocked) tab for any open
// project, so without a guard it would switch a legacy multi-clip project into
// Focus/Framing — which the single-clip editor can't do (it 400s on re-export and
// burns credits). The header switch must refuse it with the shared clear toast.
describe('T11220: header Focus tab refuses a legacy multi-clip project', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('tapping Focus for a clip_count > 1 project does NOT switch modes and shows the re-frame refusal toast', () => {
    const onModeChange = vi.fn();
    renderSwitcher(
      { onModeChange, mode: 'overlay', hasProject: true, hasWorkingVideo: true },
      { selectedProject: { id: 1, clip_count: 2, working_video_id: 5 } },
    );

    fireEvent.click(screen.getByTestId('mode-framing'));

    expect(onModeChange).not.toHaveBeenCalled();
    expect(toastTitles()).toEqual([LEGACY_MULTICLIP_REFRAME_MESSAGE]);
  });

  it('tapping Focus for a single-clip project (clip_count === 1) still switches, no toast', () => {
    const onModeChange = vi.fn();
    renderSwitcher(
      { onModeChange, mode: 'overlay', hasProject: true, hasWorkingVideo: true },
      { selectedProject: { id: 1, clip_count: 1, working_video_id: 5 } },
    );

    fireEvent.click(screen.getByTestId('mode-framing'));

    expect(onModeChange).toHaveBeenCalledWith('framing');
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
