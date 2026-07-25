import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ExportButtonView from './ExportButtonView';

// ExportButtonView is pure-presentational; give it the minimal prop surface the
// render path touches. Only the T5790 credit-estimate line is under test here.
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

describe('ExportButtonView — T5790 credit-cost estimate', () => {
  it('shows the estimate + balance in Framing mode (normal state, not a warning)', () => {
    render(<ExportButtonView {...baseProps} estimatedCredits={9} insufficientForEstimate={false} creditBalance={42} />);
    const line = screen.getByTestId('export-credit-estimate');
    expect(line.textContent).toContain('~9 credits · balance 42');
    // Normal state = subtle gray, NOT the amber warning.
    expect(line.className).toContain('text-gray-400');
    expect(line.className).not.toContain('text-amber-400');
    expect(line.textContent).not.toContain('add credits');
  });

  it('singularizes "credit" for a 1-credit estimate', () => {
    render(<ExportButtonView {...baseProps} estimatedCredits={1} insufficientForEstimate={false} creditBalance={5} />);
    expect(screen.getByTestId('export-credit-estimate').textContent).toContain('~1 credit · balance 5');
  });

  it('renders a warning (amber) when the estimate exceeds the balance', () => {
    render(<ExportButtonView {...baseProps} estimatedCredits={9} insufficientForEstimate={true} creditBalance={3} />);
    const line = screen.getByTestId('export-credit-estimate');
    expect(line.className).toContain('text-amber-400');
    expect(line.textContent).toContain('add credits to export');
  });

  it('hides the estimate when duration is unknown (estimatedCredits null — no fabricated number)', () => {
    render(<ExportButtonView {...baseProps} estimatedCredits={null} creditBalance={42} />);
    expect(screen.queryByTestId('export-credit-estimate')).toBeNull();
  });

  it('hides the estimate while an export is in progress', () => {
    render(<ExportButtonView {...baseProps} isCurrentlyExporting={true} estimatedCredits={9} creditBalance={42} />);
    expect(screen.queryByTestId('export-credit-estimate')).toBeNull();
  });

  it('does NOT render the estimate in Overlay mode (Framing-only, byte-identical Overlay button)', () => {
    render(<ExportButtonView {...baseProps} isFramingMode={false} estimatedCredits={9} creditBalance={42} />);
    expect(screen.queryByTestId('export-credit-estimate')).toBeNull();
    // Overlay button label unchanged.
    expect(screen.getByRole('button', { name: 'Add Spotlight' })).toBeTruthy();
  });
});
