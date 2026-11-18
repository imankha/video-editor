import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AddDetailsPopup } from './AddDetailsPopup';

/**
 * T17010 — the phone "Tags and Notes" sheet is a full-screen takeover with its own
 * close X at the top right, where the fixed Guidance switch layer paints. Like the
 * Plays drawer (T13770) and the landscape cockpit (T13700), the open sheet must mark
 * itself data-covers-header so GuidanceToggle hides its layer and the X stays tappable.
 */
afterEach(() => cleanup());

describe('AddDetailsPopup vs the Guidance switch (T17010:C1)', () => {
  it('the open sheet carries data-covers-header, and unmounting it clears the mark', () => {
    const { unmount } = render(
      <AddDetailsPopup tagSet={[]} positions={[]} selectedTags={[]} onTagToggle={() => {}}
        notes="" onNotesChange={() => {}} onDone={() => {}} />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.hasAttribute('data-covers-header')).toBe(true);
    unmount();
    expect(document.querySelector('[data-covers-header]')).toBeNull();
  });
});
