import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SourceBar from './SourceBar';

// T17250:C1 -- lining up a second game video was only a small clock icon; the
// control carries words and says what it does on hover. T17700 renamed it Sync
// (owner ruling 2026-11-18) and shows it for cameras only.
const overlap = [
  { sequence: 1, name: 'Main camera', kind: 'main', virtualStart: 0, virtualEnd: 600, placedAtEnd: false, coversPlayhead: true },
  { sequence: 2, name: 'sideline', kind: 'angle', virtualStart: 100, virtualEnd: 300, placedAtEnd: false, coversPlayhead: true },
];

describe('SourceBar sync control (T17250:C1, T17700)', () => {
  it('T17250:C1 the sync control shows the word "Sync" with a plain tooltip', () => {
    render(<SourceBar videos={overlap} activeSequence={2} index={2} count={2} onFixTiming={vi.fn()} />);
    const btn = screen.getByTestId('source-bar-fix-timing');
    expect(btn.textContent).toBe('Sync cameras');
    expect(btn.getAttribute('title')).toBe('Make both cameras show the same moment');
  });
});
