import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { FocusCompletionRecovery } from './FocusCompletionRecovery';
import { useFocusCompletionStore } from '../stores/focusCompletionStore';
import { useEditorStore, EDITOR_MODES } from '../stores/editorStore';
import { useProjectsStore } from '../stores/projectsStore';

// T9285 review fix — this component previously had NO dedicated test at all.
// T9790 removed Option C's auto-navigate: the card is now ALWAYS passive (it
// never auto-invokes View, even idle on home), so a cold reload onto the
// library is never hijacked into an old Focus completion screen. Covers:
// (1) the card stays passive in every editor state, including idle-on-home
// (the state Option C used to auto-open on); (2) View/Dismiss wiring;
// (3) view() never lets a rejection escape; (4) the openMode staleness-scoping
// guard lives HERE (always mounted), not inside FocusScreen (which can only be
// mounted while editorMode === openMode, so a guard there could never observe
// a mismatch).

const { resumeFocusCompletionMock, apiFetchMock, loadProjectMock, toastErrorMock } = vi.hoisted(() => ({
  resumeFocusCompletionMock: vi.fn(async () => ({ opened: true, navigated: true })),
  apiFetchMock: vi.fn(async () => ({ ok: true, json: async () => ({ acknowledged: 1 }) })),
  loadProjectMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('../utils/resumeFocusCompletion', () => ({
  resumeFocusCompletion: (...args) => resumeFocusCompletionMock(...args),
}));
vi.mock('../utils/apiFetch', () => ({ default: (...args) => apiFetchMock(...args) }));
vi.mock('../hooks/useProjectLoader', () => ({
  useProjectLoader: () => ({ loadProject: loadProjectMock }),
}));
vi.mock('./shared', () => ({
  toast: { error: (...args) => toastErrorMock(...args), success: vi.fn(), info: vi.fn() },
}));

function noteRecovered(jobId, projectId, projectName = 'Reel') {
  act(() => {
    useFocusCompletionStore.getState().noteRecovered({ jobId, projectId, projectName });
  });
}

describe('FocusCompletionRecovery (T9285)', () => {
  beforeEach(() => {
    resumeFocusCompletionMock.mockReset();
    resumeFocusCompletionMock.mockResolvedValue({ opened: true, navigated: true });
    apiFetchMock.mockClear();
    toastErrorMock.mockClear();
    useFocusCompletionStore.setState({ recovered: null, preview: null, resuming: false });
    useEditorStore.setState({ editorMode: EDITOR_MODES.PROJECT_MANAGER });
    useProjectsStore.setState({ selectedProjectId: null, selectedProject: null });
  });

  it('renders nothing when there is no recovered completion', () => {
    render(<FocusCompletionRecovery />);
    expect(screen.queryByTestId('focus-completion-recovery')).toBeNull();
  });

  it('T9790: does NOT auto-invoke even when idle on home with nothing selected — shows the passive card instead', async () => {
    // This is exactly the state Option C used to auto-open on (and the state a
    // genuine cold reload onto the library lands in). It must now stay passive.
    render(<FocusCompletionRecovery />);
    noteRecovered('job-1', 5);

    await screen.findByTestId('focus-completion-recovery');
    await new Promise((r) => setTimeout(r, 20));
    expect(resumeFocusCompletionMock).not.toHaveBeenCalled();
  });

  it('does not auto-invoke when a project is already selected — shows the passive card', async () => {
    useProjectsStore.setState({ selectedProjectId: 99 });
    render(<FocusCompletionRecovery />);
    noteRecovered('job-2', 5);

    await screen.findByTestId('focus-completion-recovery');
    expect(resumeFocusCompletionMock).not.toHaveBeenCalled();
  });

  it('does not auto-invoke when the user is mid-annotate/editing (editorMode !== PROJECT_MANAGER)', async () => {
    useEditorStore.setState({ editorMode: EDITOR_MODES.ANNOTATE });
    render(<FocusCompletionRecovery />);
    noteRecovered('job-2b', 5);

    await screen.findByTestId('focus-completion-recovery');
    expect(resumeFocusCompletionMock).not.toHaveBeenCalled();
  });

  it('T9790: never auto-opens when the user navigates home on their own after discovery elsewhere', async () => {
    useProjectsStore.setState({ selectedProjectId: 99 });
    render(<FocusCompletionRecovery />);
    noteRecovered('job-3', 5);
    await screen.findByTestId('focus-completion-recovery');
    expect(resumeFocusCompletionMock).not.toHaveBeenCalled();

    // The user's OWN later navigation home. With Option C removed there is no
    // auto-open in any state; the card just stays passive.
    act(() => {
      useProjectsStore.setState({ selectedProjectId: null });
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(resumeFocusCompletionMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('focus-completion-recovery')).toBeTruthy();
  });

  it('T9790: stays passive across an unmount+remount of the component (App.jsx mounts it in TWO structurally different trees)', async () => {
    const { unmount } = render(<FocusCompletionRecovery />); // idle on home from beforeEach
    noteRecovered('job-remount', 5);
    await screen.findByTestId('focus-completion-recovery');

    // Simulate the home<->editor navigation: this instance is torn down and a
    // fresh one mounts in its place while the user sits idle on home. With
    // Option C gone there is no auto-open decision to re-arm — the card just
    // renders passively again.
    unmount();
    render(<FocusCompletionRecovery />);
    await new Promise((r) => setTimeout(r, 20));
    expect(resumeFocusCompletionMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('focus-completion-recovery')).toBeTruthy();
  });

  it('multiple jobs discovered over time each show the passive card, never auto-open', async () => {
    render(<FocusCompletionRecovery />);
    noteRecovered('job-4a', 5);
    await screen.findByTestId('focus-completion-recovery');

    noteRecovered('job-4b', 6);
    await new Promise((r) => setTimeout(r, 20));
    expect(resumeFocusCompletionMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('focus-completion-recovery')).toBeTruthy();
  });

  it('View click invokes resumeFocusCompletion and clears the card afterward', async () => {
    useProjectsStore.setState({ selectedProjectId: 99 }); // not idle -> passive card
    render(<FocusCompletionRecovery />);
    noteRecovered('job-5', 5);
    await screen.findByTestId('focus-completion-recovery');

    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    await waitFor(() => expect(resumeFocusCompletionMock).toHaveBeenCalledTimes(1));
    expect(resumeFocusCompletionMock.mock.calls[0][0]).toEqual({ jobId: 'job-5', projectId: 5 });
    await waitFor(() => expect(screen.queryByTestId('focus-completion-recovery')).toBeNull());
  });

  it('REVIEW FINDING #5: a rejecting resumeFocusCompletion never escapes view() as an unhandled rejection, and re-enables the buttons for a retry', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    resumeFocusCompletionMock.mockRejectedValue(new Error('unexpected wiring bug'));
    useProjectsStore.setState({ selectedProjectId: 99 });
    render(<FocusCompletionRecovery />);
    noteRecovered('job-6', 5);
    await screen.findByTestId('focus-completion-recovery');

    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    // Follow-up review fix: a FAILED resume must NOT delete the user's only
    // affordance — the card stays up (job stays unacknowledged either way)
    // so View can be retried, instead of vanishing until the next reload.
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(screen.getByTestId('focus-completion-recovery')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View' }).disabled).toBe(false);
  });

  it('a resolved-but-unsuccessful resume ({opened: false}, e.g. no preview URL) also leaves the card up for a retry', async () => {
    resumeFocusCompletionMock.mockResolvedValue({ opened: false, navigated: false });
    useProjectsStore.setState({ selectedProjectId: 99 });
    render(<FocusCompletionRecovery />);
    noteRecovered('job-6b', 5);
    await screen.findByTestId('focus-completion-recovery');

    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    await waitFor(() => expect(resumeFocusCompletionMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('focus-completion-recovery')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View' }).disabled).toBe(false);
  });

  it('REVIEW FINDING #7: Dismiss acknowledges the job and clears the card WITHOUT navigating', async () => {
    useProjectsStore.setState({ selectedProjectId: 99 });
    render(<FocusCompletionRecovery />);
    noteRecovered('job-7', 5);
    await screen.findByTestId('focus-completion-recovery');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(screen.queryByTestId('focus-completion-recovery')).toBeNull());
    expect(apiFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/exports/acknowledge'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify(['job-7']) }),
    );
    expect(resumeFocusCompletionMock).not.toHaveBeenCalled();
  });

  it('optional polish: a double-tap on Dismiss only acknowledges once (in-flight guard)', async () => {
    useProjectsStore.setState({ selectedProjectId: 99 });
    render(<FocusCompletionRecovery />);
    noteRecovered('job-7b', 5);
    await screen.findByTestId('focus-completion-recovery');

    const dismissBtn = screen.getByRole('button', { name: 'Dismiss' });
    fireEvent.click(dismissBtn);
    fireEvent.click(dismissBtn); // same tick, before the card unmounts

    await waitFor(() => expect(screen.queryByTestId('focus-completion-recovery')).toBeNull());
    const ackCalls = apiFetchMock.mock.calls.filter(([url]) => String(url).includes('/api/exports/acknowledge'));
    expect(ackCalls).toHaveLength(1);
  });

  it('REVIEW FINDING #1/#2: clears a stale `preview` payload once editorMode moves off its openMode, even though this component never renders `preview` itself', async () => {
    useEditorStore.setState({ editorMode: EDITOR_MODES.FRAMING }); // matches openMode below
    render(<FocusCompletionRecovery />);
    act(() => {
      useFocusCompletionStore.getState().openPreview({ projectId: 5, previewUrl: 'blob://x', openMode: EDITOR_MODES.FRAMING });
    });
    expect(useFocusCompletionStore.getState().preview).not.toBeNull();

    // The mobile back button (editorStore.setEditorModeFromPopState) moves
    // editorMode away without ever calling closePreview itself — this
    // always-mounted component is what must notice and clear it.
    act(() => {
      useEditorStore.setState({ editorMode: EDITOR_MODES.PROJECT_MANAGER });
    });

    await waitFor(() => expect(useFocusCompletionStore.getState().preview).toBeNull());
  });

  it('does NOT clear `preview` while editorMode still matches its openMode', async () => {
    useEditorStore.setState({ editorMode: EDITOR_MODES.FRAMING });
    render(<FocusCompletionRecovery />);
    act(() => {
      useFocusCompletionStore.getState().openPreview({ projectId: 5, previewUrl: 'blob://x', openMode: EDITOR_MODES.FRAMING });
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(useFocusCompletionStore.getState().preview).not.toBeNull();
  });
});
