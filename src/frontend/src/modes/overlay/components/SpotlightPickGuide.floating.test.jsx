import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import SpotlightPickGuide from './SpotlightPickGuide';
import { useGuideFocusStore } from '../../../components/instructions/guideFocusStore';

// T12640: the pick walk is a FloatingCoach step (shade + Got it + dock), not an in-video pill.
function Stage({ children }) {
  return <div data-testid="overlay-video-stage" ref={(el) => {
    if (el) el.getBoundingClientRect = () => ({ left: 300, top: 100, right: 480, bottom: 420, width: 180, height: 320 });
  }}>{children}</div>;
}

describe('SpotlightPickGuide T12640: floating guide', () => {
  afterEach(() => useGuideFocusStore.getState().resetAcks());

  it('renders outside the video stage, so a narrow stage cannot wrap or clip it', () => {
    render(<Stage><SpotlightPickGuide phase="parked" step={1} total={4} assignedCount={0} placement="overlay" /></Stage>);
    const stage = screen.getByTestId('overlay-video-stage');
    expect(stage.contains(screen.getByTestId('spotlight-pick-guide'))).toBe(false);
  });

  it('has a Got it button that dismisses the step', () => {
    render(<Stage><SpotlightPickGuide phase="parked" step={1} total={4} assignedCount={0} /></Stage>);
    fireEvent.click(screen.getByTestId('guide-got-it'));
    expect(screen.queryByTestId('spotlight-pick-guide')).toBeNull();
  });

  it('shades the page but leaves the video stage (the athletes) clear', async () => {
    render(<Stage><SpotlightPickGuide phase="parked" step={1} total={4} assignedCount={0} /></Stage>);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const cuts = JSON.parse(screen.getByTestId('guide-shade').getAttribute('data-cutouts'));
    expect(cuts.some((c) => c.left <= 300 && c.top <= 100 && c.right >= 480 && c.bottom >= 420)).toBe(true);
  });

  it('the Spotlight set step is also a shaded step with Got it', () => {
    render(<Stage><SpotlightPickGuide phase="done" total={4} /></Stage>);
    expect(screen.getByTestId('guide-got-it')).toBeTruthy();
  });
});
