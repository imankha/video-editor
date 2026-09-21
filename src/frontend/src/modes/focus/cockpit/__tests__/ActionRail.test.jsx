import { render, screen, fireEvent } from '@testing-library/react';
import ActionRail from '../ActionRail';

function renderRail(overrides = {}) {
  const props = {
    activeSheet: null,
    onOpenClips: vi.fn(),
    onOpenSetup: vi.fn(),
    canUndo: true,
    onUndo: vi.fn(),
    previewing: false,
    onTogglePreview: vi.fn(),
    ctaMode: 'generate',
    estimatedCredits: 6,
    ctaDisabled: false,
    ctaExporting: false,
    onGenerate: vi.fn(),
    onBackToPreview: vi.fn(),
    backToPreviewLoading: false,
    ...overrides,
  };
  return { props, ...render(<ActionRail {...props} />) };
}

describe('ActionRail (T10840 Zone D)', () => {
  it('renders the four rail buttons and the primary CTA', () => {
    renderRail();
    expect(screen.getByTestId('cockpit-clips-btn')).toBeTruthy();
    expect(screen.getByTestId('cockpit-setup-btn')).toBeTruthy();
    expect(screen.getByTestId('cockpit-undo-btn')).toBeTruthy();
    expect(screen.getByTestId('cockpit-preview-btn')).toBeTruthy();
    expect(screen.getByTestId('primary-cta')).toBeTruthy();
  });

  it('shows the ~N cr estimate and fires generate', () => {
    const { props } = renderRail();
    expect(screen.getByTestId('cockpit-credit-estimate').textContent).toBe('~6 cr');
    fireEvent.click(screen.getByTestId('primary-cta'));
    expect(props.onGenerate).toHaveBeenCalled();
  });

  it('sits above the scrim (z-50) so the CTA is never dimmed while a sheet is open', () => {
    renderRail({ activeSheet: 'clips' });
    expect(screen.getByTestId('cockpit-actions').className).toContain('z-50');
    // The CTA itself is still enabled + interactive with a sheet open.
    expect(screen.getByTestId('primary-cta').disabled).toBe(false);
  });

  it('the Undo button is disabled when there is nothing to undo', () => {
    renderRail({ canUndo: false });
    expect(screen.getByTestId('cockpit-undo-btn').disabled).toBe(true);
  });

  it('the preview CTA state renders "Back to / Preview" and fires onBackToPreview', () => {
    const { props } = renderRail({ ctaMode: 'preview' });
    const cta = screen.getByTestId('primary-cta');
    expect(cta.textContent).toContain('Back to');
    expect(cta.textContent).toContain('Preview');
    fireEvent.click(cta);
    expect(props.onBackToPreview).toHaveBeenCalled();
  });

  it('hides the credit estimate while exporting', () => {
    renderRail({ ctaExporting: true });
    expect(screen.queryByTestId('cockpit-credit-estimate')).toBeNull();
  });
});
