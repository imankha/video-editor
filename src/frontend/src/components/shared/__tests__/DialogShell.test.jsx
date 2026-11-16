import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DialogShell } from '../DialogShell';
import { Spinner } from '../Spinner';
import { Button } from '../Button';
import { Z } from '../../../constants/zLayers';

// T4560: the one shared dialog shell. It owns the backdrop (never closes on click),
// Escape (only when the caller passes onClose), the z-layer, the portal, the dialog
// role and focus, and the bottom-sheet variant for phones.
describe('DialogShell (T4560)', () => {
  it('portals a role=dialog aria-modal panel to document.body at Z.MODAL by default', () => {
    const { container } = render(
      <DialogShell isOpen ariaLabel="Hello" panelTestId="panel"><p>body</p></DialogShell>
    );
    const panel = screen.getByTestId('panel');
    expect(container.contains(panel)).toBe(false);
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-label')).toBe('Hello');
    expect(document.querySelector('[data-dialog-shell]').className).toContain(Z.MODAL);
  });

  it('inline renders in place instead of portaling', () => {
    const { container } = render(
      <DialogShell isOpen inline panelTestId="panel"><p>body</p></DialogShell>
    );
    expect(container.contains(screen.getByTestId('panel'))).toBe(true);
  });

  it('renders nothing when closed', () => {
    render(<DialogShell isOpen={false} panelTestId="panel"><p>body</p></DialogShell>);
    expect(screen.queryByTestId('panel')).toBeNull();
  });

  it('a backdrop click never calls onClose', () => {
    const onClose = vi.fn();
    render(<DialogShell isOpen onClose={onClose} backdropTestId="bd"><p>body</p></DialogShell>);
    fireEvent.click(screen.getByTestId('bd'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape calls onClose when given, and is a no-op without one', () => {
    const onClose = vi.fn();
    const { rerender } = render(<DialogShell isOpen onClose={onClose}><p>body</p></DialogShell>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<DialogShell isOpen><p>body</p></DialogShell>);
    expect(() => fireEvent.keyDown(document, { key: 'Escape' })).not.toThrow();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the panel on open and restores it on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(<DialogShell isOpen panelTestId="panel"><p>body</p></DialogShell>);
    expect(screen.getByTestId('panel').contains(document.activeElement)).toBe(true);
    rerender(<DialogShell isOpen={false} panelTestId="panel"><p>body</p></DialogShell>);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('sheet variant is a bottom sheet on phones and a centered card from sm up', () => {
    render(<DialogShell isOpen variant="sheet" panelTestId="panel"><p>body</p></DialogShell>);
    const root = document.querySelector('[data-dialog-shell]');
    expect(root.className).toContain('items-end');
    expect(root.className).toContain('sm:items-center');
    expect(screen.getByTestId('panel').className).toContain('rounded-t-2xl');
  });
});

describe('Spinner (T4560)', () => {
  it('is the one spinner, and Button loading renders it', () => {
    const { container } = render(<Spinner size={20} />);
    const svg = container.querySelector('svg[data-spinner]');
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('class')).toContain('animate-spin');
    render(<Button loading>Save</Button>);
    expect(screen.getByRole('button').querySelector('svg[data-spinner]')).toBeTruthy();
  });
});
