import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SpotlightPickGuide from './SpotlightPickGuide';
import { EDITOR_PANELS } from '../../../config/displayNames';

describe('SpotlightPickGuide (T11570)', () => {
  it('explains tracker placement on numbered frames instead of steps', () => {
    const { rerender } = render(<SpotlightPickGuide phase="parked" step={1} total={4} assignedCount={0} />);
    expect(screen.getByTestId('pick-guide-step').textContent).toBe('Frame 1 of 4');
    expect(screen.getByText('Set the player tracker around your player on 4 different frames.')).toBeTruthy();
    rerender(<SpotlightPickGuide phase="away" step={2} total={4} />);
    expect(screen.getByRole('button', { name: 'Go to frame 2' })).toBeTruthy();
    expect(screen.getByTestId('pick-guide-text').textContent).toBe('Frame 2 of 4 still needs your player tracker');
  });
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
      expect(screen.getByText(EDITOR_PANELS.PICK_GUIDE_WHY(3))).toBeTruthy();
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

    it('drops the sub-line and shortens the frame count when compact', () => {
      render(<SpotlightPickGuide phase="parked" step={2} total={4} compact />);
      expect(screen.getByTestId('pick-guide-step').textContent).toBe('Frame 2/4');
      expect(screen.queryByText(EDITOR_PANELS.PICK_GUIDE_WHY(3))).toBeNull();
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
    it('shows the away copy and calls onResumeStep from the "Go to frame N" button', () => {
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
    it('"strip" placement is a plain block -- never measures, no top-4/bottom-4', () => {
      const { container } = render(
        <SpotlightPickGuide phase="parked" step={1} total={1} placement="strip" />
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

    it('defaults to top-4 when no stageRef/videoHeight is supplied (nothing to measure against)', () => {
      const { container } = render(
        <SpotlightPickGuide phase="parked" step={1} total={1} placement="overlay" />
      );
      const el = container.querySelector('[data-testid="spotlight-pick-guide"]');
      expect(el.className).toContain('top-4');
      expect(el.getAttribute('data-side')).toBe('top');
    });
  });

  describe('real-geometry flip (MAJOR 2 fix: measured pill height vs real obstacle rects)', () => {
    // jsdom has no layout engine -- every element reports getBoundingClientRect
    // height 0 by default. Mock it per-instance: the stage element gets a fixed
    // STAGE_HEIGHT; every OTHER element (the pill) gets a fixed PILL_HEIGHT via
    // the prototype default, which own-instance mocks (the stage) shadow.
    const STAGE_HEIGHT = 600;
    const PILL_HEIGHT = 100;
    const COMPACT_PILL_HEIGHT = 50;
    let originalRect;

    function makeStageRef() {
      const el = document.createElement('div');
      // A plain OWN-property reassignment (not vi.spyOn) -- spying on an
      // INHERITED method with vi.spyOn can return the SAME shared mock the
      // prototype-level spy below created, so a later .mockReturnValue() on
      // "this instance" silently overwrites the prototype default for every
      // element instead of shadowing it for just this one. Plain assignment
      // has no such sharing: it's a genuine own property.
      el.getBoundingClientRect = () => (
        { height: STAGE_HEIGHT, top: 0, bottom: STAGE_HEIGHT, left: 0, right: 0, width: 0 }
      );
      return { current: el };
    }

    beforeEach(() => {
      originalRect = HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function () {
        // The pill's REAL height shrinks in compact mode (shorter copy, no
        // sub-line) -- reflect that from the actual rendered step text so
        // the in-between case (full doesn't fit, compact DOES) is
        // measurable at all, the same way a real browser's layout differs
        // between the two renders.
        if (this.getAttribute?.('role') === 'status') {
          const stepText = this.querySelector?.('[data-testid="pick-guide-step"]')?.textContent || '';
          const isCompactRender = stepText !== '' && stepText.includes('/');
          const height = isCompactRender ? COMPACT_PILL_HEIGHT : PILL_HEIGHT;
          return { height, top: 0, bottom: height, left: 0, right: 0, width: 0 };
        }
        return { height: PILL_HEIGHT, top: 0, bottom: PILL_HEIGHT, left: 0, right: 0, width: 0 };
      };
    });
    afterEach(() => { HTMLElement.prototype.getBoundingClientRect = originalRect; });

    it('stays top when the top band [16, 16+pillHeight] is clear of every obstacle', () => {
      const stageRef = makeStageRef();
      // Obstacle near the BOTTOM of the video frame (video-px 850-950 of 1000) --
      // maps to stage-px [510, 570], nowhere near the top band [16, 116].
      const { container } = render(
        <SpotlightPickGuide
          phase="parked" step={1} total={1} placement="overlay"
          stageRef={stageRef} videoHeight={1000} obstacleBoxes={[{ y: 900, height: 100 }]}
        />
      );
      const el = container.querySelector('[data-testid="spotlight-pick-guide"]');
      expect(el.getAttribute('data-side')).toBe('top');
      expect(el.className).toContain('top-4');
    });

    it('flips to bottom when the top band collides but the bottom band is clear', () => {
      const stageRef = makeStageRef();
      // Obstacle near the TOP of the frame (video-px 0-100 of 1000) -> stage-px
      // [0, 60] -- collides with the top band [16, 116] but not the bottom
      // band [484, 584].
      const { container } = render(
        <SpotlightPickGuide
          phase="parked" step={1} total={1} placement="overlay"
          stageRef={stageRef} videoHeight={1000} obstacleBoxes={[{ y: 50, height: 100 }]}
        />
      );
      const el = container.querySelector('[data-testid="spotlight-pick-guide"]');
      expect(el.getAttribute('data-side')).toBe('bottom');
      expect(el.className).toContain('bottom-4');
    });

    it('checks ALL obstacle boxes, not just the first/top one', () => {
      const stageRef = makeStageRef();
      // Top box blocks the top band; a SECOND box (middle of frame) must NOT
      // be ignored -- it maps to stage-px [270, 330], clear of both the top
      // [16,116] and bottom [484,584] bands, so bottom is correctly chosen.
      const { container } = render(
        <SpotlightPickGuide
          phase="parked" step={1} total={1} placement="overlay"
          stageRef={stageRef} videoHeight={1000}
          obstacleBoxes={[{ y: 50, height: 100 }, { y: 500, height: 100 }]}
        />
      );
      const el = container.querySelector('[data-testid="spotlight-pick-guide"]');
      expect(el.getAttribute('data-side')).toBe('bottom');
    });

    it('tries the compact form once when NEITHER band is clear, forcing compact copy even if the caller passed compact=false', () => {
      const stageRef = makeStageRef();
      // One obstacle spanning almost the entire frame -- collides with both
      // bands regardless of pill height.
      const { container } = render(
        <SpotlightPickGuide
          phase="parked" step={2} total={4} placement="overlay" compact={false}
          stageRef={stageRef} videoHeight={1000} obstacleBoxes={[{ y: 500, height: 1000 }]}
        />
      );
      // Forced compact: frame text uses the compact count.
      expect(screen.getByTestId('pick-guide-step').textContent).toBe('Frame 2/4');
      // Gives up gracefully rather than looping -- still renders at 'top'.
      const el = container.querySelector('[data-testid="spotlight-pick-guide"]');
      expect(el.getAttribute('data-side')).toBe('top');
    });

    it('settles (does not infinite-loop) when the FULL pill does not fit but the COMPACT pill DOES -- BLOCKING fix regression', () => {
      // The exact real-browser repro: stage 600px, pill ~100px full / ~50px
      // compact, obstacles at stage-px [70,110] and [500,540] (here mapped
      // 1:1 via videoHeight === STAGE_HEIGHT for simplicity).
      //   - full pill:    top band [16,116] collides with [70,110];
      //                   bottom band [484,584] collides with [500,540]
      //                   -> NEITHER clear at full size.
      //   - compact pill: top band [16,66] does NOT collide with [70,110]
      //                   -> clear at compact size.
      // Pre-fix, finding "clear at compact" reset forcedCompact to false,
      // which re-measured at full (not clear), forced compact again
      // (clear again), reset again... forever ("Maximum update depth
      // exceeded" in a real browser). This must settle in one extra pass.
      const stageRef = makeStageRef();
      const obstacleBoxes = [{ y: 90, height: 40 }, { y: 520, height: 40 }];
      let renderCount = 0;
      function Probe(props) {
        renderCount += 1;
        if (renderCount > 50) throw new Error('render loop did not settle within 50 renders');
        return <SpotlightPickGuide {...props} />;
      }
      const { container } = render(
        <Probe
          phase="parked" step={2} total={4} placement="overlay"
          stageRef={stageRef} videoHeight={STAGE_HEIGHT} obstacleBoxes={obstacleBoxes}
        />
      );
      const el = container.querySelector('[data-testid="spotlight-pick-guide"]');
      expect(el.getAttribute('data-side')).toBe('top');
      // Settled on the COMPACT form (that's what made 'top' clear) and
      // STAYED compact -- never flipped back to full.
      expect(screen.getByTestId('pick-guide-step').textContent).toBe('Frame 2/4');
    });

    it('re-measures when the obstacle list changes (e.g. the playhead moved to a new marker)', () => {
      const stageRef = makeStageRef();
      const { container, rerender } = render(
        <SpotlightPickGuide
          phase="parked" step={1} total={2} placement="overlay"
          stageRef={stageRef} videoHeight={1000} obstacleBoxes={[{ y: 900, height: 100 }]}
        />
      );
      expect(container.querySelector('[data-testid="spotlight-pick-guide"]').getAttribute('data-side')).toBe('top');

      rerender(
        <SpotlightPickGuide
          phase="parked" step={2} total={2} placement="overlay"
          stageRef={stageRef} videoHeight={1000} obstacleBoxes={[{ y: 50, height: 100 }]}
        />
      );
      expect(container.querySelector('[data-testid="spotlight-pick-guide"]').getAttribute('data-side')).toBe('bottom');
    });

    it('retries one frame after mount if the ancestor stageRef had not attached yet on the first pass (real-browser regression)', async () => {
      // Real browsers observed: a ref owned by an ANCESTOR (OverlayModeView /
      // the diag harness) is not always guaranteed attached by the time THIS
      // component's own layout effect first runs. Simulate that exact gap:
      // stageRef.current starts null, then becomes available shortly after.
      const stageRef = { current: null };
      const { container } = render(
        <SpotlightPickGuide
          phase="parked" step={1} total={1} placement="overlay"
          stageRef={stageRef} videoHeight={1000} obstacleBoxes={[{ y: 50, height: 100 }]}
        />
      );
      // First pass: stageRef.current is still null -> no measurement yet,
      // stays at the default 'top' (NOT a permanent commitment).
      expect(container.querySelector('[data-testid="spotlight-pick-guide"]').getAttribute('data-side')).toBe('top');

      stageRef.current = makeStageRef().current;
      // The mountTick rAF retry fires on its own -- no rerender needed.
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

      expect(container.querySelector('[data-testid="spotlight-pick-guide"]').getAttribute('data-side')).toBe('bottom');
    });
  });

  describe('pointer-events scoping (MAJOR 2 fix: a covered box must stay tappable)', () => {
    it('the pill container and its body are pointer-events-none; only buttons/the Not-boxed control opt back in', () => {
      const { container } = render(
        <SpotlightPickGuide phase="away" step={1} total={2} placement="overlay" onResumeStep={() => {}} />
      );
      const outer = container.querySelector('[data-testid="spotlight-pick-guide"]');
      expect(outer.className).toContain('pointer-events-none');
      const body = outer.querySelector('[role="status"]');
      expect(body.className).toContain('pointer-events-none');
      const button = outer.querySelector('button');
      expect(button.className).toContain('pointer-events-auto');
    });

    it('the "Not boxed?" control opts back in (parked phase)', () => {
      const { container } = render(<SpotlightPickGuide phase="parked" step={1} total={2} placement="overlay" />);
      const notBoxed = container.querySelector('[data-testid="pick-guide-not-boxed"]');
      expect(notBoxed.className).toContain('pointer-events-auto');
    });
  });
});
