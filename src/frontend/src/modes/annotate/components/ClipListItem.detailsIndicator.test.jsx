import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClipListItem } from './ClipListItem';

// T9630 AC4: the compact list row previously gave zero signal that a saved
// clip carries tags/notes — the only way to find out was to open the details
// editor. This pins the new indicator + its absence for a plain clip.

const region = { id: 'c1', startTime: 0, endTime: 5, rating: 4, my_athlete: true };

describe('ClipListItem — tags/notes indicator (T9630 AC4)', () => {
  it('shows a tag count when the clip has tags', () => {
    render(
      <ClipListItem region={{ ...region, tags: ['Goal', 'Assist'] }} index={0} isSelected={false} onClick={() => {}} />
    );
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('shows a note glyph when the clip has a note', () => {
    render(
      <ClipListItem region={{ ...region, notes: 'Great run down the wing' }} index={0} isSelected={false} onClick={() => {}} />
    );
    // The indicator's accessible name/title names the note explicitly.
    expect(screen.getByTitle(/has a note/i)).toBeTruthy();
  });

  it('shows both when the clip has tags AND a note', () => {
    render(
      <ClipListItem
        region={{ ...region, tags: ['Goal'], notes: 'Nice finish' }}
        index={0}
        isSelected={false}
        onClick={() => {}}
      />
    );
    expect(screen.getByTitle(/1 tag.*has a note/i)).toBeTruthy();
  });

  it('renders no indicator for a plain clip with no tags or notes', () => {
    render(<ClipListItem region={region} index={0} isSelected={false} onClick={() => {}} />);
    expect(screen.queryByTitle(/has a note/i)).toBeNull();
    // Whitespace-only notes count as no note (matches the AnnotateFullscreenOverlay hasNote check).
  });

  it('treats whitespace-only notes as no note', () => {
    render(<ClipListItem region={{ ...region, notes: '   ' }} index={0} isSelected={false} onClick={() => {}} />);
    expect(screen.queryByTitle(/has a note/i)).toBeNull();
  });
});
