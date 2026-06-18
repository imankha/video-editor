import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { STEP_DESCRIPTIONS } from './questDefinitions.jsx';

// T3780: quest copy clarity.
// - open_framing: text wayfinding ("Click the Home button... open Drafts") replaced
//   with a clickable "Open your reel" deep link.
// - open_overlay: stale "click the reel's card under Drafts" copy replaced with an
//   action-first hint, since framing now auto-advances the user into Overlay (T3720).

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

  describe('open_overlay reword', () => {
    it('reflects the framing->overlay auto-advance (user is already in Overlay)', () => {
      expect(STEP_DESCRIPTIONS.open_overlay).toMatch(/Overlay mode/i);
      expect(STEP_DESCRIPTIONS.open_overlay).toMatch(/spotlight/i);
    });

    it('no longer tells the user to click a card under Drafts', () => {
      expect(STEP_DESCRIPTIONS.open_overlay).not.toMatch(/card under/i);
    });
  });
});
