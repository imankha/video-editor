import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ExportButtonView from '../../components/ExportButtonView';
import FramingActionRow from './FramingActionRow';
import ActionRail from './cockpit/ActionRail';
import { resolveGuide } from '../../components/instructions/resolveGuide';
import { GUIDE_PULSE } from '../../components/instructions/guideTargets';

// T17910 (owner ruling 2026-11-19): the Frame bar reads in working order -- Trim, Preview,
// then Sharpen my highlight -- the toggles say "Close ..." while on, an idle line names
// Sharpen as the finish, Sharpen carries the wand, and the coach sentences name Sharpen.

const baseProps = {
  isCurrentlyExporting: false,
  isExporting: false,
  displayProgress: 0,
  error: null,
  failedExport: null,
  disconnected: false,
  reconnectionFailed: false,
  retrying: false,
  isFramingMode: true,
  isButtonDisabled: false,
  onExport: vi.fn(),
  onRetryConnection: vi.fn(),
  onDismissExport: vi.fn(),
  showInsufficientCredits: null,
  onCloseInsufficientCredits: vi.fn(),
  showBuyCredits: false,
  onCloseBuyCredits: vi.fn(),
  onPaymentSuccess: vi.fn(),
  handleExportRef: { current: null },
  estimatedCredits: 4,
  creditBalance: 20,
};

const frameBand = (over = {}, row = {}) => (
  <ExportButtonView
    {...baseProps}
    actionsAbove={<FramingActionRow inline onToggleTrim={vi.fn()} onTogglePreview={vi.fn()} {...row} />}
    {...over}
  />
);

const HINT = 'Trim and Preview are optional. When your athlete stays in the box, tap Sharpen my highlight.';
const svgClass = (el) => el.querySelector('svg').getAttribute('class');

describe('T17910:C1 working order', () => {
  it('renders Trim, Preview, then Sharpen my highlight in DOM (tab) order, Sharpen in the wide last column', () => {
    render(frameBand());
    const buttons = within(screen.getByTestId('action-band-above')).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('data-testid'))).toEqual(['trim-slowmo-button', 'framing-preview-toggle', 'primary-cta']);
    expect(screen.getByTestId('primary-cta').textContent).toContain('Sharpen my highlight');
    const grid = screen.getByTestId('action-band-above');
    expect(grid.className).toContain('sm:[grid-template-columns:repeat(2,minmax(0,1fr))_minmax(0,1.4fr)]');
    // Phone: two-column grid, Sharpen's cell spans both columns (full width under Trim and Preview).
    expect(grid.className.split(/\s+/)).toContain('grid-cols-2');
    const ctaCell = screen.getByTestId('primary-cta').closest('[data-testid="action-band-above"] > div');
    expect(ctaCell.className.split(/\s+/)).toContain('col-span-2');
    expect(ctaCell.className.split(/\s+/)).toContain('sm:col-span-1');
  });

  it('draws a decorative lg-only chevron before Sharpen', () => {
    render(frameBand());
    const chevron = screen.getByTestId('sharpen-step-chevron');
    expect(chevron.getAttribute('aria-hidden')).toBe('true');
    expect(chevron.getAttribute('class')).toMatch(/\bhidden\b/);
    expect(chevron.getAttribute('class')).toMatch(/lg:block/);
  });
});

describe('T17910:C2 / C3 toggles read "Close ..." while on', () => {
  it('Trim open reads Close trimming with scissors, no check', () => {
    render(<FramingActionRow onToggleTrim={vi.fn()} trimOpen />);
    const btn = screen.getByTestId('trim-slowmo-button');
    expect(btn.getAttribute('aria-label')).toBe('Close trimming');
    expect(btn.textContent).toMatch(/^Close trimming/);
    expect(btn.getAttribute('title')).toBe('Close the trim and slow motion track. Your changes stay.');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(svgClass(btn)).toMatch(/lucide-scissors/);
    expect(document.body.textContent).not.toMatch(/Done trimming/);
  });

  it('Preview on reads Close preview', () => {
    render(<FramingActionRow onTogglePreview={vi.fn()} previewing />);
    const btn = screen.getByTestId('framing-preview-toggle');
    expect(btn.getAttribute('aria-label')).toBe('Close preview');
    expect(btn.textContent).toMatch(/^Close preview/);
    expect(document.body.textContent).not.toMatch(/Back to full video/);
  });
});

