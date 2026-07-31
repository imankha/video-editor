import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReferenceGameCard } from '../ReferenceGameCard';

const refGame = {
  id: 900,
  name: 'Vs Rivals Jul 1',
  created_at: '2026-07-01T12:00:00Z',
  is_reference: true,
  source_profile_id: 'prof-owner',
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
});
