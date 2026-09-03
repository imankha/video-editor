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

  it('does NOT render the estimate in Overlay mode (Framing-only)', () => {
    render(<ExportButtonView {...baseProps} isFramingMode={false} estimatedCredits={9} creditBalance={42} />);
    expect(screen.queryByTestId('export-credit-estimate')).toBeNull();
    // Overlay primary CTA applies the configured overlay (T7700 reverses T7580's "Create Reel").
    expect(screen.getByRole('button', { name: 'Add Overlay' })).toBeTruthy();
  });
});

describe('ExportButtonView — T8510 unframed-clip export guard (Option A, reverses T3700 P0)', () => {
  it('(a) Focus + zero keyframes: button disabled and reason caption rendered under it', () => {
    render(<ExportButtonView {...baseProps}
      hasUnframedClips={true} unframedCount={1} isButtonDisabled={true}
      estimatedCredits={12} creditBalance={42} />);
    const btn = screen.getByRole('button', { name: /Export Focused Video/ });
    expect(btn.disabled).toBe(true);
    const caption = screen.getByTestId('export-unframed-caption');
    expect(caption.textContent).toContain('Set at least one focus point to export');
    expect(caption.textContent).toContain('~12 credits');
    expect(caption.className).toContain('text-amber-400');
  });

  it('(b) framed clip: button enabled, no caption', () => {
    render(<ExportButtonView {...baseProps}
      hasUnframedClips={false} isButtonDisabled={false}
      estimatedCredits={9} creditBalance={42} />);
    expect(screen.getByRole('button', { name: /Export Focused Video/ }).disabled).toBe(false);
    expect(screen.queryByTestId('export-unframed-caption')).toBeNull();
  });

  it('(c) multi-clip partial (Option A: ANY unframed clip blocks): disabled + every-clip wording', () => {
    render(<ExportButtonView {...baseProps}
      isMultiClipMode={true} totalExtractedClips={3} unframedCount={1}
      hasUnframedClips={true} isButtonDisabled={true}
      estimatedCredits={20} creditBalance={42} />);
    const btn = screen.getByRole('button', { name: /Export Focused Video \(2\/3\)/ });
    expect(btn.disabled).toBe(true);
    expect(screen.getByTestId('export-unframed-caption').textContent)
      .toContain('Set at least one focus point on every clip to export');
  });

  it('(d) Overlay mode unaffected: no caption, button stays enabled', () => {
    render(<ExportButtonView {...baseProps}
      isFramingMode={false} hasUnframedClips={true} isButtonDisabled={false} />);
    expect(screen.queryByTestId('export-unframed-caption')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Overlay' }).disabled).toBe(false);
  });

  it('caption is hidden while an export is in progress', () => {
    render(<ExportButtonView {...baseProps}
      hasUnframedClips={true} isButtonDisabled={true} isCurrentlyExporting={true} />);
    expect(screen.queryByTestId('export-unframed-caption')).toBeNull();
  });

  it('caption omits the credit suffix when the estimate is unknown (no fabricated number)', () => {
    render(<ExportButtonView {...baseProps}
      hasUnframedClips={true} isButtonDisabled={true} estimatedCredits={null} />);
    const caption = screen.getByTestId('export-unframed-caption');
    expect(caption.textContent).toContain('Set at least one focus point to export');
    expect(caption.textContent).not.toContain('credit');
  });
});

describe('ExportButtonView — T8280 high-fps 30fps-choice note (Option B-simple)', () => {
  // Design doc docs/plans/tasks/T8280-design.md Q4/Q4a: when a clip's surfaced
  // fps >= HIGH_FPS_THRESHOLD (31), render a one-line note ADJACENT to the
  // existing credit-estimate line. The credit ESTIMATE VALUE itself is
  // UNCHANGED (still ceil(seconds), no discount, no toggle) -- B-simple ships
  // ONE price + ONE note, zero dead controls (no segmented control, no second
  // "native" price). `sourceFps` is the prop name this test expects the
  // Implementor to add to ExportButtonView; update here if a different name
  // is chosen, but the BEHAVIOR (note visibility gated on the threshold,
  // estimate value unchanged) is the load-bearing assertion.

  it('renders a high-fps note adjacent to the credit estimate when sourceFps >= 31', () => {
    render(
      <ExportButtonView
        {...baseProps}
        estimatedCredits={9}
        insufficientForEstimate={false}
        creditBalance={42}
        sourceFps={50}
      />
    );
    const estimateLine = screen.getByTestId('export-credit-estimate');
    // The estimate VALUE is unchanged -- still ceil(seconds), no native-price
    // discount/premium baked into this number for Option B.
    expect(estimateLine.textContent).toContain('~9 credit');

    const note = screen.getByTestId('export-high-fps-note');
    expect(note.textContent).toMatch(/50\s*fps/i);
    expect(note.textContent).toMatch(/30\s*fps/i);
  });

  it('does NOT render the high-fps note when sourceFps is below the threshold', () => {
    render(
      <ExportButtonView
        {...baseProps}
        estimatedCredits={9}
        insufficientForEstimate={false}
        creditBalance={42}
        sourceFps={29.97}
      />
    );
    expect(screen.queryByTestId('export-high-fps-note')).toBeNull();
  });

  it('does NOT render the high-fps note when sourceFps is unknown (null -- fail safe to today\'s behavior)', () => {
    render(
      <ExportButtonView
        {...baseProps}
        estimatedCredits={9}
        insufficientForEstimate={false}
        creditBalance={42}
        sourceFps={null}
      />
    );
    expect(screen.queryByTestId('export-high-fps-note')).toBeNull();
  });

  it('does NOT render the high-fps note while an export is in progress (matches estimate-line visibility)', () => {
    render(
      <ExportButtonView
        {...baseProps}
        isCurrentlyExporting={true}
        estimatedCredits={9}
        creditBalance={42}
        sourceFps={50}
      />
    );
    expect(screen.queryByTestId('export-high-fps-note')).toBeNull();
  });
});

describe('ExportButtonView — T7580 reel vocabulary', () => {
  it('Focus primary CTA reads "Export Focused Video" (T7700)', () => {
    render(<ExportButtonView {...baseProps} isFramingMode={true} />);
    expect(screen.getByRole('button', { name: 'Export Focused Video' })).toBeTruthy();
  });

  it('Focus CTA keeps the framed-count suffix on the "Export Focused Video" label', () => {
    render(
      <ExportButtonView
        {...baseProps}
        isFramingMode={true}
        hasUnframedClips={true}
        isMultiClipMode={true}
        totalExtractedClips={3}
        unframedCount={1}
      />
    );
    expect(screen.getByRole('button', { name: 'Export Focused Video (2/3)' })).toBeTruthy();
  });

  it('Overlay primary CTA is "Add Overlay" (applies the configured overlay) (T7700)', () => {
    render(<ExportButtonView {...baseProps} isFramingMode={false} />);
    expect(screen.getByRole('button', { name: 'Add Overlay' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create Reel' })).toBeNull();
  });

  it('in-progress label reads "Creating reel..." for the user\'s own export', () => {
    render(<ExportButtonView {...baseProps} isCurrentlyExporting={true} isExporting={true} />);
    expect(screen.getByRole('button', { name: 'Creating reel...' })).toBeTruthy();
  });

  it('in-progress label reads "Reel in progress..." for an externally-triggered export', () => {
    render(
      <ExportButtonView
        {...baseProps}
        isCurrentlyExporting={true}
        isExporting={false}
        isExternallyExporting={true}
      />
    );
    expect(screen.getByRole('button', { name: 'Reel in progress...' })).toBeTruthy();
  });

  it('success state announces the reel is ready and points at My Reels', () => {
    render(<ExportButtonView {...baseProps} displayProgress={100} isCurrentlyExporting={false} />);
    expect(screen.getByText('Reel ready! Find it in Highlight Reels.')).toBeTruthy();
  });

  it('Focus Settings names the follow-your-athlete crop feature', () => {
    render(<ExportButtonView {...baseProps} isFramingMode={true} />);
    expect(screen.getByText('Set crop keyframes so the focus follows your athlete.')).toBeTruthy();
    // Export-info subtext frames the render as building the reel + follow-focus crop.
    expect(screen.getByText(/Builds your reel: applies your follow-focus/)).toBeTruthy();
  });
});
