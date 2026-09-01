import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import RegionLayer from './RegionLayer';

/**
 * Bug 48p (prod) — a single click on the highlight region's Trash2 button
 * deleted the region immediately, no confirmation, no undo. A user deleted
 * the auto-generated default spotlight region and had no way to get it back.
 * The delete button must now require confirmation before onRegionAction fires,
 * and the pending delete must be keyed by region ID (not positional index) so
 * a `regions` array replacement while the dialog is open can't confirm the
 * wrong region (see draggingLever in RegionLayer.jsx for the same reasoning).
 */

const DURATION = 10;

function region(overrides = {}) {
  return {
    id: 'r1',
    index: 0,
    startTime: 2,
    endTime: 4,
    visualStartPercent: 20,
    visualWidthPercent: 20,
    ...overrides,
  };
}

function renderLayer(overrides = {}) {
  const onRegionAction = vi.fn();
  const utils = render(
    <RegionLayer
      mode="highlight"
      regions={[region()]}
      duration={DURATION}
      currentTime={0}
      onRegionAction={onRegionAction}
      {...overrides}
    />
  );
  return { onRegionAction, ...utils };
}

afterEach(() => cleanup());

describe('RegionLayer — delete requires confirmation (bug 48p)', () => {
  it('does not delete immediately on clicking the delete button', () => {
    const { onRegionAction } = renderLayer();

    fireEvent.click(screen.getByTitle('Delete region'));

    expect(onRegionAction).not.toHaveBeenCalled();
    expect(screen.getByText('Delete this spotlight?')).toBeTruthy();
  });

  it('fires onRegionAction("delete") only after confirming in the dialog', () => {
    const { onRegionAction } = renderLayer();

    fireEvent.click(screen.getByTitle('Delete region'));
    fireEvent.click(screen.getByText('Delete'));

    expect(onRegionAction).toHaveBeenCalledTimes(1);
    expect(onRegionAction).toHaveBeenCalledWith(0, 'delete');
    expect(screen.queryByText('Delete this spotlight?')).toBeNull();
  });

  it('does not fire onRegionAction when Cancel is clicked', () => {
    const { onRegionAction } = renderLayer();

    fireEvent.click(screen.getByTitle('Delete region'));
    fireEvent.click(screen.getByText('Cancel'));

    expect(onRegionAction).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete this spotlight?')).toBeNull();
  });

  it('does not fire onRegionAction when the dialog is closed via Escape', () => {
    const { onRegionAction } = renderLayer();

    fireEvent.click(screen.getByTitle('Delete region'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onRegionAction).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete this spotlight?')).toBeNull();
  });

  it('does not fire onRegionAction when the dialog is closed via the X button', () => {
    const { onRegionAction } = renderLayer();

    fireEvent.click(screen.getByTitle('Delete region'));
    fireEvent.click(screen.getByLabelText('Close dialog'));

    expect(onRegionAction).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete this spotlight?')).toBeNull();
  });

  it('resolves the CLICKED region to its current index, not index 0, in a multi-region layer', () => {
    const onRegionAction = vi.fn();
    render(
      <RegionLayer
        mode="highlight"
        regions={[
          region({ id: 'r1', index: 0, startTime: 0, endTime: 2 }),
          region({ id: 'r2', index: 1, startTime: 3, endTime: 5 }),
        ]}
        duration={DURATION}
        currentTime={0}
        onRegionAction={onRegionAction}
      />
    );

    fireEvent.click(screen.getAllByTitle('Delete region')[1]);
    fireEvent.click(screen.getByText('Delete'));

    expect(onRegionAction).toHaveBeenCalledTimes(1);
    expect(onRegionAction).toHaveBeenCalledWith(1, 'delete');
  });

  it('ignores confirm if the pending region was removed from `regions` while the dialog was open', () => {
    const onRegionAction = vi.fn();
    const { rerender } = render(
      <RegionLayer
        mode="highlight"
        regions={[region({ id: 'r1' })]}
        duration={DURATION}
        currentTime={0}
        onRegionAction={onRegionAction}
      />
    );

    fireEvent.click(screen.getByTitle('Delete region'));

    // Simulate an async reset/restore (export completion, project load) that
    // replaces `regions` out from under the still-open dialog.
    rerender(
      <RegionLayer
        mode="highlight"
        regions={[region({ id: 'r2' })]}
        duration={DURATION}
        currentTime={0}
        onRegionAction={onRegionAction}
      />
    );

    fireEvent.click(screen.getByText('Delete'));

    expect(onRegionAction).not.toHaveBeenCalled();
  });
});

describe('RegionLayer — segment mode "trim" is unaffected (scope boundary)', () => {
  it('still trims immediately, with no confirmation dialog', () => {
    const onRegionAction = vi.fn();
    render(
      <RegionLayer
        mode="segment"
        regions={[
          region({ id: 's1', index: 0, isFirst: true }),
          region({ id: 's2', index: 1 }),
        ]}
        duration={DURATION}
        currentTime={0}
        onRegionAction={onRegionAction}
      />
    );

    fireEvent.click(screen.getByTitle('Trim segment'));

    expect(onRegionAction).toHaveBeenCalledTimes(1);
    expect(onRegionAction).toHaveBeenCalledWith(0, 'trim');
    expect(screen.queryByText('Delete this spotlight?')).toBeNull();
  });
});
