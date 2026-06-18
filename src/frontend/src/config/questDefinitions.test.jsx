import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { STEP_DESCRIPTIONS } from './questDefinitions.jsx';

// T3780: open_framing text wayfinding ("Click the Home button... open Drafts")
// replaced with a clickable "Open your reel" deep link.

describe('questDefinitions copy (T3780)', () => {
  describe('open_framing deep link', () => {
    it('renders a clickable "Open your reel" control', () => {
      const { getByRole } = render(<>{STEP_DESCRIPTIONS.open_framing}</>);
      const button = getByRole('button', { name: /open your reel/i });
      expect(button).toBeTruthy();
    });

    it('drops the old "Home button" text wayfinding', () => {
      const { container } = render(<>{STEP_DESCRIPTIONS.open_framing}</>);
      expect(container.textContent).not.toMatch(/Home button/i);
    });
  });
});
