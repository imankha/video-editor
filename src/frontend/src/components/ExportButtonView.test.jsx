import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ExportButtonView from './ExportButtonView';
import { GuideScope } from './instructions/GuideScope';
import { GUIDE_PULSE } from './instructions/guideTargets';
import { useSettingsStore } from '../stores/settingsStore';

const scoped = (pulse, ui) => {
  useSettingsStore.setState((s) => ({ settings: { ...s.settings, guidance: { ...s.settings.guidance, coachEnabled: true } } }));
  return <GuideScope guides={[{ pulse }]}>{ui}</GuideScope>;
};

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
  it('pulses Generate when guided, but stops during export or while disabled', () => {
    const { rerender } = render(scoped(GUIDE_PULSE.EXPORT, <ExportButtonView {...baseProps} />));
    expect(screen.getByTestId('primary-cta').className).toContain('coach-target-pulse');
    rerender(scoped(GUIDE_PULSE.EXPORT, <ExportButtonView {...baseProps} isCurrentlyExporting />));
    expect(screen.getByTestId('primary-cta').className).not.toContain('coach-target-pulse');
    rerender(scoped(GUIDE_PULSE.EXPORT, <ExportButtonView {...baseProps} isButtonDisabled />));
    expect(screen.getByTestId('primary-cta').className).not.toContain('coach-target-pulse');
    rerender(scoped(GUIDE_PULSE.EXPORT, <ExportButtonView {...baseProps} framingCtaMode="preview" />));
    expect(screen.getByTestId('primary-cta').className).not.toContain('coach-target-pulse');
  });
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
    expect(line.textContent).toContain('Add credits to sharpen it');
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
    expect(screen.getByRole('button', { name: 'Add spotlight to highlight' })).toBeTruthy();
  });
});

