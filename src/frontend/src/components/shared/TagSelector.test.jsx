import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TagSelector } from './TagSelector';
import { getTagSet } from '../../modes/annotate/constants/tagRegistry';

// T8490: the grid renders the "Keeper Save" display rename while a clip
// already tagged with the stored value "Save" still shows as selected/tagged
// -- the rename is display-only, identity/matching stays on tag.name.
describe('TagSelector — Keeper Save display rename (T8490)', () => {
  const soccer = getTagSet('soccer');

  it('renders "Keeper Save" in the grid, not the stored "Save"', () => {
    render(
      <TagSelector
        positions={soccer.positions}
        tagsByPosition={soccer.tags}
        selectedTags={[]}
        onTagToggle={() => {}}
      />
    );
    expect(screen.getByText('Keeper Save')).toBeTruthy();
    expect(screen.queryByText('Save')).toBeNull();
  });

  it('a clip tagged with the stored value "Save" still renders selected (matched by name, not displayName)', () => {
    render(
      <TagSelector
        positions={soccer.positions}
        tagsByPosition={soccer.tags}
        selectedTags={['Save']}
        onTagToggle={() => {}}
      />
    );
    const button = screen.getByRole('button', { name: /Keeper Save/ });
    expect(button.className).toContain('bg-green-600'); // selected styling
  });

  it('toggling the rendered "Keeper Save" tag calls onTagToggle with the stored name "Save"', () => {
    const onTagToggle = vi.fn();
    render(
      <TagSelector
        positions={soccer.positions}
        tagsByPosition={soccer.tags}
        selectedTags={[]}
        onTagToggle={onTagToggle}
      />
    );
    screen.getByText('Keeper Save').closest('button').click();
    expect(onTagToggle).toHaveBeenCalledWith('Save');
  });
});
