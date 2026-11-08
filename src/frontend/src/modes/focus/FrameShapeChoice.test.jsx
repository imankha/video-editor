import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FrameShapeChoice from './FrameShapeChoice';

describe('T14770 FrameShapeChoice: switching shape with positions asks first', () => {
  it('no positions yet: tapping the other shape calls onChange immediately, no confirm dialog', () => {
    const onChange = vi.fn();
    render(<FrameShapeChoice aspectRatio="9:16" hasPositions={false} onChange={onChange} onChosen={vi.fn()} />);
    fireEvent.click(screen.getByTestId('focus-shape-option-landscape'));
    expect(onChange).toHaveBeenCalledWith('16:9');
    expect(screen.queryByTestId('focus-shape-switch-confirm')).toBeNull();
  });

  it('positions exist: tapping the chip to switch shows a confirm dialog instead of calling onChange', () => {
    const onChange = vi.fn();
    render(<FrameShapeChoice aspectRatio="9:16" hasPositions onChange={onChange} onChosen={vi.fn()} />);
    fireEvent.click(screen.getByTestId('focus-shape-chip'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('focus-shape-switch-confirm')).toBeTruthy();
  });

  it('confirming the switch calls onChange with the new ratio', () => {
    const onChange = vi.fn();
    render(<FrameShapeChoice aspectRatio="9:16" hasPositions onChange={onChange} onChosen={vi.fn()} />);
    fireEvent.click(screen.getByTestId('focus-shape-chip'));
    fireEvent.click(screen.getByTestId('focus-shape-switch-confirm-button'));
    expect(onChange).toHaveBeenCalledWith('16:9');
    expect(screen.queryByTestId('focus-shape-switch-confirm')).toBeNull();
  });

  it('keeping the current shape dismisses the dialog without calling onChange', () => {
    const onChange = vi.fn();
    render(<FrameShapeChoice aspectRatio="9:16" hasPositions onChange={onChange} onChosen={vi.fn()} />);
    fireEvent.click(screen.getByTestId('focus-shape-chip'));
    fireEvent.click(screen.getByTestId('focus-shape-switch-keep'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('focus-shape-switch-confirm')).toBeNull();
  });

  it('onChosen fires on first pick this session even when re-picking the already-selected shape', () => {
    const onChosen = vi.fn();
    render(<FrameShapeChoice aspectRatio="9:16" hasPositions={false} onChange={vi.fn()} onChosen={onChosen} />);
    fireEvent.click(screen.getByTestId('focus-shape-option-portrait'));
    expect(onChosen).toHaveBeenCalledTimes(1);
  });
});
