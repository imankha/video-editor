import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TeammateTagInput, commitPendingTeammateText } from './TeammateTagInput';

describe('TeammateTagInput', () => {
  const defaultProps = {
    teammates: [],
    onChange: vi.fn(),
    suggestions: ['Jake', 'Player 7', 'Alex'],
  };

  it('renders chips for initial teammates', () => {
    render(<TeammateTagInput {...defaultProps} teammates={['Jake', 'Player 7']} />);
    expect(screen.getByText('Jake')).toBeTruthy();
    expect(screen.getByText('Player 7')).toBeTruthy();
  });

  it('adds a teammate via Enter', () => {
    const onChange = vi.fn();
    render(<TeammateTagInput {...defaultProps} teammates={['Jake']} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Alex' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['Jake', 'Alex']);
  });

  it('adds a teammate via comma', () => {
    const onChange = vi.fn();
    render(<TeammateTagInput {...defaultProps} teammates={[]} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Alex,' } });
    expect(onChange).toHaveBeenCalledWith(['Alex']);
  });

  it('removes a teammate via X button', () => {
    const onChange = vi.fn();
    render(<TeammateTagInput {...defaultProps} teammates={['Jake', 'Player 7']} onChange={onChange} />);
    const removeButtons = screen.getAllByRole('button');
    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith(['Player 7']);
  });

  it('removes last teammate via Backspace on empty input', () => {
    const onChange = vi.fn();
    render(<TeammateTagInput {...defaultProps} teammates={['Jake', 'Player 7']} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['Jake']);
  });

  it('filters autocomplete suggestions based on input', () => {
    render(<TeammateTagInput {...defaultProps} teammates={[]} />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Ja' } });
    expect(screen.getByText('Jake')).toBeTruthy();
    expect(screen.queryByText('Player 7')).toBeNull();
  });

  it('does not add duplicate names (case-insensitive)', () => {
    const onChange = vi.fn();
    render(<TeammateTagInput {...defaultProps} teammates={['Jake']} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'jake' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('trims whitespace from teammate names', () => {
    const onChange = vi.fn();
    render(<TeammateTagInput {...defaultProps} teammates={[]} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '  Alex  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['Alex']);
  });

  it('does not add empty strings', () => {
    const onChange = vi.fn();
    render(<TeammateTagInput {...defaultProps} teammates={[]} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows placeholder when no teammates', () => {
    render(<TeammateTagInput {...defaultProps} teammates={[]} />);
    expect(screen.getByPlaceholderText('Tag a teammate...')).toBeTruthy();
  });

  it('hides placeholder when teammates exist', () => {
    render(<TeammateTagInput {...defaultProps} teammates={['Jake']} />);
    expect(screen.queryByPlaceholderText('Tag a teammate...')).toBeNull();
  });
});

// T7540: commitPendingTeammateText lets a Save handler commit typed-but-not-
// Entered text from outside the component. The module-level _uncommittedText it
// reads is only populated by the mounted input's effect, so each case types
// into a rendered input first, then calls the helper — mirroring the real flow
// (type in the overlay's teammate field, click Save without pressing Enter).
describe('commitPendingTeammateText (T7540)', () => {
  function typeInto(value) {
    render(<TeammateTagInput teammates={[]} onChange={vi.fn()} suggestions={[]} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value } });
  }

  it('commits trimmed pending text onto the given teammates array', () => {
    typeInto('  Alex  ');
    expect(commitPendingTeammateText(['Jake'])).toEqual(['Jake', 'Alex']);
  });

  it('returns the same array (no-op) when pending text is empty or whitespace', () => {
    typeInto('   ');
    const teammates = ['Jake'];
    const result = commitPendingTeammateText(teammates);
    expect(result).toBe(teammates);
  });

  it('dedupes case-insensitively against existing teammates', () => {
    typeInto('jake');
    const teammates = ['Jake'];
    expect(commitPendingTeammateText(teammates)).toBe(teammates);
  });

  it('clears pending text so a second commit does not re-add it', () => {
    typeInto('Alex');
    expect(commitPendingTeammateText([])).toEqual(['Alex']);
    // Second call, nothing typed since — must be a no-op.
    expect(commitPendingTeammateText(['Alex'])).toEqual(['Alex']);
  });
});
