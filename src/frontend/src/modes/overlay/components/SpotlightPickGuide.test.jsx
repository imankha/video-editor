import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SpotlightPickGuide from './SpotlightPickGuide';
import { EDITOR_PANELS } from '../../../config/displayNames';

describe('SpotlightPickGuide (T11570)', () => {
  it('renders nothing when phase is null', () => {
    const { container } = render(<SpotlightPickGuide phase={null} step={null} total={0} />);
    expect(container.firstChild).toBeNull();
  });

  describe('picking (phase="parked")', () => {
    it('shows the click verb (mouse), step text, the "why" sub-line on step 1, and progress dots', () => {
      render(
        <SpotlightPickGuide
          phase="parked" step={1} total={3} assignedCount={0}
          progress={[false, false, false]} isTouch={false}
        />
      );
      expect(screen.getByTestId('spotlight-pick-guide').getAttribute('data-phase')).toBe('parked');
      expect(screen.getByTestId('pick-guide-text').textContent).toBe(EDITOR_PANELS.PICK_GUIDE_CLICK);
      expect(screen.getByTestId('pick-guide-step').textContent).toBe(EDITOR_PANELS.PICK_GUIDE_STEP(1, 3, false));
      expect(screen.getByText(EDITOR_PANELS.PICK_GUIDE_WHY)).toBeTruthy();
      expect(screen.getByTestId('pick-guide-not-boxed')).toBeTruthy();
    });

    it('shows the tap verb (touch) and the "again" sub-line after step 1', () => {
      render(
        <SpotlightPickGuide
          phase="parked" step={2} total={3} assignedCount={1}
          progress={[true, false, false]} isTouch
        />
      );
      expect(screen.getByTestId('pick-guide-text').textContent).toBe(EDITOR_PANELS.PICK_GUIDE_TAP);
      expect(screen.getByText(EDITOR_PANELS.PICK_GUIDE_AGAIN)).toBeTruthy();
    });

    it('drops the sub-line and the word "Step" when compact', () => {
      render(<SpotlightPickGuide phase="parked" step={2} total={4} compact />);
      expect(screen.getByTestId('pick-guide-step').textContent).toBe('2 of 4');
      expect(screen.queryByText(EDITOR_PANELS.PICK_GUIDE_WHY)).toBeNull();
      expect(screen.queryByText(EDITOR_PANELS.PICK_GUIDE_AGAIN)).toBeNull();
    });

    it('"Not boxed?" expands to the full drag instruction on tap, and collapses on the next step', () => {
      const { rerender } = render(<SpotlightPickGuide phase="parked" step={1} total={2} />);
      const btn = screen.getByTestId('pick-guide-not-boxed');
      expect(btn.textContent).toBe(EDITOR_PANELS.PICK_GUIDE_NOT_BOXED(false));
      fireEvent.click(btn);
      expect(btn.textContent).toBe(EDITOR_PANELS.PICK_GUIDE_DRAG);

      rerender(<SpotlightPickGuide phase="parked" step={2} total={2} />);
      expect(screen.getByTestId('pick-guide-not-boxed').textContent).toBe(EDITOR_PANELS.PICK_GUIDE_NOT_BOXED(false));
    });

    it('renders progress dots reflecting picked/active/unpicked state', () => {
      render(<SpotlightPickGuide phase="parked" step={2} total={3} progress={[true, false, false]} />);
      const dots = screen.getByTestId('pick-guide-progress-dots').querySelectorAll('.rounded-full');
      expect(dots).toHaveLength(3);
      expect(dots[0].className).toContain('bg-green-400'); // picked
      expect(dots[1].className).toContain('bg-white');     // active, unpicked
      expect(dots[2].className).toContain('bg-white/30');  // dim, unpicked
    });
  });

  describe('confirming (phase="confirm")', () => {
    it('shows "Got it" and no sub-line / no "Not boxed?" hint', () => {
      render(<SpotlightPickGuide phase="confirm" step={1} total={2} />);
      expect(screen.getByTestId('spotlight-pick-guide').getAttribute('data-phase')).toBe('confirm');
      expect(screen.getByTestId('pick-guide-text').textContent).toBe(EDITOR_PANELS.PICK_GUIDE_CONFIRM);
      expect(screen.queryByTestId('pick-guide-not-boxed')).toBeNull();
    });
  });

  describe('away (phase="away")', () => {
    it('shows the away copy and calls onResumeStep from the "Go to step N" button', () => {
      const onResumeStep = vi.fn();
      render(<SpotlightPickGuide phase="away" step={2} total={4} onResumeStep={onResumeStep} />);
      expect(screen.getByTestId('pick-guide-text').textContent).toBe(EDITOR_PANELS.PICK_GUIDE_AWAY(2, 4, false));
      fireEvent.click(screen.getByText(EDITOR_PANELS.PICK_GUIDE_AWAY_BUTTON(2)));
      expect(onResumeStep).toHaveBeenCalledTimes(1);
    });

    it('uses the compact away copy', () => {
      render(<SpotlightPickGuide phase="away" step={2} total={4} compact />);
      expect(screen.getByTestId('pick-guide-text').textContent).toBe(EDITOR_PANELS.PICK_GUIDE_AWAY(2, 4, true));
    });
  });

  describe('done (phase="done")', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('shows the done copy and calls onPlaySpotlight from the button', () => {
      const onPlaySpotlight = vi.fn();
      render(<SpotlightPickGuide phase="done" total={3} onPlaySpotlight={onPlaySpotlight} isPlaying={false} />);
      expect(screen.getByTestId('pick-guide-text').textContent).toBe(EDITOR_PANELS.PICK_GUIDE_DONE(3, false));
      fireEvent.click(screen.getByText(EDITOR_PANELS.PICK_GUIDE_PLAY_SPOTLIGHT));
      expect(onPlaySpotlight).toHaveBeenCalledTimes(1);
    });

    it('auto-hides after 4s while paused', () => {
      render(<SpotlightPickGuide phase="done" total={3} isPlaying={false} />);
      expect(screen.getByTestId('spotlight-pick-guide')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(4000); });
      expect(screen.queryByTestId('spotlight-pick-guide')).toBeNull();
    });

    it('hides immediately once playing starts', () => {
      const { rerender } = render(<SpotlightPickGuide phase="done" total={3} isPlaying={false} />);
      expect(screen.getByTestId('spotlight-pick-guide')).toBeTruthy();
      rerender(<SpotlightPickGuide phase="done" total={3} isPlaying />);
      expect(screen.queryByTestId('spotlight-pick-guide')).toBeNull();
    });

    it('re-shows if the walk returns to done after a revisit pick', () => {
      const { rerender } = render(<SpotlightPickGuide phase="done" total={3} isPlaying={false} />);
      act(() => { vi.advanceTimersByTime(4000); });
      expect(screen.queryByTestId('spotlight-pick-guide')).toBeNull();

      rerender(<SpotlightPickGuide phase="parked" step={1} total={3} isPlaying={false} />);
      rerender(<SpotlightPickGuide phase="done" total={3} isPlaying={false} />);
      expect(screen.getByTestId('spotlight-pick-guide')).toBeTruthy();
    });
  });

  describe('placement', () => {
    it('"overlay" placement positions the pill top-4 by default, bottom-4 when flipped', () => {
      const { container, rerender } = render(
        <SpotlightPickGuide phase="parked" step={1} total={1} placement="overlay" flipToBottom={false} />
      );
      expect(container.querySelector('[data-testid="spotlight-pick-guide"]').className).toContain('top-4');
      rerender(<SpotlightPickGuide phase="parked" step={1} total={1} placement="overlay" flipToBottom />);
      expect(container.querySelector('[data-testid="spotlight-pick-guide"]').className).toContain('bottom-4');
    });

    it('"strip" placement is a plain block, ignoring flipToBottom', () => {
      const { container } = render(
        <SpotlightPickGuide phase="parked" step={1} total={1} placement="strip" flipToBottom />
      );
      const el = container.querySelector('[data-testid="spotlight-pick-guide"]');
      expect(el.className).not.toContain('absolute');
      expect(el.className).not.toContain('bottom-4');
    });

    it('mounts without crashing when safeArea is set (no inline style assertion -- jsdom limitation)', () => {
      // NOTE: jsdom cannot represent `env(safe-area-inset-*)` and drops the whole
      // inline style (same limitation as FocusCockpit.test.jsx D7), so the actual
      // padding is OWED a real-device/visual check, not assertable here.
      const { container } = render(
        <SpotlightPickGuide phase="parked" step={1} total={1} placement="overlay" safeArea />
      );
      expect(container.querySelector('[data-testid="spotlight-pick-guide"]')).toBeTruthy();
    });
  });
});
