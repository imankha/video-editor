import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReferenceGameCard } from '../ReferenceGameCard';

const refGame = {
  id: 900,
  name: 'Vs Rivals Jul 1',
  created_at: '2026-07-01T12:00:00Z',
  is_reference: true,
  source_profile_id: 'prof-owner',
  source_game_id: 501,
  source_profile_name: 'Default',
  blake3_hash: 'a'.repeat(64),
  // References carry no expiry/clip state (T5800).
  clip_count: 0,
  storage_status: null,
  storage_expires_at: null,
  can_extend: false,
};

describe('ReferenceGameCard (T5820)', () => {
  let errSpy;
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
  });

  it('renders the owner-profile badge with a link affordance', () => {
    render(<ReferenceGameCard game={refGame} onOpen={vi.fn()} />);
    expect(screen.getByText('In Default')).toBeTruthy();
    // The card is a single link/button pointing at the owning profile.
    const card = screen.getByRole('button');
    expect(card.getAttribute('title')).toContain('Default');
  });

  it('shows the frozen game name', () => {
    render(<ReferenceGameCard game={refGame} onOpen={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(refGame.name);
  });

  // T7290 removed the owner's UPLOAD date from under the name (it contradicted the
  // match-date header this card sits under); T7330 puts the MATCH date there instead, so
  // reference cards and GameTiles don't disagree inside one group.
  it('renders the match date under the name, never the upload date', () => {
    const { container } = render(
      <ReferenceGameCard
        game={{ ...refGame, name: 'Vs Rivals Mar 21', game_date: '2026-03-21' }}
        onOpen={vi.fn()}
      />
    );
    const heading = screen.getByRole('heading', { level: 3 });

    expect(heading.nextElementSibling.textContent).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), Mar 21$/);
    // The owner's upload date ("Jul 1, 2026") and raw timestamps stay off the card.
    expect(container.textContent).not.toMatch(/Jul|2026-07-01/);
  });

  it('renders an EMPTY date line when the referenced game has no match date', () => {
    // The line stays (min-h reserves it) so a dateless card keeps the same scrim height
    // as its neighbors in the group -- but no upload date, no "Invalid Date" leaks in.
    render(<ReferenceGameCard game={{ ...refGame, game_date: null }} onOpen={vi.fn()} />);
    const line = screen.getByRole('heading', { level: 3 }).nextElementSibling;
    expect(line).not.toBeNull();
    expect(line.textContent.trim()).toBe('');
  });

  it('has NONE of the real tile actions — no kebab / edit / delete / recap / expiry chip', () => {
    render(<ReferenceGameCard game={refGame} onOpen={vi.fn()} />);
    expect(screen.queryByLabelText('More actions')).toBeNull();
    expect(screen.queryByText('Edit game')).toBeNull();
    expect(screen.queryByText('Delete game')).toBeNull();
    expect(screen.queryByText('Watch recap')).toBeNull();
    expect(screen.queryByText('Extend storage')).toBeNull();
    expect(screen.queryByText(/Expired|\dd$/)).toBeNull();
    // No "N clips" line — a reference has no local clips.
    expect(screen.queryByText(/clip/i)).toBeNull();
  });

  it('clicking the card fires onOpen with the game (the navigation gesture)', () => {
    const onOpen = vi.fn();
    render(<ReferenceGameCard game={refGame} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(refGame);
  });

  it('warns loudly (no silent placeholder) when source_profile_name is missing', () => {
    const broken = { ...refGame, source_profile_name: null };
    render(<ReferenceGameCard game={broken} onOpen={vi.fn()} />);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toContain('source_profile_name');
    // Still renders a card (degrades visibly, not blank).
    expect(screen.getByRole('button')).toBeTruthy();
  });

  // Regression: found on REAL prod data (arshia, 2026-08-01). The DEFAULT profile
  // is legitimately unnamed, so source_profile_name comes back as ''. That is
  // normal data, not a backend bug — it must NOT log an error, and the badge must
  // say "In Default" (the app's existing label for that profile) rather than the
  // vague "In another profile" reserved for a genuinely unresolved name.
  it('labels an UNNAMED owning profile "Default" without warning', () => {
    const unnamed = { ...refGame, source_profile_name: '' };
    render(<ReferenceGameCard game={unnamed} onOpen={vi.fn()} />);

    expect(errSpy).not.toHaveBeenCalled();
    expect(screen.getByText('In Default')).toBeTruthy();
    expect(screen.queryByText(/another profile/)).toBeNull();
    // Reads naturally (no stray possessive) in the hover title.
    expect(screen.getByRole('button').getAttribute('title')).toBe('Open in Default profile');
  });
});
