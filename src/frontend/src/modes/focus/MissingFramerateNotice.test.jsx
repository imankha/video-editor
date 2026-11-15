import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import MissingFramerateNotice from './MissingFramerateNotice';

/**
 * T4540: Frame shows a clear error for a clip with no stored frame rate (its crop
 * timing would be a guess), and nothing for a clip that has one.
 */
describe('MissingFramerateNotice (T4540)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows a clear error when the clip has no frame rate', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<MissingFramerateNotice clip={{ id: 7, fps: null }} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/frame rate/i);
    expect(alert.getAttribute('data-testid')).toBe('clip-framerate-missing');
  });

  it('renders nothing for a 60 fps clip', () => {
    const { container } = render(<MissingFramerateNotice clip={{ id: 8, fps: 60 }} />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
