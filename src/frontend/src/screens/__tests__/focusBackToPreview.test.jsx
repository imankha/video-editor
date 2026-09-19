import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { useState, useCallback } from 'react';
import { EDITOR_MODES } from '../../stores';
import { FOCUS_PREVIEW } from '../../config/displayNames';
import { deriveFramingCtaState } from '../../utils/framingCtaState';

// T10650: FocusScreen cannot be mounted in isolation (dozens of stores/hooks/
// contexts), so — following the established focusPublishExit.test.jsx pattern —
// this harness reproduces handleBackToPreview VERBATIM with injectable spies and
// asserts the WIRING CONTRACT: which URL resolver, toast, and openPreview each
// gesture fires, the spinner-while-resolving state, and the re-entrancy guard.
function BackToPreviewHarness({ deps, projectId = 42 }) {
  const { resolveWorkingVideoPreviewUrl, toastError, openPreview } = deps;
  const [backToPreviewLoading, setBackToPreviewLoading] = useState(false);

  const handleBackToPreview = useCallback(async () => {
    if (backToPreviewLoading) return;
    setBackToPreviewLoading(true);
    try {
      const url = await resolveWorkingVideoPreviewUrl(projectId);
      if (!url) {
        toastError(FOCUS_PREVIEW.LOAD_FAILED);
        return;
      }
      openPreview({ projectId, previewUrl: url, openMode: EDITOR_MODES.FRAMING, jobId: null });
    } finally {
      setBackToPreviewLoading(false);
    }
  }, [backToPreviewLoading, projectId, resolveWorkingVideoPreviewUrl, toastError, openPreview]);

  return (
    <button onClick={handleBackToPreview} disabled={backToPreviewLoading}>
      back-to-preview
    </button>
  );
}

function makeDeps(overrides = {}) {
  return {
    resolveWorkingVideoPreviewUrl: vi.fn().mockResolvedValue('https://r2/working.mp4'),
    toastError: vi.fn(),
    openPreview: vi.fn(),
    ...overrides,
  };
}

describe('T10650 handleBackToPreview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves the URL and reopens the preview in FRAMING with a null jobId (no re-render, no toast)', async () => {
    const deps = makeDeps();
    render(<BackToPreviewHarness deps={deps} projectId={7} />);

    fireEvent.click(screen.getByText('back-to-preview'));

    await waitFor(() => expect(deps.openPreview).toHaveBeenCalledTimes(1));
    expect(deps.openPreview).toHaveBeenCalledWith({
      projectId: 7,
      previewUrl: 'https://r2/working.mp4',
      openMode: EDITOR_MODES.FRAMING,
      jobId: null,
    });
    expect(deps.toastError).not.toHaveBeenCalled();
  });

  it('null URL: shows the error toast and does NOT open a preview (loud, never a silent re-render)', async () => {
    const deps = makeDeps({ resolveWorkingVideoPreviewUrl: vi.fn().mockResolvedValue(null) });
    render(<BackToPreviewHarness deps={deps} />);

    fireEvent.click(screen.getByText('back-to-preview'));

    await waitFor(() => expect(deps.toastError).toHaveBeenCalledWith(FOCUS_PREVIEW.LOAD_FAILED));
    expect(deps.openPreview).not.toHaveBeenCalled();
  });

  it('shows a spinner (disabled) while resolving and re-enables after', async () => {
    let resolveUrl;
    const deps = makeDeps({
      resolveWorkingVideoPreviewUrl: vi.fn(() => new Promise((r) => { resolveUrl = r; })),
    });
    render(<BackToPreviewHarness deps={deps} />);
    const btn = screen.getByText('back-to-preview');

    fireEvent.click(btn);
    await waitFor(() => expect(btn.disabled).toBe(true));

    // A second click while resolving is a no-op (re-entrancy guard).
    fireEvent.click(btn);
    expect(deps.resolveWorkingVideoPreviewUrl).toHaveBeenCalledTimes(1);

    await act(async () => { resolveUrl('https://r2/working.mp4'); });
    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(deps.openPreview).toHaveBeenCalledTimes(1);
  });
});

// T10650 review (MAJOR): the export-completion callback refreshes the project
// pointer but the in-memory clips still carry the pre-render version (an
// in-session edit to an exported clip mints a version with exported_at NULL,
// fetched at edit time). Without a clip refetch after the render stamps
// exported_at, deriveFramingCtaState reads the stale NULL and shows "Generate
// Framing" instead of "Back to Preview" until reload. This reproduces the
// completion-callback contract (refetch -> fresh clips) and its negative control
// so the regression is discriminated from the fix.
async function runCompletionRefetch({ refetch, projectId = 42 }) {
  // Server has just stamped exported_at on the latest working_clips version.
  const serverClips = [{ id: 1, exported_at: '2026-09-19T15:00:00Z' }];
  // In-memory clips are STALE from the edit-time refetch (new version, NULL).
  let inMemoryClips = [{ id: 1, exported_at: null }];
  const fetchProjectClips = () => {
    inMemoryClips = serverClips;
    return Promise.resolve(serverClips);
  };
  // --- mirrors the completion callback's tail ---
  if (refetch) {
    await fetchProjectClips();
  }
  // --- band re-derives from the in-memory clips + a reset flag ---
  return deriveFramingCtaState({
    workingVideoId: 99,
    clips: inMemoryClips,
    framingChangedSinceExport: false, // reset by the completion callback
  });
}

describe('T10650 completion refetch keeps the durable staleness signal fresh', () => {
  it('WITH the refetch: the band derives "preview" (Back to Preview), not "generate"', async () => {
    const state = await runCompletionRefetch({ refetch: true });
    expect(state.mode).toBe('preview');
    expect(state.showBackToPreview).toBe(false);
    expect(state.renderedAt).toBe('2026-09-19T15:00:00Z');
  });

  it('negative control: WITHOUT the refetch the stale NULL forces "generate" + ghost (the bug)', async () => {
    const state = await runCompletionRefetch({ refetch: false });
    expect(state.mode).toBe('generate');
    expect(state.showBackToPreview).toBe(true);
  });
});
