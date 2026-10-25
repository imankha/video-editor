import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SuggestedPlaysList } from './SuggestedPlaysList';
import { useProfileStore } from '../../../stores';

// T13220: rate-to-keep list. Rows expand in place; ONE rating tap = ONE onKeep call that
// carries the row's current name/tags/notes; after keeping, edits are surgical.
const S = (id, start, labels, state = 'open', raw = null) => ({
  id, import_id: 'imp1', source: 'veo_zip', video_sequence: 1, video_offset_seconds: 0,
  start_time: start, end_time: start + 12, labels, state, raw_clip_id: raw,
});

function setup(overrides = {}) {
  const props = {
    suggestions: [S('a', 883, ['Goal']), S('b', 1200, ['Shot on goal']), S('c', 1500, ['Attack'])],
    activeId: null,
    onSelect: vi.fn(),
    onKeep: vi.fn(),
    onDismiss: vi.fn(),
    onReopen: vi.fn(),
    onEditKept: vi.fn(),
    onUndoKeep: vi.fn(),
    onEditPlay: vi.fn(),
    ...overrides,
  };
  const utils = render(<SuggestedPlaysList {...props} />);
  return { props, ...utils };
}

beforeEach(() => {
  useProfileStore.setState({ currentProfileId: 'p1', profiles: [{ id: 'p1', sport: 'soccer' }] });
});

