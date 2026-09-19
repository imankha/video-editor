import { describe, it, expect, vi } from 'vitest';
import { onTextFieldKeyDown } from './textFieldCommit';

function fakeEvent(key) {
  return {
    key,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
    currentTarget: { blur: vi.fn() },
  };
}

describe('onTextFieldKeyDown (T10610 § B.2, the ONE Escape rule)', () => {
  it('Escape reverts the draft to the stored value, blurs, and stops propagation (revert BEFORE blur)', () => {
    const draftSetter = vi.fn();
    const e = fakeEvent('Escape');
    const order = [];
    draftSetter.mockImplementation(() => order.push('revert'));
    e.currentTarget.blur.mockImplementation(() => order.push('blur'));

    onTextFieldKeyDown(e, { draftSetter, storedValue: 'Corner kick' });

    expect(e.stopPropagation).toHaveBeenCalledTimes(1);
    expect(draftSetter).toHaveBeenCalledWith('Corner kick');
    expect(e.currentTarget.blur).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['revert', 'blur']);
  });

  it('Escape with an empty/undefined stored value reverts to empty string, never undefined', () => {
    const draftSetter = vi.fn();
    onTextFieldKeyDown(fakeEvent('Escape'), { draftSetter, storedValue: undefined });
    expect(draftSetter).toHaveBeenCalledWith('');
  });

  it('Enter with allowEnterCommit blurs (routes the commit through the one blur call site), no revert', () => {
    const draftSetter = vi.fn();
    const e = fakeEvent('Enter');
    onTextFieldKeyDown(e, { draftSetter, storedValue: 'x', allowEnterCommit: true });
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(e.currentTarget.blur).toHaveBeenCalledTimes(1);
    expect(draftSetter).not.toHaveBeenCalled();
  });

  it('Enter without allowEnterCommit (e.g. a notes textarea) is a no-op — Enter is a newline there', () => {
    const draftSetter = vi.fn();
    const e = fakeEvent('Enter');
    onTextFieldKeyDown(e, { draftSetter, storedValue: 'x', allowEnterCommit: false });
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(e.currentTarget.blur).not.toHaveBeenCalled();
  });

  it('any other key is a no-op', () => {
    const draftSetter = vi.fn();
    const e = fakeEvent('a');
    onTextFieldKeyDown(e, { draftSetter, storedValue: 'x', allowEnterCommit: true });
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(e.stopPropagation).not.toHaveBeenCalled();
    expect(e.currentTarget.blur).not.toHaveBeenCalled();
    expect(draftSetter).not.toHaveBeenCalled();
  });
});
