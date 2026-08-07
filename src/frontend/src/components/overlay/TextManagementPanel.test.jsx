import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import TextManagementPanel from './TextManagementPanel';

afterEach(() => cleanup());

const BLOCK_A = { id: 'a', index: 0, startTime: 1, endTime: 3, spec: { text: 'GOAL', align: 'center', position: { x: 0.5, y: 0.4 } }, enabled: true };
const BLOCK_B = { id: 'b', index: 1, startTime: 5, endTime: 7, spec: { text: 'ASSIST', align: 'center', position: { x: 0.5, y: 0.4 } }, enabled: false };

describe('TextManagementPanel — the single Text-tab management surface (T6630 round 3)', () => {
  it('the Add control adds at the CURRENT PLAYHEAD time (single add path)', () => {
    const onAddText = vi.fn();
    render(<TextManagementPanel blocks={[]} currentTime={4.5} onAddText={onAddText} />);
    fireEvent.click(screen.getByTestId('text-tab-add'));
    expect(onAddText).toHaveBeenCalledWith(4.5);
  });

  it('shows an empty state with no blocks', () => {
    render(<TextManagementPanel blocks={[]} />);
    expect(screen.getByText(/no text elements yet/i)).toBeTruthy();
  });

  it('lists every block with its text and start time', () => {
    render(<TextManagementPanel blocks={[BLOCK_A, BLOCK_B]} />);
    expect(screen.getByTestId('text-tab-row-0').textContent).toContain('GOAL');
    expect(screen.getByTestId('text-tab-row-1').textContent).toContain('ASSIST');
  });

  it('clicking a row selects it (same selection state the timeline/stage read)', () => {
    const onSelectText = vi.fn();
    render(<TextManagementPanel blocks={[BLOCK_A, BLOCK_B]} onSelectText={onSelectText} />);
    fireEvent.click(screen.getByTestId('text-tab-row-1'));
    expect(onSelectText).toHaveBeenCalledWith('b');
  });

  it('the per-row trash removes that block WITHOUT selecting it (no fall-through to select)', () => {
    const onSelectText = vi.fn();
    const onDeleteText = vi.fn();
    render(<TextManagementPanel blocks={[BLOCK_A]} onSelectText={onSelectText} onDeleteText={onDeleteText} />);
    fireEvent.click(screen.getByTitle('Delete text block'));
    expect(onDeleteText).toHaveBeenCalledWith('a');
    expect(onSelectText).not.toHaveBeenCalled();
  });

  it('the per-row eye toggles visibility without selecting', () => {
    const onSelectText = vi.fn();
    const onToggleText = vi.fn();
    // BLOCK_A is enabled -- clicking its eye should hide it (new enabled=false).
    render(<TextManagementPanel blocks={[BLOCK_A]} onSelectText={onSelectText} onToggleText={onToggleText} />);
    fireEvent.click(screen.getByTitle(/hide text/i));
    expect(onToggleText).toHaveBeenCalledWith('a', false);
    expect(onSelectText).not.toHaveBeenCalled();
  });

  it('shows the settings editor (with the position grid) only for the SELECTED block', () => {
    const { rerender } = render(<TextManagementPanel blocks={[BLOCK_A]} selectedTextId={null} />);
    expect(screen.queryByTestId('text-position-grid')).toBeNull();

    rerender(<TextManagementPanel blocks={[BLOCK_A]} selectedTextId="a" onUpdateTextSpec={() => {}} />);
    expect(screen.getByTestId('text-position-grid')).toBeTruthy();
  });

  it('editing the position grid for the selected block calls onUpdateTextSpec with that block id', () => {
    const onUpdateTextSpec = vi.fn();
    render(<TextManagementPanel blocks={[BLOCK_A]} selectedTextId="a" onUpdateTextSpec={onUpdateTextSpec} />);
    fireEvent.click(screen.getByTestId('text-position-top-left'));
    expect(onUpdateTextSpec).toHaveBeenCalledTimes(1);
    expect(onUpdateTextSpec.mock.calls[0][0]).toBe('a');
    expect(onUpdateTextSpec.mock.calls[0][1].position).toEqual({ x: 0.08, y: 0.08 });
  });
});
