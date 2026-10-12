import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { ToastContainer, useToastStore } from './Toast';

/**
 * T12540: a toast that lands on top of a control (Create share link, Done for now)
 * must be clearable with one tap on the toast itself, not only its 24px X.
 */
afterEach(() => { cleanup(); useToastStore.setState({ toasts: [] }); vi.useRealTimers(); });

describe('T12540 toast tap-to-dismiss', () => {
  it('dismisses a plain toast when its body is tapped', () => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [{ id: 1, type: 'success', title: 'Finished', duration: 0 }] });
    render(<ToastContainer stacked />);
    fireEvent.click(screen.getByText('Finished'));
    act(() => { vi.advanceTimersByTime(300); });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('does not dismiss when the toast action button is tapped by body handler alone', () => {
    const onClick = vi.fn();
    useToastStore.setState({ toasts: [{ id: 2, type: 'info', title: 'Ready', duration: 0, action: { label: 'Open', onClick } }] });
    render(<ToastContainer stacked />);
    fireEvent.click(screen.getByText('Open'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
