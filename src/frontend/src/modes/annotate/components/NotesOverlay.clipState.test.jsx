import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotesOverlay } from './NotesOverlay';
import { CLIP_STAGE } from '../clipStage';

// T10920: the Review-plays banner marks, in its upper-right corner, what became
// of the play -- a check when its clip is published, a film glyph when a clip
// exists but is not published, nothing when the play has no clip.
const base = { name: 'Good Pass', notes: 'nice', rating: 4, isVisible: true };

describe('NotesOverlay clip-state mark (T10920)', () => {
  it('shows the published check for a PUBLISHED clip', () => {
    render(<NotesOverlay {...base} clipStage={CLIP_STAGE.PUBLISHED} />);
    expect(screen.getByTestId('notes-overlay-published').getAttribute('aria-label')).toBe('Published clip');
    expect(screen.queryByTestId('notes-overlay-clipped')).toBeNull();
  });

  it.each([CLIP_STAGE.FOCUS, CLIP_STAGE.SPOTLIGHT, CLIP_STAGE.FINAL])(
    'shows the clipped-not-published glyph for %s',
    (stage) => {
      render(<NotesOverlay {...base} clipStage={stage} />);
      expect(screen.getByTestId('notes-overlay-clipped').getAttribute('aria-label')).toBe('Clip created, not published yet');
      expect(screen.queryByTestId('notes-overlay-published')).toBeNull();
    },
  );

  it('draws no mark for a play with no clip (NO_PROJECT) or no stage', () => {
    const { unmount } = render(<NotesOverlay {...base} clipStage={CLIP_STAGE.NO_PROJECT} />);
    expect(screen.queryByTestId('notes-overlay-published')).toBeNull();
    expect(screen.queryByTestId('notes-overlay-clipped')).toBeNull();
    unmount();
    render(<NotesOverlay {...base} />);
    expect(screen.queryByTestId('notes-overlay-published')).toBeNull();
    expect(screen.queryByTestId('notes-overlay-clipped')).toBeNull();
  });
});
