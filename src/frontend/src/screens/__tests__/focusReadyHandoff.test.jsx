import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useState, useMemo, useCallback } from 'react';
import ExportButtonView from '../../components/ExportButtonView';
import { deriveFramingCtaState } from '../../utils/framingCtaState';
import { loadAndOfferFocusCompletion } from '../focusCompletionOffer';
import { EDITOR_MODES } from '../../stores';

// T11970: FocusScreen cannot be mounted in isolation (see focusBackToPreview.test.jsx),
// so this harness mirrors handleProceedToOverlayInternal's server-path tail and the
// ctaState derivation, but composes the REAL loadAndOfferFocusCompletion,
// deriveFramingCtaState and ExportButtonView. Fetches are held pending.
const viewProps = {
  isCurrentlyExporting: false, isExporting: false, displayProgress: 0, error: null,
  failedExport: null, disconnected: false, reconnectionFailed: false, retrying: false,
  isFramingMode: true, hasUnframedClips: false, isButtonDisabled: false, includeAudio: true,
  onExport: vi.fn(), onRetryConnection: vi.fn(), onDismissExport: vi.fn(), onAudioToggle: vi.fn(),
  EXPORT_CONFIG: { targetFps: 30 }, showInsufficientCredits: null, onCloseInsufficientCredits: vi.fn(),
  showBuyCredits: false, onOpenBuyCredits: vi.fn(), onCloseBuyCredits: vi.fn(), onPaymentSuccess: vi.fn(),
  handleExportRef: { current: null },
};

function Harness({ deps, projectId = 7 }) {
  const [workingVideoId] = useState(null); // lags COMPLETE until the refresh lands
  const [openingHighlight, setOpeningHighlight] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const cta = useMemo(
    () => deriveFramingCtaState({
      workingVideoId, clips: [{ exported_at: null }], framingChangedSinceExport: false, openingHighlight,
    }),
    [workingVideoId, openingHighlight],
  );
  const onComplete = useCallback(async () => {
    setOpeningHighlight(true);
    try {
      await loadAndOfferFocusCompletion({
        projectId,
        refreshProject: deps.refreshProject,
        resolvePreviewUrl: deps.resolvePreviewUrl,
        openMode: EDITOR_MODES.FRAMING,
        jobId: 'j1',
        openPreview: () => setPanelOpen(true),
        recordAchievement: vi.fn(),
      });
    } finally {
      setOpeningHighlight(false);
    }
  }, [deps, projectId]);
  return (
    <>
      <button onClick={onComplete}>complete</button>
      {panelOpen && <div data-testid="panel" />}
      <ExportButtonView {...viewProps} framingCtaMode={cta.mode} />
    </>
  );
}

describe('T11970 highlight-ready handoff wiring', () => {
  it('never shows Generate highlight from COMPLETE to the panel; both GETs start together', async () => {
    let resolveUrl; let resolveRefresh;
    const deps = {
      refreshProject: vi.fn(() => new Promise((r) => { resolveRefresh = r; })),
      resolvePreviewUrl: vi.fn(() => new Promise((r) => { resolveUrl = r; })),
    };
    render(<Harness deps={deps} />);
    expect(screen.getByRole('button', { name: /Generate highlight/ })).toBeTruthy();

    await act(async () => { screen.getByText('complete').click(); });

    // Both requested before either resolved, bar already in the opening state.
    expect(deps.refreshProject).toHaveBeenCalledTimes(1);
    expect(deps.resolvePreviewUrl).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Generate highlight/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Opening your highlight/ })).toBeTruthy();

    // Panel opens as soon as the URL resolves, while the refresh is still pending.
    await act(async () => { resolveUrl('https://r2/w.mp4'); });
    expect(screen.getByTestId('panel')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Generate highlight/ })).toBeNull();

    await act(async () => { resolveRefresh(); });
  });
});
