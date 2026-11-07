// T14620: Frame and paid-step copy follows the copy glossary
// (.claude/references/copy-glossary.md). "Make highlight" opens Frame; the paid AI step is
// "Sharpen my highlight" everywhere, so the two never share a label.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as names from './displayNames';
import { exportFailureCopy } from '../utils/userError';
import ExportButtonView from '../components/ExportButtonView';
import { HighlightEntry } from '../modes/annotate/components/HighlightOrientationSlots';

const {
  ANNOTATE, CREDITS, EDITOR_PANELS, ERROR_COPY, EXPORT_JOBS, EXPORT_PROGRESS, EXPORT_TOO_LARGE,
  FOCUS_COCKPIT, FOCUS_HINTS, FOCUS_PREVIEW, FOCUS_PUBLISH, FRAMING_GUIDE, FRAME_COPY, GUIDE,
  MODE_NAMES, MODE_SWITCH_DIALOG, OVERLAY_REAPPLY_FOCUS_TOAST, STAGE_REASONS,
} = names;

const BANNED = /\b(focus|focus points?|generat\w*|exports?|exporting|keyframes?|segments?|boundar\w+|crop box|crop|render\w*|rebuild|re-creat\w*|re-generate|upscal\w*|billed|slo-mo|spots|pan\/zoom|setup|clips?|gpu)\b|--|\bCould not\b/i;

const flatten = (obj) => Object.values(obj).flatMap((v) => {
  if (typeof v === 'string') return [v];
  if (typeof v === 'function') return [String(v(2, 3, false))];
  if (v && typeof v === 'object') return flatten(v);
  return [];
});

const source = (rel) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

const viewProps = {
  isCurrentlyExporting: false, isExporting: false, isExternallyExporting: false,
  displayProgress: 0, displayMessage: '', error: null, failedExport: null,
  disconnected: false, reconnectionFailed: false, retrying: false, isFramingMode: true,
  isButtonDisabled: false, buttonTitle: undefined, includeAudio: true,
  onExport: vi.fn(), onRetryConnection: vi.fn(), onDismissExport: vi.fn(), onAudioToggle: vi.fn(),
  EXPORT_CONFIG: { targetFps: 30 }, showInsufficientCredits: null,
  onCloseInsufficientCredits: vi.fn(), showBuyCredits: false, onOpenBuyCredits: vi.fn(),
  onCloseBuyCredits: vi.fn(), onPaymentSuccess: vi.fn(), handleExportRef: { current: null },
};

