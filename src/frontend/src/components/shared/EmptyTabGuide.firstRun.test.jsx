import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmptyTabGuide } from './EmptyTabGuide';
import { resolveGuide, homeFacts } from '../instructions/resolveGuide';
import { useSettingsStore } from '../../stores/settingsStore';
import { useCreditStore } from '../../stores/creditStore';
import { useProfileStore } from '../../stores/profileStore';
import { approxHighlights } from '../../config/pricing';

// T17200: a brand-new parent's Home. One clear start: "Start with your game video",
// one primary button (Upload game), a small "Upload a play" link for short videos,
// and the free-credits sentence shown once: in the coach with Guidance on, as plain
// text in the empty Games state with Guidance off.

const CREDIT_LINE = `You have 88 free credits, enough for about ${approxHighlights(88)} highlights.`;

function renderEmptyGames(coachEnabled, handlers = {}) {
  useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled } });
  const guide = resolveGuide(homeFacts({ tab: 'games', credits: 88 }));
  return render(
    <EmptyTabGuide tab="games" gamesCount={0} guide={coachEnabled ? guide : null}
      onAddGame={handlers.onAddGame ?? vi.fn()} onAddVideo={handlers.onAddVideo ?? vi.fn()} onNavigate={vi.fn()} />,
  );
}

describe('T17200 Home first run', () => {
  beforeEach(() => {
    useCreditStore.setState({ balance: 88, loaded: true });
    // A brand new account: exactly one profile, loaded (T17090).
    useProfileStore.setState({ profiles: [{ id: 'p1' }], isInitialized: true });
  });

  it('C1: headline "Start with your game video", a single primary button, and a small Upload a play link', () => {
    const onAddGame = vi.fn();
    const onAddVideo = vi.fn();
    renderEmptyGames(false, { onAddGame, onAddVideo });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Start with your game video');
    const buttons = screen.getAllByRole('button');
    expect(buttons.map(b => b.textContent)).toEqual(['Upload game', 'Only have short videos? Upload a play']);
    expect(screen.queryByText(/Skip ahead/)).toBeNull();
    const link = screen.getByRole('button', { name: 'Only have short videos? Upload a play' });
    expect(link.className).not.toMatch(/bg-cyan-500|bg-gray-700/);
    fireEvent.click(link);
    expect(onAddVideo).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Upload game' }));
    expect(onAddGame).toHaveBeenCalledTimes(1);
  });

  it('C2: Guidance on -- the coach sentence carries the credits, the plain line is not drawn too', () => {
    const guide = resolveGuide(homeFacts({ tab: 'games', credits: 88 }));
    expect(guide.message.title).toBe(`Upload your game to start. ${CREDIT_LINE}`);
    expect(guide.keepClear).toContain('[data-testid="credit-balance"]');
    renderEmptyGames(true);
    expect(screen.queryByTestId('home-credits-line')).toBeNull();
  });

  it('C2: Guidance off -- the same sentence shows as plain text in the empty Games state', () => {
    renderEmptyGames(false);
    expect(screen.getByTestId('home-credits-line').textContent).toBe(CREDIT_LINE);
  });

  it('T17090: a second profile on an existing account is not told it has free credits', () => {
    useProfileStore.setState({ profiles: [{ id: 'p1' }, { id: 'p2' }], isInitialized: true });
    renderEmptyGames(false);
    expect(screen.queryByTestId('home-credits-line')).toBeNull();
    expect(screen.queryByText(/free credits/)).toBeNull();
  });
});
