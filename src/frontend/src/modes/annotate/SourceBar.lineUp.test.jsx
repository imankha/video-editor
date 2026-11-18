import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SourceBar from './SourceBar';

// T17250:C1 -- lining up a second game video was only a small clock icon; the
// control now carries the words "Line up" and says what it does on hover.
const sequential = [
  { sequence: 1, name: 'IMG_4412', kind: 'main', virtualStart: 0, virtualEnd: 18.84, placedAtEnd: false, coversPlayhead: false },
  { sequence: 2, name: 'second half', kind: 'main', virtualStart: 18.84, virtualEnd: 5135.7, placedAtEnd: true, coversPlayhead: false },
];

describe('SourceBar line-up control (T17250:C1)', () => {
  it('T17250:C1 the line-up control shows the words "Line up" with a plain tooltip', () => {
    render(<SourceBar videos={sequential} activeSequence={2} index={2} count={2} onFixTiming={vi.fn()} />);
    const btn = screen.getByTestId('source-bar-fix-timing');
    expect(btn.textContent).toBe('Line up');
    expect(btn.getAttribute('title')).toBe('Line up this video with the game');
  });
});