describe('T14620 Frame and paid-step copy', () => {
  it('T14620:C1 the button that opens Frame says Make highlight, in progress Continue highlight', () => {
    expect(ANNOTATE.FRAME_THIS_CLIP).toBe('Make highlight');
    expect(ANNOTATE.CONTINUE_HIGHLIGHT).toBe('Continue highlight');
    render(<HighlightEntry onMake={vi.fn()} />);
    expect(screen.getAllByText('Make highlight')).toHaveLength(1);
  });

  it('T14620:C2 the paid step is Sharpen my highlight on the button, in progress and when done', () => {
    expect(EXPORT_JOBS.framing.action).toBe('Sharpen my highlight');
    expect(EXPORT_JOBS.framing.inProgress).toBe('Sharpening your highlight...');
    expect(EXPORT_JOBS.framing.completed).toBe('Your highlight is ready');
    expect(EXPORT_PROGRESS.RENDERING).toBe('Sharpening your highlight...');
    expect(ANNOTATE.FRAME_THIS_CLIP).not.toBe(EXPORT_JOBS.framing.action);
    const { rerender } = render(<ExportButtonView {...viewProps} />);
    expect(screen.getByTestId('primary-cta').textContent).toContain('Sharpen my highlight');
    rerender(<ExportButtonView {...viewProps} isCurrentlyExporting isExporting />);
    expect(screen.getByTestId('primary-cta').textContent).toContain('Sharpening your highlight...');
  });

  it('T14620:C3 errors and cost lines use the same verb; a spotlight failure never says sharpen', () => {
    expect(ERROR_COPY.MAKE_HIGHLIGHT).toBe("We couldn't sharpen your highlight. Try again.");
    expect(ERROR_COPY.MAKE_HIGHLIGHT_REFUNDED).toContain("We couldn't sharpen your highlight.");
    expect(exportFailureCopy({ type: 'framing' })).toBe(ERROR_COPY.MAKE_HIGHLIGHT);
    expect(exportFailureCopy({ type: 'overlay' })).toBe("We couldn't add your spotlight. Try again.");
    expect(CREDITS.MIN_CHARGE).toMatch(/sharpen/);
    expect(CREDITS.PAID_HIGHLIGHT).toMatch(/^Sharpening/);
    render(<ExportButtonView {...viewProps} estimatedCredits={5} creditBalance={1} insufficientForEstimate />);
    expect(screen.getByTestId('export-credit-estimate').textContent).toMatch(/add credits to sharpen/i);
  });

  it('T14620:C4 the spotlight job never shows paid-step progress', () => {
    const container = source('containers/ExportButtonContainer.jsx');
    const overlayBranch = container.slice(container.indexOf('// Overlay mode'));
    expect(overlayBranch.slice(0, 1200)).toContain('EXPORT_PROGRESS.RENDERING_SPOTLIGHT');
    expect(overlayBranch.slice(0, 1200)).not.toMatch(/EXPORT_PROGRESS\.RENDERING\)/);
    expect(flatten(EXPORT_JOBS.overlay).join(' ')).not.toMatch(/sharpen|generat/i);
    expect(source('App.jsx')).toContain('MODE_SWITCH_DIALOG.ADD_SPOTLIGHT');
    expect(MODE_SWITCH_DIALOG.SHARPEN).toBe(EXPORT_JOBS.framing.action);
    expect(MODE_SWITCH_DIALOG.ADD_SPOTLIGHT).toBe(EXPORT_JOBS.overlay.action);
  });

  it('T14620:C5 box, positions, sections and Check framing replace the tool words', () => {
    expect(FOCUS_COCKPIT.ADD_FOCUS_POINT).toBe('Add position');
    expect(EDITOR_PANELS.FOCUS_POINT).toBe('Position');
    expect(EDITOR_PANELS.PREVIEW_HIGHLIGHT).toBe('Preview');
    expect(FOCUS_PREVIEW.BACK_TO_PREVIEW_LABEL).toBe('Watch highlight');
    expect(FRAME_COPY?.MOVE_VIDEO).toBe('Move the video');
    expect(FRAME_COPY?.MOVE_BOX).toBe('Move the box');
    expect(FRAME_COPY?.LENGTH_CHANGED).toBe('Length of your highlight. Credits are based on this.');
    expect(FRAME_COPY?.BOX_TOO_TIGHT).toBe('This box is very tight, so the sharpened video may look softer. Try a slightly wider box.');
    expect(MODE_NAMES.FRAMING).toBe('Zoom in');
  });

  it('T14620:C6 no retired word survives in Frame or paid-step constants', () => {
    const copy = [
      EXPORT_JOBS, EXPORT_PROGRESS, EXPORT_TOO_LARGE, FOCUS_COCKPIT, FOCUS_HINTS, FOCUS_PREVIEW,
      FOCUS_PUBLISH, FRAMING_GUIDE, FRAME_COPY ?? {}, GUIDE.focus, MODE_SWITCH_DIALOG,
      OVERLAY_REAPPLY_FOCUS_TOAST, CREDITS, STAGE_REASONS.FRAMING,
      { b: GUIDE.annotate.brilliant, p: GUIDE.annotate.preview, e: GUIDE.modal.exportTooLarge },
      {
        a: EDITOR_PANELS.FOCUS_POINT, b: EDITOR_PANELS.TRIM_AND_SLOWMO_HINT, c: EDITOR_PANELS.PREVIEW_CAPTION_FRAMING,
        d: EDITOR_PANELS.PREVIEW_DISCLOSURE, e: EDITOR_PANELS.FRAME_CLIP_HINT,
      },
    ].flatMap((c) => (typeof c === 'string' ? [c] : flatten(c)));
    expect(copy.filter((s) => BANNED.test(s))).toEqual([]);
  });

  it('T14620:C7 no inline retired copy is left in the Frame components', () => {
    const files = [
      'modes/FocusModeView.jsx', 'modes/focus/FocusTimeline.jsx', 'modes/focus/layers/SegmentLayer.jsx',
      'modes/focus/layers/CropLayer.jsx', 'modes/focus/overlays/CropOverlay.jsx', 'modes/focus/cockpit/FocusCockpit.jsx',
      'components/ExportButtonView.jsx', 'components/shared/SegmentedProgressStrip.jsx', 'components/CropControls.jsx',
      'components/settings/FocusSettingsPanel.jsx', 'components/DraftTile.jsx', 'containers/ExportButtonContainer.jsx',
      'services/ExportWebSocketManager.js', 'stores/exportStore.js', 'modes/annotate/clipStage.js',
    ];
    const retired = /Output length|Pan\/Zoom|Switch to Crop|crop box\.|Split Segments|Boundary at|Delete boundary|Trim segment|Keyframe at|sub-optimal upscale|Exporting\.\.\.|'Generating|Generating at|Generation still|Generation running|Starting generation|Loading working video|Video Error|Preview Highlight|View Highlight|before generating|Not Connected/;
    const hits = files.flatMap((f) => source(f).split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\{\/\*)/.test(line) && !/console\.|^\s*\*/.test(line) && retired.test(line))
      .map((line) => `${f}: ${line.trim()}`));
    expect(hits).toEqual([]);
  });

  it('T14620:C8 orientation slot labels are stored in sentence case, never rewritten at runtime', () => {
    const slots = source('modes/annotate/components/HighlightOrientationSlots.jsx');
    expect(slots).not.toMatch(/\.replace\(\//);
    for (const key of ['PORTRAIT', 'LANDSCAPE', 'ADD_SPOTLIGHT', 'CONTINUE_SPOTLIGHT', 'WATCH_HIGHLIGHT']) {
      expect(ANNOTATE[key]).toBe(ANNOTATE[key].charAt(0) + ANNOTATE[key].slice(1).toLowerCase());
    }
    expect(ANNOTATE.MAKE_ANOTHER_HIGHLIGHT).toBe('Make another highlight');
  });
});
