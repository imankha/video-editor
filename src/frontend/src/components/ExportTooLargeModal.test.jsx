import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ExportTooLargeModal } from './ExportTooLargeModal';
import { EXPORT_TOO_LARGE } from '../config/displayNames';

/**
 * T11330: the explanatory popup shown when the T11320 preflight guard rejects an export as
 * too large. It must give the WHY, concrete next steps, name the worst-offending clips, state
 * the (net-zero) credit outcome — and must NOT close on a backdrop click (project convention).
 */

const rejection = {
  code: 'export_too_large',
  message: 'This export needs an estimated 4200s of GPU time, over the 2880s safe limit.',
  estimated_gpu_seconds: 4200.0,
  budget_seconds: 2880.0,
  modal_timeout_seconds: 3600.0,
  budget_fraction: 0.8,
  biggest_contributors: [
    { clip_index: 3, clip_name: 'Big Dunk', frame_count: 170, crop_width: 1920, crop_height: 1080, estimated_gpu_seconds: 600.0 },
    { clip_index: 1, clip_name: 'Fast Break', frame_count: 170, crop_width: 1920, crop_height: 1080, estimated_gpu_seconds: 480.0 },
  ],
};

afterEach(cleanup);

describe('ExportTooLargeModal (T11330)', () => {
  it('renders nothing when closed or without a rejection payload', () => {
    const { container: c1 } = render(<ExportTooLargeModal isOpen={false} rejection={rejection} onDismiss={() => {}} />);
    expect(c1.querySelector('[data-testid="export-too-large-modal"]')).toBeNull();
    cleanup();
    const { container: c2 } = render(<ExportTooLargeModal isOpen rejection={null} onDismiss={() => {}} />);
    expect(c2.querySelector('[data-testid="export-too-large-modal"]')).toBeNull();
  });

  it('shows the why, the concrete next steps, and the honest credit note', () => {
    render(<ExportTooLargeModal isOpen rejection={rejection} projectName="My Reel" onDismiss={() => {}} />);
    expect(screen.getByText(EXPORT_TOO_LARGE.TITLE)).toBeTruthy();
    expect(screen.getByTestId('export-too-large-why').textContent).toBe(EXPORT_TOO_LARGE.WHY);
    expect(screen.getByText(EXPORT_TOO_LARGE.SUGGESTION_CROP)).toBeTruthy();
    // Two contributors -> the split suggestion is actionable and shown.
    expect(screen.getByTestId('export-too-large-split')).toBeTruthy();
    // Credit outcome is stated (Step 4 decision a: net zero, reserved credits refunded).
    expect(screen.getByTestId('export-too-large-credit-note').textContent).toBe(EXPORT_TOO_LARGE.CREDIT_NOTE);
    expect(screen.getByText('My Reel')).toBeTruthy();
  });

  it('names the worst-offending clips with their crop size and an approximate time', () => {
    render(<ExportTooLargeModal isOpen rejection={rejection} onDismiss={() => {}} />);
    const contributors = screen.getByTestId('export-too-large-contributors').textContent;
    expect(contributors).toContain('Big Dunk');
    expect(contributors).toContain('1920x1080 crop');
    // 600s -> "about 10 min", derived from the payload (no magic threshold).
    expect(contributors).toContain('about 10 min');
  });

  it('falls back to "Clip N" when a contributor has no name', () => {
    const noName = { ...rejection, biggest_contributors: [{ clip_index: 4, crop_width: 810, crop_height: 1440, estimated_gpu_seconds: 90 }] };
    render(<ExportTooLargeModal isOpen rejection={noName} onDismiss={() => {}} />);
    // clip_index 4 -> "Clip 5" (1-based for humans).
    expect(screen.getByTestId('export-too-large-contributors').textContent).toContain('Clip 5');
  });

  it('hides the "split the batch" suggestion for a single-clip rejection (not actionable)', () => {
    const single = { ...rejection, biggest_contributors: [rejection.biggest_contributors[0]] };
    render(<ExportTooLargeModal isOpen rejection={single} onDismiss={() => {}} />);
    // Cropping is still offered; splitting one clip is not.
    expect(screen.getByText(EXPORT_TOO_LARGE.SUGGESTION_CROP)).toBeTruthy();
    expect(screen.queryByTestId('export-too-large-split')).toBeNull();
  });

  it('dismisses via the Got it button', () => {
    const onDismiss = vi.fn();
    render(<ExportTooLargeModal isOpen rejection={rejection} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('export-too-large-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does NOT close on a backdrop click (no backdrop-close convention)', () => {
    const onDismiss = vi.fn();
    const { container } = render(<ExportTooLargeModal isOpen rejection={rejection} onDismiss={onDismiss} />);
    // The outermost fixed overlay is the backdrop; clicking it must not dismiss.
    const backdrop = container.querySelector('.fixed.inset-0');
    fireEvent.click(backdrop);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