describe('T17910:C4 idle hint', () => {
  it('shows the hint in the status cell when framing is idle, hidden below sm', () => {
    render(frameBand());
    const hint = screen.getByTestId('frame-idle-hint');
    expect(hint.textContent).toBe(HINT);
    expect(hint.className.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'sm:block', 'text-xs', 'text-gray-400']));
  });

  it.each([
    ['an error', { error: 'boom' }],
    ['a failed export', { failedExport: { error: 'x' } }],
    ['a disconnect', { disconnected: true }],
    ['progress', { isCurrentlyExporting: true }],
    ['the ghost Back to Preview link', { showBackToPreview: true, onBackToPreview: vi.fn() }],
  ])('hides the hint with %s in the status cell', (_name, over) => {
    render(frameBand(over));
    expect(screen.queryByTestId('frame-idle-hint')).toBeNull();
  });

  it('never shows the hint on Overlay', () => {
    render(<ExportButtonView {...baseProps} isFramingMode={false} />);
    expect(screen.queryByTestId('frame-idle-hint')).toBeNull();
  });
});

describe('T17910:C5 wand icon', () => {
  it('Sharpen shows the wand, not the download arrow or the Spotlight sparkles', () => {
    render(frameBand());
    const cls = svgClass(screen.getByTestId('primary-cta'));
    expect(cls).toMatch(/lucide-wand/);
    expect(cls).not.toMatch(/lucide-download|lucide-sparkles/);
  });

  it('the landscape rail Sharpen shows the wand', () => {
    render(<ActionRail ctaMode="generate" onGenerate={vi.fn()} onOpenSetup={vi.fn()} onTogglePreview={vi.fn()} />);
    const cls = svgClass(screen.getByTestId('cockpit-cta-ring'));
    expect(cls).toMatch(/lucide-wand/);
    expect(cls).not.toMatch(/lucide-download|lucide-sparkles/);
  });
});

describe('T17910:C7 coach sentences name Sharpen', () => {
  const fl = (over) => ({
    shapeChosen: true, dragDone: true, hasPlayed: true, trimStage: 'off', hasPlayedThrough: true,
    previewing: false, hasPreviewPlayedThrough: true, ctaBusy: false, ...over,
  });

  it.each([false, true])('experienced account (cockpit=%s): names Sharpen; no pulse before the drag, Sharpen pulses after', (cockpit) => {
    const before = resolveGuide({ screen: 'focus', progress: { finishedCount: 3 }, local: fl({ cockpit, dragDone: false, hasPlayed: false, hasPlayedThrough: false, hasPreviewPlayedThrough: false }) });
    expect(before.message.title).toBe(`You know the basics. ${HINT}`);
    expect(before.pulse ?? null).toBeNull();
    const after = resolveGuide({ screen: 'focus', progress: { finishedCount: 3 }, local: fl({ cockpit, hasPlayed: false, hasPlayedThrough: false, hasPreviewPlayedThrough: false }) });
    expect(after.message.title).toBe(`You know the basics. ${HINT}`);
    expect(after.pulse).toBe(GUIDE_PULSE.EXPORT);
  });

  it('new account at the Preview step: names Sharpen and keeps the action band clear of the shade', () => {
    const g = resolveGuide({ screen: 'focus', local: fl({ hasPreviewPlayedThrough: false }) });
    expect(g.id).toBe('focus.progress.preview');
    expect(g.message.title).toBe('Tap Preview to see exactly what you’ll share, then tap Sharpen my highlight.');
    expect(g.pulse).toBe(GUIDE_PULSE.PREVIEW);
    expect(g.keepClear).toContain('[data-testid="action-band"]');
  });

  it('cockpit Preview step: same sentence, the rail Sharpen kept clear', () => {
    const g = resolveGuide({ screen: 'focus', local: { cockpit: true, shapeChosen: true, dragDone: true } });
    expect(g.id).toBe('focus.cockpit.preview');
    expect(g.message.title).toBe('Tap Preview to see exactly what you’ll share, then tap Sharpen my highlight.');
    expect(g.keepClear).toContain('[data-testid="cockpit-cta-ring"]');
  });

  it('watching the preview names Close preview', () => {
    const g = resolveGuide({ screen: 'focus', local: fl({ previewing: true, hasPreviewPlayedThrough: false }) });
    expect(g.message.title).toBe('Watch it through. Tap Close preview to change anything.');
  });
});
