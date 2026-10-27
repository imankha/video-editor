import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TransportRail from '../TransportRail';
import CockpitIntroCard from '../CockpitIntroCard';

// T13700:C1 (bug 20), jsdom has no layout so these assert the class contract.
describe('landscape cockpit fits 844x390 (T13700:C1)', () => {
  it('timecode clock fits the 56px rail (8 mono chars cannot be text-xs at 7.2px each)', () => {
    render(<TransportRail currentTime={4.976} />);
    const clock = screen.getByText('00:00:04');
    expect(clock.className).toContain('text-[10px]');
    expect(clock.className).not.toContain('text-xs');
  });

  it('intro card sits at the bottom-left, not centered over the crop box', () => {
    render(<CockpitIntroCard onDismiss={() => {}} />);
    const cls = screen.getByTestId('cockpit-intro-card').className;
    expect(cls).toContain('left-2');
    expect(cls).toContain('bottom-2');
    expect(cls).not.toContain('-translate-x-1/2');
    expect(cls).not.toContain('top-1/2');
  });

  it('the cockpit root is marked as covering the header', async () => {
    const { default: FocusCockpit } = await import('../FocusCockpit');
    expect(FocusCockpit.toString()).toContain('data-covers-header');
  });
});
