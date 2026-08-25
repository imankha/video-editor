import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { LockedReasonModal, LOCKED_KINDS } from '../LockedReasonModal';
import { SmartLockedCard } from '../SmartLockedCard';
import { RatioUnlockGroup } from '../RatioUnlockGroup';

// T7650: the four amber "locked" surfaces must be textually distinguishable so a
// user can tell WHY each is locked (bug 45p: "Top Plays locked meter reads as
// broken"). These assert per-`kind` copy, not shared boilerplate.

const setup = (props) =>
  render(<LockedReasonModal ratio="9:16" currentSec={4} onClose={() => {}} {...props} />);

describe('LockedReasonModal per-kind copy (T7650)', () => {
  it('ranking kind explains head-to-head ranking, not collections', () => {
    setup({ kind: LOCKED_KINDS.RANKING, name: 'Ranking Progress' });
    expect(screen.getAllByText(/head-to-head/i).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/one highlight reel/i)).toHaveLength(0);
  });

  it('smart kind names the collection and says it auto-gathers top-rated reels', () => {
    setup({ kind: LOCKED_KINDS.SMART, name: 'Top Plays' });
    expect(screen.getByText(/automatically gathers your top-rated reels/i)).toBeTruthy();
    // The collection name appears in the copy.
    expect(screen.getAllByText(/Top Plays/).length).toBeGreaterThan(0);
  });

  it('game kind talks about this game, not cross-game mixes', () => {
    setup({ kind: LOCKED_KINDS.GAME, name: 'Game Highlights' });
    expect(screen.getAllByText(/from this game/i).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/across your games/i)).toHaveLength(0);
  });

  it('mixes kind talks about combining reels across games', () => {
    setup({ kind: LOCKED_KINDS.MIXES, name: 'Mixes & compilations' });
    expect(screen.getAllByText(/across your games/i).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/from this game/i)).toHaveLength(0);
  });

  it('unknown/default kind falls back to the generic collections copy', () => {
    setup({ kind: 'something-else', name: 'Whatever' });
    expect(screen.getByText(/Collections unlock once a ratio has/i)).toBeTruthy();
  });

  it('caught-up footer (remaining 0) drops the "add more" nudge', () => {
    setup({ kind: LOCKED_KINDS.SMART, name: 'Top Plays', currentSec: 40 });
    expect(screen.getByText(/enough content/i)).toBeTruthy();
    expect(screen.queryByText(/Add about/i)).toBeNull();
  });
});

describe('locked cards carry a distinct subtitle (T7650)', () => {
  it('SmartLockedCard shows the top-rated subtitle (no longer subtitle-less)', () => {
    render(<SmartLockedCard name="Top Plays" ratio="9:16" currentSec={4} />);
    expect(screen.getByText(/top-rated reels/i)).toBeTruthy();
  });

  it('RatioUnlockGroup game subtitle differs from its mixes subtitle', () => {
    const { unmount } = render(
      <RatioUnlockGroup name="Game Highlights" ratio="9:16" currentSec={4} reels={[]} renderCard={() => null} />,
    );
    expect(screen.getByText(/unlock game highlights/i)).toBeTruthy();
    unmount();

    render(
      <RatioUnlockGroup
        name="Mixes & compilations"
        kind={LOCKED_KINDS.MIXES}
        ratio="9:16"
        currentSec={4}
        reels={[]}
        renderCard={() => null}
      />,
    );
    // The mixes card must NOT claim "game highlights" (the pre-T7650 copy bug).
    expect(screen.queryByText(/unlock game highlights/i)).toBeNull();
    expect(screen.getByText(/cross-game mixes/i)).toBeTruthy();
  });
});
