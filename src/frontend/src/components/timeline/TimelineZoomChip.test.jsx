import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimelineZoomChip } from './TimelineZoomChip';

// T10930: the one visible timeline-zoom control (- N% +; % resets).
describe('TimelineZoomChip', () => {
  it('shows the zoom and calls the three callbacks', () => {
    const onZoomIn = vi.fn(); const onZoomOut = vi.fn(); const onZoomReset = vi.fn();
    render(<TimelineZoomChip zoom={250} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onZoomReset={onZoomReset} />);
    expect(screen.getByTestId('timeline-zoom-reset').textContent).toBe('250%');
    fireEvent.click(screen.getByTestId('timeline-zoom-in'));
    fireEvent.click(screen.getByTestId('timeline-zoom-out'));
    fireEvent.click(screen.getByTestId('timeline-zoom-reset'));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onZoomReset).toHaveBeenCalledTimes(1);
  });

  it('disables zoom-out and reset at 100%, zoom-in at 500%', () => {
    const { rerender } = render(<TimelineZoomChip zoom={100} onZoomIn={() => {}} onZoomOut={() => {}} onZoomReset={() => {}} />);
    expect(screen.getByTestId('timeline-zoom-out').disabled).toBe(true);
    expect(screen.getByTestId('timeline-zoom-reset').disabled).toBe(true);
    expect(screen.getByTestId('timeline-zoom-in').disabled).toBe(false);
    rerender(<TimelineZoomChip zoom={500} onZoomIn={() => {}} onZoomOut={() => {}} onZoomReset={() => {}} />);
    expect(screen.getByTestId('timeline-zoom-in').disabled).toBe(true);
    expect(screen.getByTestId('timeline-zoom-out').disabled).toBe(false);
  });
});
