import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClipDetailsEditor } from './ClipDetailsEditor';

// jsdom lacks matchMedia; ClipDetailsEditor renders through the real useIsMobile hook.
beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
});

// T5700: the per-clip Layer segmented control replaces the old on/off My
// Athlete switch, is shown on desktop AND mobile (no !isMobile guard), and is
// locked read-only on imported clips (shared_by set) — they can never be
// promoted onto the My Athlete layer.
const baseRegion = {
  id: 'c1',
  startTime: 0,
  endTime: 10,
  rating: 4,
  tags: [],
  notes: '',
  name: 'Test clip',
};

describe('ClipDetailsEditor — Layer control (T5700)', () => {
  it('defaults to My Athlete selected when my_athlete is undefined/null (legacy rule)', () => {
    render(<ClipDetailsEditor region={{ ...baseRegion, my_athlete: undefined }} onUpdate={() => {}} onDelete={() => {}} />);
    expect(screen.getByRole('radio', { name: 'My player' }).getAttribute('aria-checked')).toBe('true');
  });

  it('shows Team selected when my_athlete is false', () => {
    render(<ClipDetailsEditor region={{ ...baseRegion, my_athlete: false }} onUpdate={() => {}} onDelete={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Team' }).getAttribute('aria-checked')).toBe('true');
  });

  it('calls onUpdate({ my_athlete }) with ONLY that field on click (gesture-based surgical save)', () => {
    const onUpdate = vi.fn();
    render(<ClipDetailsEditor region={{ ...baseRegion, my_athlete: true }} onUpdate={onUpdate} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Team' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ my_athlete: false });
  });

  describe('imported clip (shared_by set)', () => {
    it('locks the control to Team and disables both segments', () => {
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, my_athlete: false, shared_by: 'Dana Smith' }}
          onUpdate={() => {}}
          onDelete={() => {}}
        />
      );
      const mine = screen.getByRole('radio', { name: /^My player/ });
      const team = screen.getByRole('radio', { name: /^Team/ });
      expect(mine.disabled).toBe(true);
      expect(team.disabled).toBe(true);
      expect(screen.getByRole('radiogroup').getAttribute('title')).toContain('Dana Smith');
    });

    it('never calls onUpdate when a disabled segment is clicked (no request sent)', () => {
      const onUpdate = vi.fn();
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, my_athlete: false, shared_by: 'Dana Smith' }}
          onUpdate={onUpdate}
          onDelete={() => {}}
        />
      );
      fireEvent.click(screen.getByRole('radio', { name: /^My player/ }));
      fireEvent.click(screen.getByRole('radio', { name: /^Team/ }));
      expect(onUpdate).not.toHaveBeenCalled();
    });
  });

  it('a non-imported clip (no shared_by) stays interactive', () => {
    render(<ClipDetailsEditor region={{ ...baseRegion, my_athlete: false, shared_by: null }} onUpdate={() => {}} onDelete={() => {}} />);
    expect(screen.getByRole('radio', { name: /^My player/ }).disabled).toBe(false);
    expect(screen.getByRole('radio', { name: /^Team/ }).disabled).toBe(false);
  });
});

// T8490: edit-mode caption mirrors the Add Play sheet's, but reads off
// hasReel (region.autoProjectId) instead of promising a future "will be
// created" — the reel either already exists or the Reel control below is the
// live action to create one.
describe('ClipDetailsEditor — rating caption (T8490)', () => {
  it('rating 2 shows the "Technical lapse" learn-from caption', () => {
    render(<ClipDetailsEditor region={{ ...baseRegion, rating: 2, my_athlete: true }} onUpdate={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('Technical lapse (?) - a play to learn from.')).toBeTruthy();
  });

  it('rating 4 shows the "Good play" one-more-star caption', () => {
    render(<ClipDetailsEditor region={{ ...baseRegion, rating: 4, my_athlete: true }} onUpdate={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('Good play (!) - one more star creates a clip.')).toBeTruthy();
  });

  it('rating 5 + My Athlete + no clip yet points at the Clip control below, never "will be created"', () => {
    render(
      <ClipDetailsEditor
        region={{ ...baseRegion, rating: 5, my_athlete: true, autoProjectId: null }}
        onUpdate={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByText('Brilliant play (!!) - create a clip below.')).toBeTruthy();
  });

  it('rating 5 + My Athlete + clip already exists says so, does not re-offer creation', () => {
    render(
      <ClipDetailsEditor
        region={{ ...baseRegion, rating: 5, my_athlete: true, autoProjectId: 42 }}
        onUpdate={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByText('Brilliant play (!!) - clip already created from play.')).toBeTruthy();
  });

  it('rating 5 + Team shows the team-plays-dont-create-clips caption', () => {
    render(
      <ClipDetailsEditor
        region={{ ...baseRegion, rating: 5, my_athlete: false, autoProjectId: null }}
        onUpdate={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByText("Brilliant team play (!!) - team plays don't create clips.")).toBeTruthy();
  });
});
