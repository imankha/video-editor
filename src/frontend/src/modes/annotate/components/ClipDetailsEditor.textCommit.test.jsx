import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClipDetailsEditor } from './ClipDetailsEditor';

// T10610 § B.3 / A.5: the sidebar's per-keystroke write landmine is fixed —
// name/notes now use the same local-echo + commit-on-blur/Enter pattern trim
// already had. Also pins v2 finding 7 (the "(auto)" label reads
// isDefaultPlayName, not the old has-tags-or-notes heuristic).

beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
});

const baseRegion = {
  id: 'c1',
  startTime: 5,
  endTime: 10,
  rating: 4,
  tags: [],
  notes: '',
  name: 'Play 3',
};

function renderEditor(props = {}) {
  const onUpdate = vi.fn();
  render(
    <ClipDetailsEditor
      region={baseRegion}
      onUpdate={onUpdate}
      onDelete={() => {}}
      videoDuration={600}
      onSeek={() => {}}
      {...props}
    />,
  );
  return { onUpdate };
}

describe('ClipDetailsEditor name field (T10610 § B.3)', () => {
  it('typing produces ZERO onUpdate calls', () => {
    const { onUpdate } = renderEditor();
    const input = screen.getByPlaceholderText(/Play 3|Clip name/i) || screen.getByDisplayValue('Play 3');
    fireEvent.change(input, { target: { value: 'Great tackle' } });
    fireEvent.change(input, { target: { value: 'Great tackle!' } });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('blur commits exactly once with the final typed value', () => {
    const { onUpdate } = renderEditor();
    const input = screen.getByDisplayValue('Play 3');
    fireEvent.change(input, { target: { value: 'Great tackle' } });
    fireEvent.blur(input);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ name: 'Great tackle' });
  });

  it('Enter commits via blur (one call, same as blur)', () => {
    const { onUpdate } = renderEditor();
    const input = screen.getByDisplayValue('Play 3');
    input.focus(); // real DOM focus (not fireEvent.focus) — blur() only fires on the activeElement
    fireEvent.change(input, { target: { value: 'Great tackle' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ name: 'Great tackle' });
  });

  it('Escape reverts to the stored value and writes nothing', () => {
    const { onUpdate } = renderEditor();
    const input = screen.getByDisplayValue('Play 3');
    fireEvent.change(input, { target: { value: 'Great tackle' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('Play 3');
    fireEvent.blur(input);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('blurring with an unchanged value is a no-op (clean-check)', () => {
    const { onUpdate } = renderEditor();
    const input = screen.getByDisplayValue('Play 3');
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('ClipDetailsEditor notes field (T10610 § B.3)', () => {
  it('typing produces ZERO onUpdate calls; blur commits exactly one', () => {
    const { onUpdate } = renderEditor();
    const textarea = screen.getByPlaceholderText('Add notes (shown as overlay during playback)');
    fireEvent.change(textarea, { target: { value: 'N' } });
    fireEvent.change(textarea, { target: { value: 'Ni' } });
    fireEvent.change(textarea, { target: { value: 'Nice' } });
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.blur(textarea);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ notes: 'Nice' });
  });

  it('Escape reverts and blurs without writing (does not fall through to Enter handling)', () => {
    const { onUpdate } = renderEditor();
    const textarea = screen.getByPlaceholderText('Add notes (shown as overlay during playback)');
    fireEvent.change(textarea, { target: { value: 'Nice' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(textarea.value).toBe('');
    fireEvent.blur(textarea);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('ClipDetailsEditor "(auto)" label (T10610 § A.5, v2 finding 7)', () => {
  it('a freshly marked "Play N" play shows (auto)', () => {
    renderEditor({ region: { ...baseRegion, name: 'Play 3' } });
    expect(screen.getByText('(auto)')).toBeTruthy();
  });

  it('a user-renamed play does not show (auto)', () => {
    renderEditor({ region: { ...baseRegion, name: 'Great tackle' } });
    expect(screen.queryByText('(auto)')).toBeNull();
  });
});
