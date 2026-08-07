import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import OverlaySettingsTabs from './OverlaySettingsTabs';

afterEach(() => cleanup());

describe('OverlaySettingsTabs — disabledTabIds (T6630 round 6 item 2)', () => {
  it('a dimmed tab renders a dimmed style and a title explaining why', () => {
    render(
      <OverlaySettingsTabs
        activeTab="overlay"
        overlayPanel={<div>overlay content</div>}
        textPanel={<div>text content</div>}
        thumbnailPanel={<div>thumbnail content</div>}
        disabledTabIds={['text']}
      />
    );
    const textTab = screen.getByTestId('overlay-tab-text');
    expect(textTab.className).toMatch(/opacity-50/);
    expect(textTab.getAttribute('title')).toMatch(/no text region/i);
  });

  it('a dimmed tab is STILL CLICKABLE (never the native disabled attribute, never aria-disabled)', () => {
    // A brand-new video has ZERO regions anywhere yet -- blocking the click
    // would make the Text tab's own "click the timeline to add one"
    // guidance unreachable, with no path back into the panel that explains
    // what to do. Dimmed means deprioritized, not unclickable. Also NOT
    // aria-disabled: empirically, Playwright's own actionability check
    // treats aria-disabled="true" as blocking .click() the same as the
    // native attribute (a real hang was diagnosed from this), and that
    // matches real assistive-tech expectations for that ARIA state -- so a
    // control meant to stay genuinely operable must not carry it.
    const onTabChange = vi.fn();
    render(
      <OverlaySettingsTabs
        activeTab="overlay"
        onTabChange={onTabChange}
        overlayPanel={<div>overlay content</div>}
        textPanel={<div>text content</div>}
        thumbnailPanel={<div>thumbnail content</div>}
        disabledTabIds={['text']}
      />
    );
    const textTab = screen.getByTestId('overlay-tab-text');
    expect(textTab.disabled).toBe(false);
    fireEvent.click(textTab);
    expect(onTabChange).toHaveBeenCalledWith('text');
  });

  it('other tabs stay enabled and clickable while text is dimmed', () => {
    const onTabChange = vi.fn();
    render(
      <OverlaySettingsTabs
        activeTab="overlay"
        onTabChange={onTabChange}
        overlayPanel={<div>overlay content</div>}
        textPanel={<div>text content</div>}
        thumbnailPanel={<div>thumbnail content</div>}
        disabledTabIds={['text']}
      />
    );
    fireEvent.click(screen.getByTestId('overlay-tab-thumbnail'));
    expect(onTabChange).toHaveBeenCalledWith('thumbnail');
  });

  it('no tabs are dimmed by default (backwards compatible)', () => {
    render(
      <OverlaySettingsTabs
        activeTab="overlay"
        overlayPanel={<div>overlay content</div>}
        textPanel={<div>text content</div>}
        thumbnailPanel={<div>thumbnail content</div>}
      />
    );
    expect(screen.getByTestId('overlay-tab-text').getAttribute('title')).toBeNull();
  });

  it('an ALREADY-ACTIVE dimmed tab still renders its panel content (no forced navigation away)', () => {
    // T6630 round 6: the playhead can tick past a region boundary while the
    // user is looking at the Text tab -- it must not yank them to a
    // different tab mid-edit, just read as unavailable for FUTURE clicks in.
    render(
      <OverlaySettingsTabs
        activeTab="text"
        overlayPanel={<div>overlay content</div>}
        textPanel={<div data-testid="text-panel-content">text content</div>}
        thumbnailPanel={<div>thumbnail content</div>}
        disabledTabIds={['text']}
      />
    );
    expect(screen.getByTestId('text-panel-content')).toBeTruthy();
    expect(screen.getByTestId('overlay-tab-text').getAttribute('title')).toMatch(/no text region/i);
  });
});

