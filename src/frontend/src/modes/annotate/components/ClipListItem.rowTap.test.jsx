import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClipListItem } from './ClipListItem';

// T17170:C3: on a phone the whole plays-list row jumps to and selects the play
// (the separate green Jump button is gone); the info button keeps its own action.
const region = { id: 'p1', startTime: 14, endTime: 22, rating: 4, tags: [], notes: '', name: 'Play' };

describe('ClipListItem row tap (T17170:C3)', () => {
  it('tapping anywhere on the mobile row jumps to the play', () => {
    const onJumpToClip = vi.fn();
    const onViewDetails = vi.fn();
    render(<ClipListItem region={region} index={0} isSelected={false} isMobile onClick={() => {}}
      onJumpToClip={onJumpToClip} onViewDetails={onViewDetails} />);
    fireEvent.click(screen.getByText('Play'));
    expect(onJumpToClip).toHaveBeenCalledTimes(1);
    expect(onViewDetails).not.toHaveBeenCalled();
  });

  it('the info button opens details without jumping; no separate Jump to play button', () => {
    const onJumpToClip = vi.fn();
    const onViewDetails = vi.fn();
    render(<ClipListItem region={region} index={0} isSelected={false} isMobile onClick={() => {}}
      onJumpToClip={onJumpToClip} onViewDetails={onViewDetails} />);
    fireEvent.click(screen.getByTitle('View details'));
    expect(onViewDetails).toHaveBeenCalledTimes(1);
    expect(onJumpToClip).not.toHaveBeenCalled();
    expect(screen.queryByTitle('Jump to play')).toBeNull();
  });

  it('the mobile row is at least 44px tall', () => {
    render(<ClipListItem region={region} index={0} isSelected={false} isMobile onJumpToClip={() => {}} />);
    expect(screen.getByTestId('clip-row').querySelector('.min-h-11')).not.toBeNull();
  });
});
