import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeletePlayButton } from './DeletePlayButton';

// T10610 § D.1: the one delete-with-confirm control shared by the sidebar and
// every overlay layout.

describe('DeletePlayButton (T10610)', () => {
  it('full variant: labels "Delete play" when the region has no project', () => {
    render(<DeletePlayButton hasProject={false} onDelete={vi.fn()} />);
    expect(screen.getByText('Delete play')).toBeTruthy();
  });

  it('full variant: labels "Delete clip" when the region has a project', () => {
    render(<DeletePlayButton hasProject onDelete={vi.fn()} />);
    expect(screen.getByText('Delete clip')).toBeTruthy();
  });

  it('does not call onDelete until Confirm Delete is clicked', () => {
    const onDelete = vi.fn();
    render(<DeletePlayButton hasProject={false} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId('delete-play-button'));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm Delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('Cancel dismisses the confirm without calling onDelete', () => {
    const onDelete = vi.fn();
    render(<DeletePlayButton hasProject={false} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId('delete-play-button'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText('Confirm Delete')).toBeNull();
    expect(screen.getByTestId('delete-play-button')).toBeTruthy();
  });

  it('icon variant renders no visible text label, only a title', () => {
    render(<DeletePlayButton hasProject={false} onDelete={vi.fn()} variant="icon" />);
    const btn = screen.getByTestId('delete-play-button');
    expect(btn.getAttribute('title')).toBe('Delete play');
    expect(btn.textContent).toBe('');
  });

  it('icon variant confirm swap also gates onDelete behind Confirm', () => {
    const onDelete = vi.fn();
    render(<DeletePlayButton hasProject onDelete={onDelete} variant="icon" />);
    fireEvent.click(screen.getByTestId('delete-play-button'));
    const confirm = screen.getByTestId('delete-play-confirm');
    fireEvent.click(confirm.querySelector('[title="Confirm Delete"]'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
