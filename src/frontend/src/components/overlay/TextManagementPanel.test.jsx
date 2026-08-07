import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import TextManagementPanel from './TextManagementPanel';

afterEach(() => cleanup());

const REGION_A = {
  id: 'r1', index: 0, startTime: 0, endTime: 2,
  elements: [{ id: 'a1', spec: { text: 'GOAL' }, enabled: true }],
};
const REGION_B_TWO_ELEMENTS = {
  id: 'r2', index: 1, startTime: 5, endTime: 7,
  elements: [
    { id: 'b1', spec: { text: 'First' }, enabled: true },
    { id: 'b2', spec: { text: 'Second' }, enabled: false },
  ],
};

describe('TextManagementPanel — two-column layout, region+element management (T6630 round 4/6)', () => {
  // T6630 round 6 item 1: region creation/deletion moved ENTIRELY onto the
  // timeline lane (explicit user direction: "adding and removing regions is
  // done on the timeline") -- no "Add region" control here anymore, and no
  // onAddRegion/currentTime props (the caller filters `regions` to the
  // playhead-active set BEFORE handing it to this component -- round 6
  // item 2 -- so this component never needs to know the playhead itself).
  it('no "Add region" control is rendered', () => {
    render(<TextManagementPanel regions={[]} />);
    expect(screen.queryByTestId('text-tab-add-region')).toBeNull();
    expect(screen.queryByText(/add region/i)).toBeNull();
  });

  it('shows an empty state (no region under the playhead) with no regions', () => {
    render(<TextManagementPanel regions={[]} />);
    expect(screen.getByText(/no text region under the playhead/i)).toBeTruthy();
  });

  it('lists every region with its time range and every element nested inside it (expanded)', () => {
    // T6630 round 7 item 2: with 2+ regions and none selected, both default
    // collapsed -- expand each via its chevron toggle before checking
    // elements are nested underneath.
    render(<TextManagementPanel regions={[REGION_A, REGION_B_TWO_ELEMENTS]} />);
    expect(screen.getByTestId('text-tab-region-0')).toBeTruthy();
    expect(screen.getByTestId('text-tab-region-1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('text-tab-region-toggle-0'));
    fireEvent.click(screen.getByTestId('text-tab-region-toggle-1'));
    expect(screen.getByTestId('text-tab-element-a1').textContent).toContain('GOAL');
    expect(screen.getByTestId('text-tab-element-b1').textContent).toContain('First');
    expect(screen.getByTestId('text-tab-element-b2').textContent).toContain('Second');
  });

  it('clicking a region selects it', () => {
    const onSelectRegion = vi.fn();
    render(<TextManagementPanel regions={[REGION_A]} onSelectRegion={onSelectRegion} />);
    fireEvent.click(screen.getByTestId('text-tab-region-0').querySelector('[role="button"]'));
    expect(onSelectRegion).toHaveBeenCalledWith('r1');
  });

  it('clicking an element selects it (distinct from selecting the region)', () => {
    const onSelectElement = vi.fn();
    render(<TextManagementPanel regions={[REGION_B_TWO_ELEMENTS]} onSelectElement={onSelectElement} />);
    fireEvent.click(screen.getByTestId('text-tab-element-b2'));
    expect(onSelectElement).toHaveBeenCalledWith('b2');
  });

  it('the per-region "Add text" control appends an ELEMENT into THAT region (not a new region)', () => {
    const onAddElement = vi.fn();
    // Select region B so it's expanded by default (round 7 item 2: the
    // selected region always expands regardless of how many are active).
    render(<TextManagementPanel regions={[REGION_A, REGION_B_TWO_ELEMENTS]} selectedRegionId="r2" onAddElement={onAddElement} />);
    fireEvent.click(screen.getByTestId('text-tab-add-element-1')); // region B (index 1)
    expect(onAddElement).toHaveBeenCalledWith('r2');
  });

  it('the per-region trash removes the whole REGION without selecting it', () => {
    const onSelectRegion = vi.fn();
    const onDeleteTextRegion = vi.fn();
    render(<TextManagementPanel regions={[REGION_A]} onSelectRegion={onSelectRegion} onDeleteTextRegion={onDeleteTextRegion} />);
    fireEvent.click(screen.getByTitle('Delete region (and all its text)'));
    expect(onDeleteTextRegion).toHaveBeenCalledWith('r1');
    expect(onSelectRegion).not.toHaveBeenCalled();
  });

  it('the per-element trash removes only that ELEMENT without selecting it', () => {
    const onSelectElement = vi.fn();
    const onDeleteText = vi.fn();
    render(<TextManagementPanel regions={[REGION_A]} onSelectElement={onSelectElement} onDeleteText={onDeleteText} />);
    fireEvent.click(screen.getByTitle('Delete text block'));
    expect(onDeleteText).toHaveBeenCalledWith('a1');
    expect(onSelectElement).not.toHaveBeenCalled();
  });

  it('the per-element eye toggles that element\'s visibility without selecting it', () => {
    const onSelectElement = vi.fn();
    const onToggleText = vi.fn();
    render(<TextManagementPanel regions={[REGION_A]} onSelectElement={onSelectElement} onToggleText={onToggleText} />);
    fireEvent.click(screen.getByTitle(/hide text/i));
    expect(onToggleText).toHaveBeenCalledWith('a1', false);
    expect(onSelectElement).not.toHaveBeenCalled();
  });

  it('shows the settings editor (with the position grid) ONLY for the selected ELEMENT', () => {
    const { rerender } = render(<TextManagementPanel regions={[REGION_A]} selectedRegionId={null} selectedElementId={null} />);
    expect(screen.queryByTestId('text-position-grid')).toBeNull();
    expect(screen.getByText(/select a text element/i)).toBeTruthy();

    rerender(<TextManagementPanel regions={[REGION_A]} selectedRegionId="r1" selectedElementId="a1" onUpdateTextSpec={() => {}} />);
    expect(screen.getByTestId('text-position-grid')).toBeTruthy();
  });

  it('selecting a region WITHOUT an element does not show settings for a wrong element', () => {
    // Region selected but selectedElementId belongs to a DIFFERENT region --
    // must not accidentally show that element's settings.
    render(<TextManagementPanel regions={[REGION_A, REGION_B_TWO_ELEMENTS]} selectedRegionId="r1" selectedElementId="b1" />);
    expect(screen.queryByTestId('text-position-grid')).toBeNull();
  });

  it('editing the position grid for the selected element calls onUpdateTextSpec with that element id', () => {
    const onUpdateTextSpec = vi.fn();
    render(<TextManagementPanel regions={[REGION_A]} selectedRegionId="r1" selectedElementId="a1" onUpdateTextSpec={onUpdateTextSpec} />);
    fireEvent.click(screen.getByTestId('text-position-top-left'));
    expect(onUpdateTextSpec).toHaveBeenCalledTimes(1);
    expect(onUpdateTextSpec.mock.calls[0][0]).toBe('a1');
    expect(onUpdateTextSpec.mock.calls[0][1].position).toEqual({ x: 0.08, y: 0.08 });
  });

  it('the settings column has its OWN element (fixed box) independent of the list column', () => {
    // Structural check that the two-column layout exists (round 4 item 3):
    // a dedicated settings container that isn't inside the region list.
    render(<TextManagementPanel regions={[REGION_A]} />);
    const list = screen.getByTestId('text-region-list');
    const settings = screen.getByTestId('text-settings-panel');
    expect(list.contains(settings)).toBe(false);
    expect(settings.contains(list)).toBe(false);
  });
});

describe('TextManagementPanel — expand/collapse tree per region (T6630 round 7 item 2)', () => {
  // User: "depending on where the playhead is, we should show all of the
  // text regions it's over and a click down tree style all of the text
  // elements in that region with the option to add a text to that region."
  it('a SINGLE active region auto-expands (its elements are visible without clicking anything)', () => {
    render(<TextManagementPanel regions={[REGION_A]} />);
    expect(screen.getByTestId('text-tab-element-a1')).toBeTruthy();
    expect(screen.getByTestId('text-tab-region-toggle-0').getAttribute('aria-expanded')).toBe('true');
  });

  it('with SEVERAL active regions and none selected, they default COLLAPSED', () => {
    render(<TextManagementPanel regions={[REGION_A, REGION_B_TWO_ELEMENTS]} />);
    expect(screen.queryByTestId('text-tab-element-a1')).toBeNull();
    expect(screen.queryByTestId('text-tab-element-b1')).toBeNull();
    expect(screen.getByTestId('text-tab-region-toggle-0').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('text-tab-region-toggle-1').getAttribute('aria-expanded')).toBe('false');
  });

  it('the SELECTED region among several always expands regardless of the collapsed default', () => {
    render(<TextManagementPanel regions={[REGION_A, REGION_B_TWO_ELEMENTS]} selectedRegionId="r2" />);
    expect(screen.queryByTestId('text-tab-element-a1')).toBeNull(); // r1 not selected -> collapsed
    expect(screen.getByTestId('text-tab-element-b1')).toBeTruthy(); // r2 selected -> expanded
  });

  it('clicking the chevron toggle expands a collapsed region', () => {
    render(<TextManagementPanel regions={[REGION_A, REGION_B_TWO_ELEMENTS]} />);
    expect(screen.queryByTestId('text-tab-element-a1')).toBeNull();
    fireEvent.click(screen.getByTestId('text-tab-region-toggle-0'));
    expect(screen.getByTestId('text-tab-element-a1')).toBeTruthy();
  });

  it('clicking the chevron toggle collapses an expanded (single-active) region', () => {
    render(<TextManagementPanel regions={[REGION_A]} />);
    expect(screen.getByTestId('text-tab-element-a1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('text-tab-region-toggle-0'));
    expect(screen.queryByTestId('text-tab-element-a1')).toBeNull();
  });

  it('clicking the chevron does NOT also select the region (stopPropagation)', () => {
    const onSelectRegion = vi.fn();
    render(<TextManagementPanel regions={[REGION_A, REGION_B_TWO_ELEMENTS]} onSelectRegion={onSelectRegion} />);
    fireEvent.click(screen.getByTestId('text-tab-region-toggle-0'));
    expect(onSelectRegion).not.toHaveBeenCalled();
  });
});
