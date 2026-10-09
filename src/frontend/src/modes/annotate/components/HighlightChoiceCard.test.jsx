import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HighlightChoiceCard } from './HighlightChoiceCard';

// T12050: exactly one primary action, cyan, and it is the first button.
// Gold (#F5B700) is reserved for the eyebrow and border (rating-5 semantics),
// never for a filled button.
describe('HighlightChoiceCard primary action (T12050)', () => {
  function renderCard() {
    render(
      <HighlightChoiceCard
        onMakeNow={vi.fn()}
        onBackToEditing={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    return {
      card: screen.getByTestId('highlight-choice-card'),
      now: screen.getByTestId('highlight-choice-now'),
      later: screen.getByTestId('highlight-choice-later'),
    };
  }

  it('makes "Make highlight now" the cyan primary and the first action', () => {
    const { card, now, later } = renderCard();
    const buttons = Array.from(card.querySelectorAll('button'))
      .filter((b) => b.dataset.testid !== 'highlight-choice-close');

    // Leftmost/topmost: it comes before "Back to editing" in DOM order.
    expect(buttons[0]).toBe(now);
    expect(buttons[1]).toBe(later);

    // Primary is cyan-filled.
    expect(now.className).toContain('bg-cyan-500');
    expect(now.className).toContain('text-slate-950');
  });

  it('never fills a button with gold', () => {
    const { now, later } = renderCard();
    expect(now.className).not.toContain('bg-[#F5B700]');
    expect(later.className).not.toContain('bg-[#F5B700]');
  });

  it('has exactly one primary (cyan-filled) button in the card', () => {
    const { card } = renderCard();
    const filled = Array.from(card.querySelectorAll('button')).filter((b) =>
      b.className.includes('bg-cyan-500')
    );
    expect(filled).toHaveLength(1);
    expect(filled[0].dataset.testid).toBe('highlight-choice-now');
  });

  it('keeps the gold eyebrow and border', () => {
    const { card } = renderCard();
    expect(card.className).toContain('border-[#F5B700]/70');
    expect(card.querySelector('p').className).toContain('text-[#F5B700]');
  });
});
