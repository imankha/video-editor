import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FrameShapeChoice from './FrameShapeChoice';

describe('T14770 FrameShapeChoice: first-run shape chooser', () => {
  it('no positions yet: tapping the other shape calls onChange immediately, no confirm dialog', () => {
    const onChange = vi.fn();
    render(<FrameShapeChoice aspectRatio="9:16" hasPositions={false} onChange={onChange} onChosen={vi.fn()} />);
    fireEvent.click(screen.getByTestId('focus-shape-option-landscape'));
    expect(onChange).toHaveBeenCalledWith('16:9');
    expect(screen.queryByTestId('focus-shape-switch-confirm')).toBeNull();
  });

  it('T17230: positions exist: the chooser is gone (no chip); Settings holds the shape', () => {
    const { container } = render(<FrameShapeChoice aspectRatio="9:16" hasPositions onChange={vi.fn()} onChosen={vi.fn()} />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByTestId('focus-shape-chip')).toBeNull();
  });

  it('onChosen fires on first pick this session even when re-picking the already-selected shape', () => {
    const onChosen = vi.fn();
    render(<FrameShapeChoice aspectRatio="9:16" hasPositions={false} onChange={vi.fn()} onChosen={onChosen} />);
    fireEvent.click(screen.getByTestId('focus-shape-option-portrait'));
    expect(onChosen).toHaveBeenCalledTimes(1);
  });
});
