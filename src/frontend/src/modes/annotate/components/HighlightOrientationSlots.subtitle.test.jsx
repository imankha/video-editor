import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HighlightEntry } from './HighlightOrientationSlots';
import { GuideScope } from '../../../components/instructions/GuideScope';
import { ANNOTATE } from '../../../config/displayNames';

// T14770: Make highlight is a card like Edit play (title + subtitle). The
// subtitle (ANNOTATE.MAKE_HIGHLIGHT_CARD) was defined but never rendered.
describe('HighlightEntry subtitle (T14770)', () => {
  it('shows the card subtitle alongside the title in the default state', () => {
    render(
      <GuideScope guides={[]}>
        <HighlightEntry pending={false} locked={false} onMake={vi.fn()} />
      </GuideScope>,
    );
    expect(screen.getByText(ANNOTATE.MAKE_HIGHLIGHT_CARD)).toBeTruthy();
  });
});
