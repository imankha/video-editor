// T14570: a `confirm` action asks in the in-app dialog; the action runs only on yes.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Trash2 } from 'lucide-react';
import CtaBar from './CtaBar';

describe('CtaBar confirm action (T14570)', () => {
  beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(false); });
  afterEach(() => { vi.restoreAllMocks(); });

  function tapDelete(onClick) {
    render(<CtaBar destructive={{ icon: Trash2, title: 'Delete game', onClick, confirm: true }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete game' }));
  }
  const dialogYes = () => screen.getAllByRole('button', { name: 'Delete game' }).at(-1);

  it('T14570:C7 asks in the app and does not run the action yet', () => {
    const onClick = vi.fn();
    tapDelete(onClick);
    expect(screen.getByText('Delete game?')).toBeTruthy();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('T14570:C7 yes runs the action once with the original tap event', () => {
    const onClick = vi.fn();
    tapDelete(onClick);
    fireEvent.click(dialogYes());
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0].type).toBe('click');
    expect(screen.queryByText('Delete game?')).toBeNull();
  });

  it('T14570:C7 Cancel and Escape skip the action', () => {
    const onClick = vi.fn();
    tapDelete(onClick);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Delete game?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete game' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Delete game?')).toBeNull();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('T14570:C7 an action without confirm runs at once', () => {
    const onClick = vi.fn();
    render(<CtaBar primary={{ title: 'Go', onClick }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
