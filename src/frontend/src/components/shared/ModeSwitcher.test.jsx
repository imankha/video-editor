import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModeSwitcher } from './ModeSwitcher';
import { AppStateProvider } from '../../contexts';
import { useToastStore } from './Toast';
import { ANNOTATE } from '../../config/displayNames';
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
  it('T12130: in Annotate with no highlight, renders no tabs at all', () => {
    const { container } = renderSwitcher();
    expect(screen.queryByTestId('mode-framing')).toBeNull();
    expect(screen.queryByTestId('mode-overlay')).toBeNull();
    expect(screen.queryByTestId('mode-annotate')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('tapping the locked Overlay tab with a project selected explains the export prerequisite', () => {
    const onModeChange = vi.fn();
    renderSwitcher({ onModeChange, hasProject: true, hasWorkingVideo: false });

    fireEvent.click(screen.getByTestId('mode-overlay'));

    expect(onModeChange).not.toHaveBeenCalled();
    expect(toastTitles()).toEqual(['Generate your highlight to add a spotlight.']);
  });

  it('uses action labels on desktop and mobile instead of renaming shared mode nouns', () => {
    renderSwitcher({ hasProject: true, hasWorkingVideo: true });

    expect(screen.getByText('Mark Plays')).toBeTruthy();
    expect(screen.getByText('Frame')).toBeTruthy();
    expect(screen.getByText('Spotlight')).toBeTruthy();
  });

  it('T12130: the locked Spotlight reason is visible text, not only a title or toast', () => {
    renderSwitcher({ hasProject: true, hasWorkingVideo: false });
    expect(screen.getByText('Generate your highlight to add a spotlight.')).toBeTruthy();
  });

  it('T12130: no caption once Spotlight is unlocked', () => {
    renderSwitcher({ hasProject: true, hasWorkingVideo: true });
    expect(screen.queryByText('Generate your highlight to add a spotlight.')).toBeNull();
  });

  it('repeat taps dedupe to a single toast instead of stacking', () => {
    renderSwitcher({ hasProject: true, hasWorkingVideo: false });

    fireEvent.click(screen.getByTestId('mode-overlay'));
    fireEvent.click(screen.getByTestId('mode-overlay'));

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
    renderSwitcher({ hasProject: true, hasWorkingVideo: false });

    const focusTab = screen.getByTestId('mode-overlay');
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

// T11740: the inline variant (compact header, row 2) stacks the icon over the
// label in equal cells below `md`, then collapses to today's single-row tab at
// `md`+. Layout classes only — the lock/toast/data-testid contract above is
// untouched.
describe('T11740: inline variant responsive layout', () => {
  it('stacks each tab (flex-col) below md and returns to a row at md+', () => {
    renderSwitcher({ hasProject: true, hasWorkingVideo: true, inline: true });

    const tab = screen.getByTestId('mode-framing');
    expect(tab.className).toContain('flex-col');
    expect(tab.className).toContain('md:flex-row');
    expect(tab.className).toContain('h-12');
    expect(tab.className).toContain('md:h-11');
  });

  it('shrinks the label to text-[11px] below md and restores text-sm at md+', () => {
    renderSwitcher({ hasProject: true, hasWorkingVideo: true, inline: true });

    const label = screen.getByText('Frame');
    expect(label.className).toContain('text-[11px]');
    expect(label.className).toContain('md:text-sm');
  });

  it('keeps the non-inline (desktop) tab on a single row (no flex-col)', () => {
    renderSwitcher({ hasProject: true, hasWorkingVideo: true });

    const tab = screen.getByTestId('mode-framing');
    expect(tab.className).not.toContain('flex-col');
    expect(tab.className).toContain('h-11');
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

describe('ModeSwitcher while the game is loading (T11830)', () => {
  it('a locked tab shows a spinner (aria-busy) instead of a lock, and a tap says Loading your plays...', () => {
    const { container } = renderSwitcher({ hasProject: true, hasWorkingVideo: false, isLoadingGameData: true });
    const spotlight = screen.getByTestId('mode-overlay');
    expect(spotlight.getAttribute('aria-busy')).toBe('true');
    expect(spotlight.querySelector('.animate-spin')).toBeTruthy();
    expect(container.querySelector('.lucide-lock')).toBeNull();

    fireEvent.click(spotlight);
    expect(toastTitles()).toEqual(['Loading your plays...']);
  });

  it('keeps the lock look once loading is over', () => {
    const { container } = renderSwitcher({ hasProject: true, hasWorkingVideo: false, isLoadingGameData: false });
    expect(screen.getByTestId('mode-overlay').getAttribute('aria-busy')).toBeNull();
    expect(container.querySelector('.lucide-lock')).toBeTruthy();
  });
});

describe('T12130: one Make highlight entry string', () => {
  it('every entry point shares the same copy', () => {
    expect(ANNOTATE.FRAME_THIS_CLIP).toBe('Make highlight');
    expect(ANNOTATE.MAKE_A_HIGHLIGHT).toBe('Make highlight');
    expect(ANNOTATE.MAKE_HIGHLIGHT_NOW).toBe('Make highlight');
  });
});
