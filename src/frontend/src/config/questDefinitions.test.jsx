import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { STEP_DESCRIPTIONS, STEP_TITLES } from './questDefinitions.jsx';

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

// T5160: the export-wait copy nudged first-run users to "frame your next reel"
// (leave the flow) while the upscale runs. Reword it to keep them on-task —
// their next step is adding the spotlight to THIS same reel.
describe('questDefinitions copy (T5160 export-wait)', () => {
  it('no longer nudges the user to frame another reel', () => {
    const { container } = render(<>{STEP_DESCRIPTIONS.wait_for_export}</>);
    expect(container.textContent).not.toMatch(/frame your next reel/i);
    expect(container.textContent).not.toMatch(/frame another reel/i);
  });

  it('keeps the user on-task toward the spotlight step', () => {
    const { container } = render(<>{STEP_DESCRIPTIONS.wait_for_export}</>);
    expect(container.textContent).toMatch(/spotlight/i);
  });

  it('leaves the wait_for_export title unchanged', () => {
    expect(STEP_TITLES.wait_for_export).toBe('Crisp It Up to 1080p');
  });
});
