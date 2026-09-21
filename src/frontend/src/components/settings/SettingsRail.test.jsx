import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Sparkles, Type } from 'lucide-react';
import SettingsRail, { MOBILE_PANEL_MAX_VH, MOBILE_PANEL_TWEEN } from './SettingsRail';

afterEach(() => cleanup());

const TABS = [
  { id: 'a', label: 'Alpha', icon: Sparkles },
  { id: 'b', label: 'Beta', icon: Type },
];

/**
 * T9270: the settings rail is collapsible on desktop (width tween to a 64px icon
 * strip) and a translateX drawer on mobile. Open/collapsed is ephemeral view state —
 * the host owns it; this component only renders it. jsdom has no layout, so we assert
 * the STYLE the tween/transform drives (width / transform), not measured geometry.
 */
describe('SettingsRail — desktop collapse (T9270)', () => {
  it('expanded rail is 380px wide and width-tweened', () => {
    render(
      <SettingsRail isMobile={false} collapsed={false} tabs={TABS} activeTab="a" onTabChange={() => {}}>
        <div>body</div>
      </SettingsRail>
    );
    const rail = screen.getByTestId('settings-rail');
    expect(rail.style.width).toBe('380px');
    expect(rail.style.transition).toMatch(/width/);
  });

  it('collapsed rail shrinks to the 64px icon strip (width tween, not transform)', () => {
    render(
      <SettingsRail isMobile={false} collapsed tabs={TABS} activeTab="a" onTabChange={() => {}}>
        <div>body</div>
      </SettingsRail>
    );
    const rail = screen.getByTestId('settings-rail');
    expect(rail.style.width).toBe('64px');
    expect(rail.style.transition).toMatch(/width/);
    // Body is hidden when collapsed; the tab icons remain (icon strip).
    expect(screen.queryByText('body')).toBeNull();
  });

  it('the collapse toggle fires onToggleCollapse (gesture, no persistence)', () => {
    const onToggleCollapse = vi.fn();
    render(
      <SettingsRail isMobile={false} collapsed={false} onToggleCollapse={onToggleCollapse} tabs={TABS} activeTab="a" onTabChange={() => {}}>
        <div>body</div>
      </SettingsRail>
    );
    fireEvent.click(screen.getByTestId('rail-collapse-toggle'));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it('selecting a tab fires onTabChange with the tab id', () => {
    const onTabChange = vi.fn();
    render(
      <SettingsRail isMobile={false} collapsed={false} tabs={TABS} activeTab="a" onTabChange={onTabChange}>
        <div>body</div>
      </SettingsRail>
    );
    fireEvent.click(screen.getByTestId('settings-tab-b'));
    expect(onTabChange).toHaveBeenCalledWith('b');
  });
});

describe('SettingsRail — mobile anchored sheet (T10820)', () => {
  it('closed panel is translated below the fold (translateY(100%), transform only, never a width tween)', () => {
    render(
      <SettingsRail isMobile collapsed={false} open={false} tabs={TABS} activeTab="a" onTabChange={() => {}} title="Settings">
        <div>body</div>
      </SettingsRail>
    );
    const drawer = screen.getByTestId('settings-drawer');
    expect(drawer.style.transform).toBe('translateY(100%)');
    expect(drawer.style.transition).toMatch(/transform/);
    expect(drawer.style.transition).not.toMatch(/width/);
  });

  it('open panel slides up to translateY(0)', () => {
    render(
      <SettingsRail isMobile collapsed={false} open tabs={TABS} activeTab="a" onTabChange={() => {}} title="Settings">
        <div>body</div>
      </SettingsRail>
    );
    const drawer = screen.getByTestId('settings-drawer');
    expect(drawer.style.transform).toBe('translateY(0)');
  });

  it('the panel is anchored with `absolute bottom-full` inside its host wrapper, never `position:fixed` (T10420/T10820 backdrop-filter trap)', () => {
    render(
      <SettingsRail isMobile collapsed={false} open tabs={TABS} activeTab="a" onTabChange={() => {}} title="Settings">
        <div>body</div>
      </SettingsRail>
    );
    const drawer = screen.getByTestId('settings-drawer');
    expect(drawer.className).toMatch(/\babsolute\b/);
    expect(drawer.className).toMatch(/\bbottom-full\b/);
    expect(drawer.className).not.toMatch(/\bfixed\b/);
    // The retired 316px side-drawer geometry is deleted outright, not kept behind a flag.
    expect(drawer.className).not.toMatch(/w-\[316px\]/);
    expect(drawer.style.transform).not.toMatch(/translateX/);
  });

  it('the panel stays mounted (attached) in the DOM while closed — animatable, never conditionally rendered', () => {
    render(
      <SettingsRail isMobile collapsed={false} open={false} tabs={TABS} activeTab="a" onTabChange={() => {}} title="Settings">
        <div>body</div>
      </SettingsRail>
    );
    // getByTestId throws if the element isn't in the tree at all; a truthy return
    // proves it's mounted even though `open` is false (no jest-dom matcher in this repo).
    expect(screen.getByTestId('settings-drawer')).toBeTruthy();
  });

  it('open panel max-height honors the exported MOBILE_PANEL_MAX_VH geometry const (55dvh cap, T10820)', () => {
    render(
      <SettingsRail isMobile collapsed={false} open tabs={TABS} activeTab="a" onTabChange={() => {}} title="Settings">
        <div>body</div>
      </SettingsRail>
    );
    const drawer = screen.getByTestId('settings-drawer');
    // The user-approved cap out of the T10820 design doc's open questions (§8).
    expect(MOBILE_PANEL_MAX_VH).toBe(55);
    expect(drawer.style.maxHeight).toMatch(new RegExp(`${MOBILE_PANEL_MAX_VH}dvh`));
    // Transition is driven by the single exported const (parity with desktop's RAIL_TWEEN).
    expect(drawer.style.transition).toBe(MOBILE_PANEL_TWEEN);
  });

  it('the drawer has its own 44x44 close control that fires onCloseDrawer', () => {
    const onCloseDrawer = vi.fn();
    render(
      <SettingsRail isMobile collapsed={false} open onCloseDrawer={onCloseDrawer} tabs={TABS} activeTab="a" onTabChange={() => {}} title="Settings">
        <div>body</div>
      </SettingsRail>
    );
    const close = screen.getByTestId('drawer-close');
    expect(close.className).toMatch(/w-11/);
    expect(close.className).toMatch(/h-11/);
    fireEvent.click(close);
    expect(onCloseDrawer).toHaveBeenCalledTimes(1);
  });

  it('the scrim never closes the drawer on a tap (no backdrop-close: pointer-events-none)', () => {
    const { container } = render(
      <SettingsRail isMobile collapsed={false} open tabs={TABS} activeTab="a" onTabChange={() => {}} title="Settings">
        <div>body</div>
      </SettingsRail>
    );
    const scrim = container.querySelector('[aria-hidden="true"].bg-black\\/45');
    expect(scrim).toBeTruthy();
    expect(scrim.className).toMatch(/pointer-events-none/);
  });
});