describe('OverlaySettingsTabs — responsive body height (T6630 round 6 item 5)', () => {
  // Was a hard-coded h-[26rem] (416px) regardless of actual viewport space
  // ("why am i getting scroll bars when i have vertical space"). Now measured
  // from window.innerHeight minus the panel's own top offset, clamped to
  // [416, 768], recomputed on mount + resize only (never on content change --
  // that's what preserves the "selecting a block never reflows" invariant).
  function mockViewport(innerHeight, panelTop) {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(innerHeight);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: panelTop, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: panelTop,
    });
  }

  afterEach(() => vi.restoreAllMocks());

  it('grows past 26rem on a tall desktop viewport with room to spare', () => {
    mockViewport(1400, 200); // 1400 - 200 - 24 margin = 1176, capped at MAX (768)
    render(
      <OverlaySettingsTabs
        activeTab="overlay"
        overlayPanel={<div>overlay content</div>}
        textPanel={<div>text content</div>}
        thumbnailPanel={<div>thumbnail content</div>}
      />
    );
    const panel = screen.getByTestId('overlay-tabpanel-overlay');
    expect(parseInt(panel.style.height, 10)).toBe(768); // MAX_BODY_H cap
  });

  it('a moderate desktop viewport gets a height BETWEEN the old fixed 416px and the max cap', () => {
    mockViewport(900, 150); // 900 - 150 - 24 = 726
    render(
      <OverlaySettingsTabs
        activeTab="overlay"
        overlayPanel={<div>overlay content</div>}
        textPanel={<div>text content</div>}
        thumbnailPanel={<div>thumbnail content</div>}
      />
    );
    const panel = screen.getByTestId('overlay-tabpanel-overlay');
    const h = parseInt(panel.style.height, 10);
    expect(h).toBe(726);
    expect(h).toBeGreaterThan(416);
    expect(h).toBeLessThan(768);
  });

  it('never shrinks below the old 416px floor on a genuinely short viewport', () => {
    mockViewport(500, 200); // 500 - 200 - 24 = 276, below the floor
    render(
      <OverlaySettingsTabs
        activeTab="overlay"
        overlayPanel={<div>overlay content</div>}
        textPanel={<div>text content</div>}
        thumbnailPanel={<div>thumbnail content</div>}
      />
    );
    const panel = screen.getByTestId('overlay-tabpanel-overlay');
    expect(parseInt(panel.style.height, 10)).toBe(416); // MIN_BODY_H floor
  });

  it('stays the SAME height across a tab switch within the same instance (content change never re-measures)', () => {
    mockViewport(900, 150); // measured ONCE at mount: 900 - 150 - 24 = 726
    const { rerender } = render(
      <OverlaySettingsTabs
        activeTab="overlay"
        overlayPanel={<div>overlay content</div>}
        textPanel={<div>text content</div>}
        thumbnailPanel={<div>thumbnail content</div>}
      />
    );
    expect(parseInt(screen.getByTestId('overlay-tabpanel-overlay').style.height, 10)).toBe(726);

    // Switching the active tab is a prop change / content swap, NOT a resize
    // -- even though the mocked geometry now claims more room available, the
    // height must stay exactly what it was measured at on mount.
    mockViewport(900, 400); // would compute 476 if (wrongly) re-measured here
    rerender(
      <OverlaySettingsTabs
        activeTab="text"
        overlayPanel={<div>overlay content</div>}
        textPanel={<div>text content</div>}
        thumbnailPanel={<div>thumbnail content</div>}
      />
    );
    expect(parseInt(screen.getByTestId('overlay-tabpanel-text').style.height, 10)).toBe(726);
  });

  it('re-measures on a window resize event, not on every render', () => {
    mockViewport(900, 150);
    render(
      <OverlaySettingsTabs
        activeTab="overlay"
        overlayPanel={<div>overlay content</div>}
        textPanel={<div>text content</div>}
        thumbnailPanel={<div>thumbnail content</div>}
      />
    );
    const panel = screen.getByTestId('overlay-tabpanel-overlay');
    expect(parseInt(panel.style.height, 10)).toBe(726);

    mockViewport(1200, 150); // 1200 - 150 - 24 = 1026, capped at 768
    fireEvent(window, new Event('resize'));
    expect(parseInt(panel.style.height, 10)).toBe(768);
  });
});
