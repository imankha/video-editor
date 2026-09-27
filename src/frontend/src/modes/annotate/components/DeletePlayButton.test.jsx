import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeletePlayButton } from './DeletePlayButton';

// T10610 § D.1: the one delete-with-confirm control shared by the sidebar and
// every overlay layout. T11150: the label is always "Delete play" now — the
// old hasProject-gated "Delete clip" label named the object being deleted
// ("clip"), which the Play editor hierarchy task removes from the editor.

describe('DeletePlayButton (T10610/T11150)', () => {
  it('full variant: always labels "Delete play"', () => {
    render(<DeletePlayButton onDelete={vi.fn()} />);
    expect(screen.getByText('Delete play')).toBeTruthy();
  });

  it('does not call onDelete until Confirm Delete is clicked', () => {
    const onDelete = vi.fn();
    render(<DeletePlayButton onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId('delete-play-button'));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm Delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('Cancel dismisses the confirm without calling onDelete', () => {
    const onDelete = vi.fn();
    render(<DeletePlayButton onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId('delete-play-button'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText('Confirm Delete')).toBeNull();
    expect(screen.getByTestId('delete-play-button')).toBeTruthy();
  });

  it('icon variant renders no visible text label, only a title', () => {
    render(<DeletePlayButton onDelete={vi.fn()} variant="icon" />);
    const btn = screen.getByTestId('delete-play-button');
    expect(btn.getAttribute('title')).toBe('Delete play');
    expect(btn.textContent).toBe('');
  });

  it('icon variant confirm swap also gates onDelete behind Confirm', () => {
    const onDelete = vi.fn();
    render(<DeletePlayButton onDelete={onDelete} variant="icon" />);
    fireEvent.click(screen.getByTestId('delete-play-button'));
    const confirm = screen.getByTestId('delete-play-confirm');
    fireEvent.click(confirm.querySelector('[title="Confirm Delete"]'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
