import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ExportButtonView from './ExportButtonView';

/**
 * T9480 Stage E4 (AC3) -- the billable-duration disclosure line appears ONLY
 * when rounding actually changed the number (a real gap between the tenths
 * reading and the whole-second charge), never for the common exact-second
 * case. The disclosed integer is always the SAME estimatedCredits already
 * shown on the first line -- never re-derived.
 */
const baseProps = {
  isCurrentlyExporting: false,
  isExporting: false,
  isExternallyExporting: false,
  displayProgress: 0,
  displayMessage: '',
  error: null,
  failedExport: null,
  disconnected: false,
  reconnectionFailed: false,
  retrying: false,
  isFramingMode: true,
  hasUnframedClips: false,
  unframedCount: 0,
  totalExtractedClips: 1,
  isMultiClipMode: false,
  isButtonDisabled: false,
  buttonTitle: undefined,
  includeAudio: true,
  onExport: vi.fn(),
  onRetryConnection: vi.fn(),
  onDismissExport: vi.fn(),
  onAudioToggle: vi.fn(),
  EXPORT_CONFIG: { targetFps: 30 },
  showInsufficientCredits: null,
  onCloseInsufficientCredits: vi.fn(),
  showBuyCredits: false,
  onOpenBuyCredits: vi.fn(),
  onCloseBuyCredits: vi.fn(),
  onPaymentSuccess: vi.fn(),
  handleExportRef: { current: null },
};

describe('ExportButtonView billable-duration disclosure (T9480 Stage E4, AC3)', () => {
  it('does NOT show the line for an exact whole-second duration (no real rounding, no noise)', () => {
    render(
      <ExportButtonView
        {...baseProps}
        estimatedCredits={6}
        estimatedSeconds={6}
        insufficientForEstimate={false}
        creditBalance={79}
      />,
    );
    expect(screen.queryByTestId('export-billable-disclosure')).toBeNull();
  });

  it('does NOT show the line for 6.027s (tenths and whole-second both read 6 -- same number)', () => {
    render(
      <ExportButtonView
        {...baseProps}
        estimatedCredits={6}
        estimatedSeconds={6.027}
        insufficientForEstimate={false}
        creditBalance={79}
      />,
    );
    expect(screen.queryByTestId('export-billable-disclosure')).toBeNull();
  });

  it('SHOWS the line for 6.5s -- whole-second charge (7) differs from the tenths reading (6.5)', () => {
    render(
      <ExportButtonView
        {...baseProps}
        estimatedCredits={7}
        estimatedSeconds={6.5}
        insufficientForEstimate={false}
        creditBalance={79}
      />,
    );
    const line = screen.getByTestId('export-billable-disclosure');
    expect(line.textContent).toBe(
      '6.5s of video · 7 credits · 1 credit per second, rounded to the nearest second.',
    );
  });

  it('the disclosed integer is the SAME estimatedCredits already shown on the first line, never re-derived', () => {
    render(
      <ExportButtonView
        {...baseProps}
        estimatedCredits={7}
        estimatedSeconds={6.5}
        insufficientForEstimate={false}
        creditBalance={79}
      />,
    );
    expect(screen.getByTestId('export-credit-estimate').textContent).toContain('~7 credits');
    expect(screen.getByTestId('export-billable-disclosure').textContent).toContain('7 credits');
  });

  it('is absent when the estimate is hidden (fail-closed, null)', () => {
    render(<ExportButtonView {...baseProps} estimatedCredits={null} estimatedSeconds={null} />);
    expect(screen.queryByTestId('export-billable-disclosure')).toBeNull();
  });

  it('is absent outside Framing mode (Overlay never quotes a per-second estimate)', () => {
    render(
      <ExportButtonView
        {...baseProps}
        isFramingMode={false}
        estimatedCredits={7}
        estimatedSeconds={6.5}
      />,
    );
    expect(screen.queryByTestId('export-billable-disclosure')).toBeNull();
  });
});
