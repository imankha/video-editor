import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FocusPublishActionBar } from './FocusPublishActionBar';
import { FOCUS_PUBLISH, RESULT_RETENTION } from '../config/displayNames';

function makeHandlers() {
  return {
    onAddSpotlight: vi.fn(),
    onPublish: vi.fn(),
    onRefocus: vi.fn(),
    onSaveDraft: vi.fn(),
  };
}

// T10670: each tile IS the button (a role="button" div named via aria-labelledby);
// only the "Done for now" exit is a real <button>. getAllByRole('button') returns
// both, in DOM order. Resolve each control's accessible name for order assertions.
function accessibleName(el) {
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) return document.getElementById(labelledby)?.textContent ?? '';
  return el.textContent.trim();
}

describe('FocusPublishActionBar (T8390, re-hierarchized T9590, celebration tiles T10670)', () => {
  // The ONE test that pins the literal approved copy. Everything below queries via
  // FOCUS_PUBLISH so a future rename doesn't break unrelated assertions -- but a
  // rename still has to come here and be made deliberately, which is the point.
  it('renders the headline, three tile choices + the exit link with the approved copy and captions', () => {
    render(<FocusPublishActionBar {...makeHandlers()} />);

    expect(screen.getByRole('heading', { name: 'Your clip is ready' })).toBeTruthy();

    expect(screen.getByRole('button', { name: 'Add spotlight' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish without spotlight' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit framing' })).toBeTruthy();
    // The quiet exit is "Done for now" (was "Save draft"); no "Save" verb remains.
    expect(screen.getByRole('button', { name: 'Done for now' })).toBeTruthy();

    // Short, non-italic tile captions (T10670).
    expect(screen.getByText('Point out your athlete to everyone watching.')).toBeTruthy();
    // Destination + honest precondition stated on the publish choice BEFORE the tap.
    expect(screen.getByText('Goes to Published. Nobody else can see this until you share a link.')).toBeTruthy();
    // Re-render charge stated on the edit-framing choice BEFORE the tap.
    expect(screen.getByText('Reframe and export again. Uses credits.')).toBeTruthy();
  });

  // T10670: the retention line is now a one-word "Saved" chip beside the headline;
  // it renders when the screen passes it and is absent when null.
  it('renders the "Saved" chip beside the headline when provided, and omits it otherwise', () => {
    // A framing completion resolves to the one-word "Saved" chip text.
    expect(RESULT_RETENTION.PRIVATE_DRAFT).toBe('Saved');
    const { rerender, container } = render(
      <FocusPublishActionBar {...makeHandlers()} retentionNote={RESULT_RETENTION.PRIVATE_DRAFT} />,
    );
    const el = container.querySelector('[data-testid="focus-retention-note"]');
    expect(el).toBeTruthy();
    expect(el.textContent).toBe(RESULT_RETENTION.PRIVATE_DRAFT);
    // It is a chip (rounded-full), NOT one of the rounded-xl tiles.
    expect(el.closest('[class*="rounded-xl"]')).toBeNull();
    expect(el.className).toMatch(/rounded-full/);

    rerender(<FocusPublishActionBar {...makeHandlers()} retentionNote={null} />);
    expect(container.querySelector('[data-testid="focus-retention-note"]')).toBeNull();
  });

  it('the Publish tile carries data-tutorial-target="focus-publish" exactly once (guided-path rule 30 anchor)', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const matches = container.querySelectorAll('[data-tutorial-target="focus-publish"]');
    expect(matches.length).toBe(1);
    // The anchor moved from the inner pill to the tile itself (a role="button" div).
    expect(matches[0].getAttribute('role')).toBe('button');
    expect(accessibleName(matches[0])).toContain('Publish');
  });

  it('each choice fires its own handler', () => {
    const handlers = makeHandlers();
    render(<FocusPublishActionBar {...handlers} />);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL }));
    expect(handlers.onAddSpotlight).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL }));
    expect(handlers.onPublish).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.EDIT_FRAMING_LABEL }));
    expect(handlers.onRefocus).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.SAVE_DRAFT_LABEL }));
    expect(handlers.onSaveDraft).toHaveBeenCalledTimes(1);
  });

  // The whole tile is the target: clicking the caption or the title (never a nested
  // control now) fires the tile's handler exactly once.
  it('clicking anywhere in a tile (caption or title) fires the handler exactly once', () => {
    const handlers = makeHandlers();
    render(<FocusPublishActionBar {...handlers} />);

    fireEvent.click(screen.getByText(FOCUS_PUBLISH.SPOTLIGHT_CAPTION));
    expect(handlers.onAddSpotlight).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText(FOCUS_PUBLISH.EDIT_FRAMING_LABEL));
    expect(handlers.onRefocus).toHaveBeenCalledTimes(1);
  });

  it('each tile is keyboard-activatable with Enter/Space and is the ONLY focusable element in it', () => {
    const handlers = makeHandlers();
    const { container } = render(<FocusPublishActionBar {...handlers} />);

    const primaryTile = container.querySelector('[data-testid="focus-choice-primary"]');
    expect(primaryTile.getAttribute('role')).toBe('button');
    expect(primaryTile.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(primaryTile, { key: 'Enter' });
    expect(handlers.onAddSpotlight).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(primaryTile, { key: ' ' });
    expect(handlers.onAddSpotlight).toHaveBeenCalledTimes(2);

    // One tab stop per tile: no nested focusable (no inner button, no inner tabindex).
    expect(primaryTile.querySelectorAll('button, [tabindex]').length).toBe(0);
  });

  it('a loading Publish tile ignores clicks and is aria-disabled with a spinner disc', () => {
    const handlers = makeHandlers();
    render(<FocusPublishActionBar {...handlers} publishLoading />);
    const publishTile = screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL });
    fireEvent.click(screen.getByText(FOCUS_PUBLISH.PUBLISH_CAPTION));
    expect(handlers.onPublish).not.toHaveBeenCalled();
    expect(publishTile.getAttribute('aria-disabled')).toBe('true');
    // The disc icon swaps to a spinning Loader.
    expect(publishTile.querySelector('.animate-spin')).toBeTruthy();
  });

  it('publishLoading disables the Publish tile only', () => {
    render(<FocusPublishActionBar {...makeHandlers()} publishLoading />);
    expect(screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL }).getAttribute('aria-disabled')).not.toBe('true');
  });

  // T9590 hierarchy, preserved by T10670: one dominant PRIMARY tile, then a
  // secondary + tertiary tile, then a quiet exit link that is NOT a competing tile.
  it('sets ONE dominant primary tile apart from the other tiles', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const tiles = Array.from(container.querySelectorAll('[class*="rounded-xl"]'));
    // Exactly three tiles.
    expect(tiles).toHaveLength(3);

    // The primary tile is visually distinguished (cyan gradient), the others are
    // not -- so the tile class lists are NOT all identical.
    const classSets = new Set(tiles.map((t) => t.className));
    expect(classSets.size).toBeGreaterThan(1);

    const primary = container.querySelector('[data-testid="focus-choice-primary"]');
    expect(primary).toBeTruthy();
    expect(primary.className).toMatch(/cyan/);
    // The primary tile is the FIRST tile in the grid.
    expect(tiles[0]).toBe(primary);
  });

  it('Done for now is a quiet ghost link OUTSIDE the tile grid (not a fourth competing tile)', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const saveDraft = container.querySelector('[data-testid="focus-save-draft"]');
    expect(saveDraft).toBeTruthy();
    // It is not a tile, and it is not nested inside one.
    expect(saveDraft.closest('[class*="rounded-xl"]')).toBeNull();
    // It is a ghost button (transparent), distinct from the filled/outlined tiles.
    expect(saveDraft.className).toMatch(/bg-transparent/);
  });

  // Tab order follows the visual hierarchy: primary -> secondary -> tertiary ->
  // quiet exit. DOM order IS tab order (no tabIndex juggling), so assert DOM order.
  it('reads Add spotlight, Publish, Edit framing, Done for now in that DOM/tab order, with no order-* juggling', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    const names = screen.getAllByRole('button').map(accessibleName);
    expect(names).toEqual([
      FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL,
      FOCUS_PUBLISH.PUBLISH_LABEL,
      FOCUS_PUBLISH.EDIT_FRAMING_LABEL,
      FOCUS_PUBLISH.SAVE_DRAFT_LABEL,
    ]);
    expect(container.innerHTML).not.toMatch(/(?:^|\s)(?:\w+:)?order-(?:\d+|first|last)\b/);
  });

  // jsdom does no layout, so this can only prove the CLASSES that prevent wrapping
  // are present. Every control (three tiles + the exit link) has a nowrap title span.
  it('each control title is wrapped in a whitespace-nowrap span, so the grid column floor equals its full width', () => {
    render(<FocusPublishActionBar {...makeHandlers()} />);
    screen.getAllByRole('button').forEach((el) => {
      expect(el.querySelector('span.whitespace-nowrap')).toBeTruthy();
    });
  });

  // Tripwire for T8390's round-6 landmine, carried through the T10670 restructure:
  // `max-content` silently sizes columns off the WRAPPABLE caption instead of the
  // title, reintroducing a real horizontal scrollbar at desktop widths. The full
  // row is gated at lg: (three tiles fit well under 1024px), NOT sm:, and there is
  // no overflow-x-auto safety net (it would fail OPEN).
  it('floors grid columns by min-content and gates the 3-across row at lg:, with no overflow-x-auto', () => {
    const { container } = render(<FocusPublishActionBar {...makeHandlers()} />);
    expect(container.innerHTML).toMatch(/minmax\(min-content,1fr\)/);
    expect(container.innerHTML).not.toMatch(/minmax\(max-content,1fr\)/);
    expect(container.innerHTML).toMatch(/lg:grid-cols-\[repeat\(3,minmax\(min-content,1fr\)\)\]/);
    expect(container.innerHTML).not.toMatch(/overflow-x-auto/);
  });
});