describe('ExportButtonView — T14830 (owner ruling 2026-11-07, "Confirm once"): never locked by drag', () => {
  it('Focus + zero keyframes: button is still enabled, no lock caption, no compact locked band', () => {
    render(<ExportButtonView {...baseProps}
      isButtonDisabled={false}
      estimatedCredits={12} creditBalance={42} />);
    const btn = screen.getByRole('button', { name: /Sharpen my highlight/ });
    expect(btn.disabled).toBe(false);
    expect(screen.queryByTestId('export-unframed-caption')).toBeNull();
    expect(screen.queryByTestId('action-band-compact')).toBeNull();
    expect(document.body.textContent).not.toMatch(/drag the box/i);
    expect(screen.getByTestId('export-credit-estimate').textContent).toContain('~12 credits');
  });

  it('Overlay mode unaffected: no caption, button stays enabled', () => {
    render(<ExportButtonView {...baseProps}
      isFramingMode={false} isButtonDisabled={false} />);
    expect(screen.queryByTestId('export-unframed-caption')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add spotlight to highlight' }).disabled).toBe(false);
  });

  it('shows the "Is your athlete in the box?" confirm dialog when showBoxConfirm is true', () => {
    render(<ExportButtonView {...baseProps} showBoxConfirm onBoxConfirmCheck={vi.fn()} onBoxConfirmContinue={vi.fn()} />);
    const panel = screen.getByTestId('focus-box-confirm');
    expect(panel.textContent).toMatch(/Is your athlete in the box\?/);
    expect(panel.textContent).toMatch(/Sharpening uses credits/);
    expect(within(panel).getByRole('button', { name: 'Check the box' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Sharpen my highlight' })).toBeTruthy();
  });

  it('"Check the box" calls onBoxConfirmCheck; "Sharpen my highlight" calls onBoxConfirmContinue', () => {
    const onCheck = vi.fn();
    const onContinue = vi.fn();
    render(<ExportButtonView {...baseProps} showBoxConfirm onBoxConfirmCheck={onCheck} onBoxConfirmContinue={onContinue} />);
    const panel = screen.getByTestId('focus-box-confirm');
    fireEvent.click(within(panel).getByRole('button', { name: 'Check the box' }));
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole('button', { name: 'Sharpen my highlight' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('does not render the confirm dialog when showBoxConfirm is false', () => {
    render(<ExportButtonView {...baseProps} showBoxConfirm={false} />);
    expect(screen.queryByTestId('focus-box-confirm')).toBeNull();
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
  it('Focus primary CTA reads "Sharpen my highlight" (N19)', () => {
    render(<ExportButtonView {...baseProps} isFramingMode={true} />);
    expect(screen.getByRole('button', { name: 'Sharpen my highlight' })).toBeTruthy();
  });

  it('Overlay primary CTA is "Add spotlight to highlight" (the render action, not "Add")', () => {
    render(<ExportButtonView {...baseProps} isFramingMode={false} />);
    expect(screen.getByRole('button', { name: 'Add spotlight to highlight' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Spotlight' })).toBeNull();
  });

  it('in-progress Focus label reads "Sharpening your highlight..." for the user\'s own export', () => {
    render(<ExportButtonView {...baseProps} isCurrentlyExporting={true} isExporting={true} />);
    expect(screen.getByRole('button', { name: 'Sharpening your highlight...' })).toBeTruthy();
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
    expect(screen.getByRole('button', { name: 'Sharpening your highlight...' })).toBeTruthy();
  });

  it('in-progress Overlay label reads "Adding spotlight to highlight..." (N20)', () => {
    render(<ExportButtonView {...baseProps} isFramingMode={false} isCurrentlyExporting={true} isExporting={true} />);
    expect(screen.getByRole('button', { name: 'Adding spotlight to highlight...' })).toBeTruthy();
  });

  it('Focus success state names the stage that finished: "Highlight ready" (N21)', () => {
    render(<ExportButtonView {...baseProps} displayProgress={100} isCurrentlyExporting={false} />);
    expect(screen.getByText('Your highlight is ready. Find it under Highlights.')).toBeTruthy();
  });

  it('Overlay success state reads "Highlight with spotlight ready" (N21)', () => {
    render(<ExportButtonView {...baseProps} isFramingMode={false} displayProgress={100} isCurrentlyExporting={false} />);
    expect(screen.getByText('Highlight with spotlight ready. Find it under Highlights.')).toBeTruthy();
  });

  it('Overlay cost cell shows the backend-confirmed free caption (Q1), Focus does not', () => {
    const { rerender } = render(<ExportButtonView {...baseProps} isFramingMode={false} />);
    expect(screen.getByTestId('export-free-cost-note').textContent).toContain('Effects are free, no credits needed');
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

describe('ExportButtonView — T10650 Watch highlight CTA', () => {
  it('preview mode: primary CTA reads "Watch highlight" (replaces Sharpen my highlight) and cost cell reads "No credits needed"', () => {
    render(<ExportButtonView {...baseProps} framingCtaMode="preview" estimatedCredits={9} creditBalance={42} />);
    expect(screen.getByRole('button', { name: 'Watch highlight' })).toBeTruthy();
    // D2: there is NO way to force a re-render in this state.
    expect(screen.queryByRole('button', { name: /Sharpen my highlight/ })).toBeNull();
    expect(screen.getByTestId('export-no-credits-note').textContent).toContain('No credits needed');
    // The credit estimate is fully replaced.
    expect(screen.queryByTestId('export-credit-estimate')).toBeNull();
  });

  it('preview mode: clicking the CTA fires onBackToPreview and NOT onExport', () => {
    const onBackToPreview = vi.fn();
    const onExport = vi.fn();
    render(<ExportButtonView {...baseProps} framingCtaMode="preview" onBackToPreview={onBackToPreview} onExport={onExport} />);
    screen.getByRole('button', { name: 'Watch highlight' }).click();
    expect(onBackToPreview).toHaveBeenCalledTimes(1);
    expect(onExport).not.toHaveBeenCalled();
  });

  it('preview mode: shows "Rendered {time}" when renderedAt is known', () => {
    render(<ExportButtonView {...baseProps} framingCtaMode="preview" renderedAt="2026-09-19T15:14:00Z" />);
    expect(screen.getByTestId('rendered-at-note').textContent).toMatch(/^Sharpened /);
  });

  it('preview mode: no "Rendered" line when renderedAt is null (mitigation, not a heuristic)', () => {
    render(<ExportButtonView {...baseProps} framingCtaMode="preview" renderedAt={null} />);
    expect(screen.queryByTestId('rendered-at-note')).toBeNull();
  });

  it('generate + showBackToPreview: primary CTA stays "Sharpen my highlight" and a ghost "Watch highlight" appears', () => {
    const onBackToPreview = vi.fn();
    const onExport = vi.fn();
    render(<ExportButtonView {...baseProps} framingCtaMode="generate" showBackToPreview={true}
      onBackToPreview={onBackToPreview} onExport={onExport} estimatedCredits={9} creditBalance={42} />);
    expect(screen.getByRole('button', { name: 'Sharpen my highlight' })).toBeTruthy();
    // Credit estimate still shows (paid re-render path).
    expect(screen.getByTestId('export-credit-estimate')).toBeTruthy();
    const ghost = screen.getByTestId('back-to-preview-ghost');
    ghost.click();
    expect(onBackToPreview).toHaveBeenCalledTimes(1);
    expect(onExport).not.toHaveBeenCalled();
  });

  it('ghost button is hidden while an export is in progress', () => {
    render(<ExportButtonView {...baseProps} framingCtaMode="generate" showBackToPreview={true} isCurrentlyExporting={true} />);
    expect(screen.queryByTestId('back-to-preview-ghost')).toBeNull();
  });

  it('backToPreviewLoading disables the preview CTA (spinner state)', () => {
    render(<ExportButtonView {...baseProps} framingCtaMode="preview" backToPreviewLoading={true} />);
    expect(screen.getByRole('button', { name: 'Watch highlight' }).disabled).toBe(true);
  });

  it('overlay mode is unaffected (Watch highlight is framing-only)', () => {
    render(<ExportButtonView {...baseProps} isFramingMode={false} framingCtaMode="preview" showBackToPreview={true} />);
    expect(screen.queryByRole('button', { name: 'Watch highlight' })).toBeNull();
    expect(screen.queryByTestId('back-to-preview-ghost')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add spotlight to highlight' })).toBeTruthy();
  });
});

describe('ExportButtonView - T11970 opening state', () => {
  it('opening mode: disabled Opening CTA, never Sharpen my highlight', () => {
    render(<ExportButtonView {...baseProps} framingCtaMode="opening" />);
    const btn = screen.getByRole('button', { name: /Opening your highlight/ });
    expect(btn.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Sharpen my highlight/ })).toBeNull();
  });
});
