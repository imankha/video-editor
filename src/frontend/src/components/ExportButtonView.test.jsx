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
    expect(screen.getByRole('button', { name: 'Export clip with effects' })).toBeTruthy();
  });
});

describe('ExportButtonView — T8510 unframed-clip export guard (Option A, reverses T3700 P0)', () => {
  it('(a) Focus + zero keyframes: button disabled and reason caption rendered under it', () => {
    render(<ExportButtonView {...baseProps}
      hasUnframedClips={true} unframedCount={1} isButtonDisabled={true}
      estimatedCredits={12} creditBalance={42} />);
    const btn = screen.getByRole('button', { name: /Generate AI Focus/ });
    expect(btn.disabled).toBe(true);
    const caption = screen.getByTestId('export-unframed-caption');
    expect(caption.textContent).toContain('Set at least one focus point to export');
    expect(caption.className).toContain('text-amber-400');
    // T9270: the disabled reason (LEFT status cell) and the credit estimate (RIGHT
    // cost cell) are now separate ActionBand cells — the reason no longer carries
    // the credit suffix; the estimate renders in its own line.
    expect(screen.getByTestId('export-credit-estimate').textContent).toContain('~12 credits');
  });

  it('(b) framed clip: button enabled, no caption', () => {
    render(<ExportButtonView {...baseProps}
      hasUnframedClips={false} isButtonDisabled={false}
      estimatedCredits={9} creditBalance={42} />);
    expect(screen.getByRole('button', { name: /Generate AI Focus/ }).disabled).toBe(false);
    expect(screen.queryByTestId('export-unframed-caption')).toBeNull();
  });

  it('(c) multi-clip partial (Option A: ANY unframed clip blocks): disabled + every-clip wording', () => {
    render(<ExportButtonView {...baseProps}
      isMultiClipMode={true} totalExtractedClips={3} unframedCount={1}
      hasUnframedClips={true} isButtonDisabled={true}
      estimatedCredits={20} creditBalance={42} />);
    const btn = screen.getByRole('button', { name: /Generate AI Focus \(2\/3\)/ });
    expect(btn.disabled).toBe(true);
    expect(screen.getByTestId('export-unframed-caption').textContent)
      .toContain('Set at least one focus point on every clip to export');
  });

  it('(d) Overlay mode unaffected: no caption, button stays enabled', () => {
    render(<ExportButtonView {...baseProps}
      isFramingMode={false} hasUnframedClips={true} isButtonDisabled={false} />);
    expect(screen.queryByTestId('export-unframed-caption')).toBeNull();
    expect(screen.getByRole('button', { name: 'Export clip with effects' }).disabled).toBe(false);
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

describe('ExportButtonView — T9540 render/job vocabulary (supersedes T7580)', () => {
  it('Focus primary CTA reads "Generate AI Focus" (N19)', () => {
    render(<ExportButtonView {...baseProps} isFramingMode={true} />);
    expect(screen.getByRole('button', { name: 'Generate AI Focus' })).toBeTruthy();
  });

  it('Focus CTA keeps the framed-count suffix on the "Generate AI Focus" label', () => {
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
    expect(screen.getByRole('button', { name: 'Generate AI Focus (2/3)' })).toBeTruthy();
  });

  it('Overlay primary CTA is "Export clip with effects" (N20 — the render action, not "Add")', () => {
    render(<ExportButtonView {...baseProps} isFramingMode={false} />);
    expect(screen.getByRole('button', { name: 'Export clip with effects' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Spotlight' })).toBeNull();
  });

  it('in-progress Focus label reads "Generating AI Focus..." for the user\'s own export', () => {
    render(<ExportButtonView {...baseProps} isCurrentlyExporting={true} isExporting={true} />);
    expect(screen.getByRole('button', { name: 'Generating AI Focus...' })).toBeTruthy();
  });

  it('in-progress Focus label is the same for an externally-triggered export (one stage, one label)', () => {
    render(
      <ExportButtonView
        {...baseProps}
        isCurrentlyExporting={true}
        isExporting={false}
        isExternallyExporting={true}
      />
    );
    expect(screen.getByRole('button', { name: 'Generating AI Focus...' })).toBeTruthy();
  });

  it('in-progress Overlay label reads "Exporting clip..." (N20)', () => {
    render(<ExportButtonView {...baseProps} isFramingMode={false} isCurrentlyExporting={true} isExporting={true} />);
    expect(screen.getByRole('button', { name: 'Exporting clip...' })).toBeTruthy();
  });

  it('Focus success state names the stage that finished: "AI Focus ready" (N21)', () => {
    render(<ExportButtonView {...baseProps} displayProgress={100} isCurrentlyExporting={false} />);
    expect(screen.getByText('AI Focus ready. Find it in Highlight Reels.')).toBeTruthy();
  });

  it('Overlay success state reads "Clip ready" (N21)', () => {
    render(<ExportButtonView {...baseProps} isFramingMode={false} displayProgress={100} isCurrentlyExporting={false} />);
    expect(screen.getByText('Clip ready. Find it in Highlight Reels.')).toBeTruthy();
  });

  it('Overlay cost cell shows the backend-confirmed free caption (Q1), Focus does not', () => {
    const { rerender } = render(<ExportButtonView {...baseProps} isFramingMode={false} />);
    expect(screen.getByTestId('export-free-cost-note').textContent).toContain('No credits · effects are free');
    // Framing mode never shows the free caption (it is a paid stage).
    rerender(<ExportButtonView {...baseProps} isFramingMode={true} />);
    expect(screen.queryByTestId('export-free-cost-note')).toBeNull();
  });

  it('Overlay free caption is hidden while an export is in progress', () => {
    render(<ExportButtonView {...baseProps} isFramingMode={false} isCurrentlyExporting={true} />);
    expect(screen.queryByTestId('export-free-cost-note')).toBeNull();
  });

  // T9270: the "Focus Settings" card (audio toggle + build blurb) no longer lives in
  // the ActionBand — those Reel settings move into the settings rail. The band is the
  // CTA + status + cost cells only. The rail owns that copy now.
});
