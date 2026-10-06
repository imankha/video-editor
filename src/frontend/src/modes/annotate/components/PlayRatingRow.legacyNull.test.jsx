import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

vi.mock('../../../utils/apiFetch', () => ({ default: vi.fn() }));

import apiFetch from '../../../utils/apiFetch';
import { PlayRatingRow } from './PlayRatingRow';
import { RATING_MEANINGS } from '../../../components/shared/clipConstants';

afterEach(() => cleanup());

describe('PlayRatingRow - legacy null rating displays as Good (4)', () => {
  it('selects Good with its caption and writes nothing on render', () => {
    const onRatingChange = vi.fn();
    render(<PlayRatingRow rating={null} onRatingChange={onRatingChange} />);

    const row = screen.getByTestId('rating-input');
    expect(row.dataset.rating).toBe('4');
    const checked = within(row).getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0].getAttribute('aria-label')).toMatch(/^4 stars/);
    expect(within(row).getByText(RATING_MEANINGS[4])).toBeTruthy();
    expect(within(row).getByText('Tap to change')).toBeTruthy();

    expect(onRatingChange).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