describe('SuggestedPlaysList', () => {
  it('lists rows with label, mm:ss and duration, plus label chips with counts', () => {
    setup();
    const row = screen.getByTestId('suggestion-row-a');
    expect(within(row).getByText('Goal')).toBeTruthy();
    expect(within(row).getByText('14:43')).toBeTruthy();
    expect(within(row).getByText('12s')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Goal 1/ })).toBeTruthy();
  });

  it('stamps a row with the offset of its video plus start_time, and names the draft with it (T13245)', () => {
    const second = { ...S('d', 100, ['Goal']), video_sequence: 2, video_offset_seconds: 3600 };
    setup({ suggestions: [S('a', 883, ['Goal']), second] });
    expect(within(screen.getByTestId('suggestion-row-a')).getByText('14:43')).toBeTruthy();
    expect(within(screen.getByTestId('suggestion-row-d')).getByText('1:01:40')).toBeTruthy();
    fireEvent.click(screen.getByTestId('suggestion-row-d-header'));
    expect(screen.getByTestId('suggestion-name-d').value).toBe('Goal 1:01:40');
  });

  it('a one-clip Veo game stamps from the server offset, not 0:00 (single-video games have no client video list)', () => {
    setup({ suggestions: [{ ...S('g', 0, ['Goal', 'Shot on goal']), end_time: 25, video_offset_seconds: 320 }] });
    expect(within(screen.getByTestId('suggestion-row-g')).getByText('5:20')).toBeTruthy();
    fireEvent.click(screen.getByTestId('suggestion-row-g-header'));
    expect(screen.getByTestId('suggestion-name-g').value).toBe('Goal 5:20');
  });

  it('tapping a row seeks (onSelect) and expands it in place with a prefilled draft', () => {
    const { props } = setup({ activeId: 'a' });
    fireEvent.click(screen.getByTestId('suggestion-row-a-header'));
    expect(props.onSelect.mock.calls[0][0].id).toBe('a');
    expect(screen.getByTestId('suggestion-name-a').value).toBe('Goal 14:43');
    expect(screen.getByLabelText(/Notes/).value).toBe('Veo: Goal');
    expect(within(screen.getByTestId('suggestion-form-a')).getByRole('button', { name: /Goal/ })).toBeTruthy();
    // only one row expanded at a time
    fireEvent.click(screen.getByTestId('suggestion-row-b-header'));
    expect(screen.queryByTestId('suggestion-name-a')).toBeNull();
    expect(screen.getByTestId('suggestion-name-b').value).toBe('Shot on goal 20:00');
  });

  it('one rating tap = exactly one onKeep carrying rating, name, Goal tag and notes', () => {
    const { props } = setup();
    fireEvent.click(screen.getByTestId('suggestion-row-a-header'));
    fireEvent.click(screen.getByRole('radio', { name: /5 stars/ }));
    expect(props.onKeep).toHaveBeenCalledTimes(1);
    expect(props.onKeep).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }),
      { rating: 5, name: 'Goal 14:43', tags: ['Goal'], notes: 'Veo: Goal' },
    );
    expect(props.onEditKept).not.toHaveBeenCalled();
  });

  it('edits before keeping stay in the draft; the rating tap sends them all in one call', () => {
    const { props } = setup();
    fireEvent.click(screen.getByTestId('suggestion-row-a-header'));
    fireEvent.change(screen.getByTestId('suggestion-name-a'), { target: { value: 'Nice finish' } });
    fireEvent.click(screen.getByRole('button', { name: /Dribble/ }));
    expect(props.onKeep).not.toHaveBeenCalled();
    expect(props.onEditKept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: /4 stars/ }));
    expect(props.onKeep).toHaveBeenCalledTimes(1);
    const [, draft] = props.onKeep.mock.calls[0];
    expect(draft.rating).toBe(4);
    expect(draft.name).toBe('Nice finish');
    expect([...draft.tags].sort()).toEqual(['Dribble', 'Goal']);
    expect(draft.notes).toBe('Veo: Goal');
  });

  it('nothing auto-advances after a rating; Next moves to the next open suggestion', () => {
    const { props, rerender } = setup();
    fireEvent.click(screen.getByTestId('suggestion-row-a-header'));
    props.onSelect.mockClear();
    fireEvent.click(screen.getByRole('radio', { name: /5 stars/ }));
    expect(props.onSelect).not.toHaveBeenCalled();
    // parent reports it kept
    rerender(<SuggestedPlaysList {...props} keptDetails={{ a: { rating: 5, name: 'Goal 14:43', tags: ['Goal'], notes: 'Veo: Goal' } }} suggestions={[S('a', 883, ['Goal'], 'accepted', 11), S('b', 1200, ['Shot on goal']), S('c', 1500, ['Attack'])]} />);
    expect(screen.getByTestId('suggestion-name-a')).toBeTruthy(); // still expanded
    expect(screen.getByText('Play · Brilliant')).toBeTruthy();
    fireEvent.click(screen.getByTestId('suggestion-next-a'));
    expect(props.onSelect.mock.calls[0][0].id).toBe('b');
    expect(screen.getByTestId('suggestion-name-b')).toBeTruthy();
    expect(screen.queryByTestId('suggestion-name-a')).toBeNull();
  });

  describe('after keeping', () => {
    const kept = [S('a', 883, ['Goal'], 'accepted', 11), S('b', 1200, ['Shot on goal'])];
    const keptProps = { suggestions: kept, keptDetails: { a: { rating: 5, name: 'Goal 14:43', tags: ['Goal'], notes: 'Veo: Goal' } } };

    function open() {
      const r = setup(keptProps);
      fireEvent.click(screen.getByRole('button', { name: /Kept/ }));
      fireEvent.click(screen.getByTestId('suggestion-row-a-header'));
      return r;
    }

    it('a tag toggle is one onEditKept with only tags', () => {
      const { props } = open();
      fireEvent.click(screen.getByRole('button', { name: /Dribble/ }));
      expect(props.onEditKept).toHaveBeenCalledTimes(1);
      expect(props.onEditKept.mock.calls[0][1]).toEqual({ tags: ['Goal', 'Dribble'] });
      expect(props.onKeep).not.toHaveBeenCalled();
    });

    it('a rating tap is one onEditKept with only rating', () => {
      const { props } = open();
      fireEvent.click(screen.getByRole('radio', { name: /3 stars/ }));
      expect(props.onEditKept.mock.calls).toEqual([[expect.objectContaining({ id: 'a' }), { rating: 3 }]]);
    });

    it('name commits on blur with only name', () => {
      const { props } = open();
      const input = screen.getByTestId('suggestion-name-a');
      input.focus();
      fireEvent.change(input, { target: { value: 'Banger' } });
      fireEvent.blur(input);
      expect(props.onEditKept.mock.calls).toEqual([[expect.objectContaining({ id: 'a' }), { name: 'Banger' }]]);
    });

    it('Escape reverts the name without a request', () => {
      const { props } = open();
      const input = screen.getByTestId('suggestion-name-a');
      input.focus();
      fireEvent.change(input, { target: { value: 'Banger' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(props.onEditKept).not.toHaveBeenCalled();
      expect(input.value).toBe('Goal 14:43');
    });
  });

  it('Not my player dismisses; the Dismissed filter shows it and Reopen restores it', () => {
    const { props } = setup();
    fireEvent.click(screen.getByTestId('suggestion-row-a-header'));
    fireEvent.click(screen.getByRole('button', { name: 'Not my player' }));
    expect(props.onDismiss).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('state filter hides other states', () => {
    setup({ suggestions: [S('a', 883, ['Goal']), S('b', 1200, ['Attack'], 'dismissed')] });
    expect(screen.getByTestId('suggestion-row-a')).toBeTruthy();
    expect(screen.queryByTestId('suggestion-row-b')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Dismissed/ }));
    expect(screen.queryByTestId('suggestion-row-a')).toBeNull();
    expect(screen.getByTestId('suggestion-row-b')).toBeTruthy();
  });

  it('keys 1-5 rate and X dismisses only while the list (not a text field) has focus', () => {
    const { props } = setup();
    fireEvent.click(screen.getByTestId('suggestion-row-a-header'));
    const list = screen.getByTestId('suggested-plays-list');
    fireEvent.keyDown(screen.getByTestId('suggestion-name-a'), { key: '4' });
    expect(props.onKeep).not.toHaveBeenCalled();
    fireEvent.keyDown(list, { key: '4' });
    expect(props.onKeep).toHaveBeenCalledTimes(1);
    expect(props.onKeep.mock.calls[0][1].rating).toBe(4);
    fireEvent.keyDown(list, { key: 'x' });
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });
});
