import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClipListItem } from './ClipListItem';

// T5700: layer chip (MY ATHLETE / TEAM via uppercase CSS) + "Shared by" coexistence.
// The chip and the purple attribution pill are BOTH shrink-0 so a long clip
// NAME truncates first — never the layer identity or the provenance.
const LONG_NAME = 'Incredible give-and-go through the midfield ending in a screamer from outside the box';

describe('ClipListItem — layer chip (T5700)', () => {
  it('renders the My Athlete chip when my_athlete is true', () => {
    render(<ClipListItem region={{ id: 'c1', rating: 4, name: 'Clip', my_athlete: true }} index={0} isSelected={false} />);
    expect(screen.getByTitle('My Athlete layer')).toBeTruthy();
  });

  it('defaults to the My Athlete chip when my_athlete is undefined/null (legacy rule)', () => {
    render(<ClipListItem region={{ id: 'c1', rating: 4, name: 'Clip' }} index={0} isSelected={false} />);
    expect(screen.getByTitle('My Athlete layer')).toBeTruthy();
  });

  it('renders the Team chip when my_athlete is false', () => {
    render(<ClipListItem region={{ id: 'c1', rating: 4, name: 'Clip', my_athlete: false }} index={0} isSelected={false} />);
    expect(screen.getByTitle('Team layer')).toBeTruthy();
  });

  describe('imported clip (shared_by) — chip + attribution coexistence', () => {
    it('desktop: shows the Team chip AND the inline "Shared by" pill, both shrink-0, name truncates', () => {
      const { container } = render(
        <ClipListItem
          region={{ id: 'c1', rating: 4, name: LONG_NAME, my_athlete: false, shared_by: 'Dana Smith' }}
          index={0}
          isSelected={false}
          isMobile={false}
        />
      );
      expect(screen.getByTitle('Team layer')).toBeTruthy();
      const sharedPill = screen.getByTitle('Shared by Dana Smith');
      expect(sharedPill).toBeTruthy();
      expect(sharedPill.className).toContain('shrink-0');

      const chipWrapper = container.querySelector('[title="Team layer"]').parentElement;
      expect(chipWrapper.className).toContain('shrink-0');

      // The name lives in a min-w-0 flex-1 truncate span so it shrinks first.
      const nameSpan = screen.getByText(LONG_NAME).closest('span');
      expect(nameSpan.className).toContain('truncate');
      expect(nameSpan.className).toContain('min-w-0');
    });

    it('mobile: drops the inline rounded pill and shows "Shared by" on a second line instead', () => {
      render(
        <ClipListItem
          region={{ id: 'c1', rating: 4, name: LONG_NAME, my_athlete: false, shared_by: 'Dana Smith' }}
          index={0}
          isSelected={false}
          isMobile={true}
        />
      );
      expect(screen.getByTitle('Team layer')).toBeTruthy();
      // The desktop inline pill is a rounded-full badge; mobile instead renders
      // a plain second-line block — same text, different (non-pill) markup.
      const attribution = screen.getByText(/Shared by Dana Smith/);
      expect(attribution.className).not.toContain('rounded-full');
      expect(attribution.className).toContain('block');
    });

    it('a non-imported clip never renders "Shared by" anywhere', () => {
      render(<ClipListItem region={{ id: 'c1', rating: 4, name: 'Clip', my_athlete: false }} index={0} isSelected={false} />);
      expect(screen.queryByText(/Shared by/)).toBeNull();
    });
  });
});
