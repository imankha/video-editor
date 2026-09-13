import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClipDetailsEditor } from './ClipDetailsEditor';

/**
 * T9480 review fix (BLOCKING #1) -- ClipDetailsEditor (the clips-sidebar path,
 * non-compact ClipScrubRegion with step chevrons) persists trim edits ONLY on
 * `onDragEnd` (`handleStartTimeChange`/`handleEndTimeChange` are local-state
 * only, mirroring the drag path's intermediate updates). Before this fix,
 * TrimTimeField's typed-entry/step commits never signalled "edit complete",
 * so a parent who typed an exact time or clicked a step chevron here saw the
 * preview update, then had it silently discarded the moment they selected a
 * different clip (the `region.id` effect resets local state from the
 * never-updated `region` prop). This is the ONLY surface with the bug --
 * AnnotateFullscreenOverlay persists via an explicit Save gesture reading
 * local state directly, so it was already fine.
 */

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
  name: 'Test clip',
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

describe('ClipDetailsEditor trim persistence (T9480 review fix, BLOCKING #1)', () => {
  it('typed Enter commit on the start field persists via onUpdate, not just local preview', () => {
    const { onUpdate } = renderEditor();
    fireEvent.click(screen.getByTestId('trim-field-start'));
    const input = screen.getByTestId('trim-field-input-start');
    fireEvent.change(input, { target: { value: '2.9' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdate).toHaveBeenCalledWith({ startTime: 2.9, endTime: 10 });
  });

  it('blur commit also persists (same as Enter)', () => {
    const { onUpdate } = renderEditor();
    fireEvent.click(screen.getByTestId('trim-field-end'));
    const input = screen.getByTestId('trim-field-input-end');
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.blur(input);

    expect(onUpdate).toHaveBeenCalledWith({ startTime: 5, endTime: 20 });
  });

  it('a step-chevron click persists (not just Enter/blur)', () => {
    const { onUpdate } = renderEditor();
    const stepButtons = screen.getAllByTitle('Step one frame (1/30 s)');
    fireEvent.click(stepButtons[1]); // step forward on the start field

    expect(onUpdate).toHaveBeenCalledWith({ startTime: 5 + 1 / 30, endTime: 10 });
  });

  it('Escape still discards without persisting (no regression)', () => {
    const { onUpdate } = renderEditor();
    fireEvent.click(screen.getByTestId('trim-field-start'));
    const input = screen.getByTestId('trim-field-input-start');
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onUpdate).not.toHaveBeenCalled();
  });
});
