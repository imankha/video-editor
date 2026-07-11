/**
 * T4760: the Pick affordance's effective tap target is the whole bottom name+info+
 * button block, not just the 44/48px button -- near-misses now register. The clip
 * video stays watch-only (tapping it never picks).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { ReelMatchCard } from './ReelMatchCard';
import { HeroMatchup } from './HeroMatchup';

const SIDE_A = { id: 1, name: 'Brilliant Interception', stream_url: '', minute: 12, tags: ['tackle'] };
const SIDE_B = { id: 2, name: 'Cheeky Nutmeg', stream_url: '', minute: 34, tags: ['skill'] };

afterEach(cleanup);

describe('ReelMatchCard pick hit area (T4760)', () => {
  it('picks when the enlarged bottom target (not just the button) is tapped', () => {
    const onPick = vi.fn();
    render(<ReelMatchCard side={SIDE_A} onPick={onPick} onReplay={() => {}} />);

    const target = screen.getByTestId('reel-pick-target');
    // The whole name+info+button block is one clickable target.
    fireEvent.click(target);
    expect(onPick).toHaveBeenCalledTimes(1);

    // Tapping the name text (inside the target) also picks -- and fires onPick ONCE,
    // proving there is a single handler (no button/wrapper double-fire).
    onPick.mockClear();
    fireEvent.click(screen.getByText('Brilliant Interception'));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('does NOT pick when the clip video area is tapped (watch-only rule preserved)', () => {
    const onPick = vi.fn();
    const { container } = render(<ReelMatchCard side={SIDE_A} onPick={onPick} onReplay={() => {}} />);

    // The video sits above the pick target; a tap there must not pick.
    const video = container.querySelector('video');
    expect(video).toBeTruthy();
    fireEvent.click(video);
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe('HeroMatchup pick hit area + gate (T4760)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const renderHero = (onPick) =>
    render(<HeroMatchup pair={{ a: SIDE_A, b: SIDE_B }} wonId={null} onPick={onPick} onReplay={() => {}} />);

  it('does not pick while the pick gate is counting down, then picks after it clears', () => {
    const onPick = vi.fn();
    renderHero(onPick);

    // Intro modal is up first; dismiss it ("Got it") to start the gate countdown.
    fireEvent.click(screen.getByText('Got it'));

    const target = screen.getByTestId('hero-pick-target');
    // During the gate: tapping the target must not pick.
    fireEvent.click(target);
    expect(onPick).not.toHaveBeenCalled();

    // Let the gate (PICK_GATE_SEC = 3s) elapse.
    act(() => { vi.advanceTimersByTime(3500); });

    fireEvent.click(screen.getByTestId('hero-pick-target'));
    expect(onPick).toHaveBeenCalledTimes(1);
    // Picks the shown clip vs the other.
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ id: SIDE_A.id }),
      expect.objectContaining({ id: SIDE_B.id }),
    );
  });
});
