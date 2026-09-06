import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AngleSwitcherBadge from './AngleSwitcherBadge';

const twoSources = [
  { sequence: 1, name: 'Main camera', isBackbone: true },
  { sequence: 2, name: 'sideline', isBackbone: false },
];

const threeSources = [
  { sequence: 1, name: 'Main camera', isBackbone: true },
  { sequence: 2, name: 'a.mp4', isBackbone: false },
  { sequence: 3, name: 'b.mp4', isBackbone: false },
];

describe('AngleSwitcherBadge', () => {
  it('renders nothing when fewer than 2 sources cover the playhead', () => {
    const { container } = render(<AngleSwitcherBadge sources={[twoSources[0]]} />);
    expect(container.firstChild).toBeNull();
  });

  it('2 sources: renders a segmented pill and fires onSelect', () => {
    let picked = null;
    render(<AngleSwitcherBadge sources={twoSources} activeSourceSequence={null} onSelect={(s) => { picked = s; }} />);
    expect(screen.getByTestId('angle-switcher-badge')).toBeTruthy();
    // backbone segment shows "Main camera"; both segments present
    expect(screen.getByTestId('angle-switch-1')).toBeTruthy();
    expect(screen.getByTestId('angle-switch-2')).toBeTruthy();
    fireEvent.click(screen.getByTestId('angle-switch-2'));
    expect(picked).toBe(2);
  });

  it('2 sources: the active source segment is aria-pressed', () => {
    render(<AngleSwitcherBadge sources={twoSources} activeSourceSequence={2} onSelect={() => {}} />);
    expect(screen.getByTestId('angle-switch-2').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('angle-switch-1').getAttribute('aria-pressed')).toBe('false');
  });

  it('3+ sources: uses a chevron toggle + popover, selecting from it fires onSelect', () => {
    let picked = null;
    render(<AngleSwitcherBadge sources={threeSources} activeSourceSequence={null} onSelect={(s) => { picked = s; }} />);
    // Popover hidden until toggled.
    expect(screen.queryByTestId('angle-switch-popover')).toBeNull();
    fireEvent.click(screen.getByTestId('angle-switcher-toggle'));
    expect(screen.getByTestId('angle-switch-popover')).toBeTruthy();
    fireEvent.click(screen.getByTestId('angle-switch-3'));
    expect(picked).toBe(3);
  });

  it('shows the transient fallback label even when only 1 source remains', () => {
    render(<AngleSwitcherBadge sources={[twoSources[0]]} fallbackLabel="Back to main camera" />);
    expect(screen.getByTestId('angle-fallback-label').textContent).toContain('Back to main camera');
  });
});
