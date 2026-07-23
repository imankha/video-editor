/**
 * usabilityAudit — executable definition of "this screen is usable at this viewport".
 *
 * The reason a total mobile blocker (T4880: Framing/Overlay controls unreachable
 * below the timeline) shipped to production and was found by a USER is that the
 * E2E suite ran exactly one Playwright project (Desktop Chrome) and asserted
 * FUNCTIONALITY, never USABILITY. Nothing anywhere checked "can a person on a
 * phone actually reach and press this button". This module is that missing check,
 * expressed as three behavioral invariants a screen must satisfy at every viewport:
 *
 *   1. Every primary action is REACHABLE + CLICKABLE — it can be scrolled into
 *      view and is visible, enabled, and hit-testable (not covered by a fixed
 *      overlay, not clipped outside the scroll area). This is the exact T4880
 *      failure class.
 *   2. No HORIZONTAL OVERFLOW — the page body never scrolls sideways.
 *   3. No DEAD SCROLL TRAP — if content exceeds the viewport, some container
 *      actually scrolls to expose it (T4880 was content below a 100vh
 *      overflow-hidden shell with no scroller: unreachable forever).
 *
 * Assertions are BEHAVIORAL, never pixel snapshots — snapshots across a device
 * matrix are flaky and this task is about usability, not visual regression.
 *
 * HONESTY CAVEAT (documented, not pretended-away): Playwright device emulation
 * reproduces the layout math but NOT iOS Safari's dynamic-toolbar (100vh vs
 * 100dvh) chrome behavior. Invariant #3 catches "unreachable below the fold"
 * regardless of the cause, and the h-screen/100vh lint gate (scripts/
 * check-viewport-units.mjs) blocks the emulator-invisible form at the source, but
 * the final confirmation of a viewport-unit change is still a real-device check.
 */
import { expect } from '@playwright/test';
import { assertNoHorizontalOverflow, saveEvidence } from './qa.js';

export { assertNoHorizontalOverflow };

/**
 * A primary action is reachable + clickable. `scrollIntoViewIfNeeded` + a
 * TRIAL click is the strongest single behavioral proxy: trial:true runs ALL of
 * Playwright's actionability checks (attached, visible, stable, receives events
 * i.e. not covered, and — for a non-`reachOnly` action — enabled) WITHOUT firing
 * the click. Playwright refusing a trial click is exactly the iOS bug class:
 * an element that is present but cannot actually be pressed.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} locator
 * @param {string} label human-readable for the failure message
 * @param {{ reachOnly?: boolean }} [opts] reachOnly: assert visible-after-scroll
 *   only (for controls that may legitimately be disabled in the fullest state but
 *   must still not be clipped/covered).
 */
export async function assertReachable(page, locator, label, opts = {}) {
  await expect(locator, `${label}: should be present`).toHaveCount(1, { timeout: 15000 });
  await locator.scrollIntoViewIfNeeded();
  await expect(locator, `${label}: should be visible`).toBeVisible();
  if (opts.reachOnly) return;
  await expect(locator, `${label}: should be enabled`).toBeEnabled();
  await locator.click({ trial: true, timeout: 5000 });
}

/**
 * No dead scroll trap: an INTERACTIVE element must never be stranded inside a
 * container that CLIPS its overflow (overflow-y hidden/clip) and cannot scroll.
 *
 * This is the exact T4880 shape and is why the check probes CONTAINERS, not the
 * document: the bug was an app shell locked to the viewport (h-screen
 * overflow-hidden) whose content spilled below the fold with no scroller — so a
 * button rendered at, say, 205vh was clipped away forever. At the DOCUMENT level
 * that same overflow:hidden caps scrollHeight to the viewport (the overflow is
 * simply gone), so a document-height probe is blind to it. Scanning for a
 * clipping container whose content-height exceeds its client-height AND that
 * holds an interactive element positioned outside its visible box catches it
 * precisely, while ignoring legitimately-scrollable panes (overflow auto/scroll)
 * and content that fits.
 */
export async function assertNoDeadScrollTrap(page) {
  const trap = await page.evaluate(() => {
    const SLACK = 8; // px tolerance for sub-pixel rounding
    const vh = window.innerHeight;
    const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [onclick]';
    // Only SHELL-LIKE clippers: a container that clips its vertical overflow, is
    // at least half the viewport tall, and holds content taller than its box.
    // The half-viewport floor keeps small widgets (carousels, truncated chips)
    // and off-canvas drawers from tripping the check — we want the app shell /
    // editor-pane class that stranded T4880's controls.
    const clippers = [...document.querySelectorAll('*')].filter((el) => {
      const oy = getComputedStyle(el).overflowY;
      const clips = oy === 'hidden' || oy === 'clip';
      return clips && el.clientHeight >= vh * 0.5 && el.scrollHeight > el.clientHeight + SLACK;
    });
    // Is there a real scroller on the chain from `act` up to (and excluding) the
    // clipping shell? If so the control is reachable by scrolling that inner pane —
    // NOT a dead trap. This is the crux: the modern shell is legitimately
    // `h-dvh overflow-hidden` (App.jsx) with an INNER overflow-auto pane; T4880
    // was that inner pane failing to scroll. Only flag when NOTHING between the
    // control and the shell scrolls.
    const reachableViaInnerScroller = (act, shell) => {
      for (let node = act; node && node !== shell; node = node.parentElement) {
        const oy = getComputedStyle(node).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + SLACK) return true;
      }
      return false;
    };
    for (const el of clippers) {
      const box = el.getBoundingClientRect();
      for (const act of el.querySelectorAll(INTERACTIVE)) {
        const r = act.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue; // hidden/detached
        // Clipped BELOW the fold (the T4880 direction). We deliberately ignore
        // content clipped above/beside — that is the off-canvas menu pattern,
        // not a stranded below-the-timeline control.
        if (r.top < box.bottom - 1) continue;
        if (reachableViaInnerScroller(act, el)) continue; // an inner pane scrolls to it
        return {
          tag: act.tagName.toLowerCase(),
          text: (act.textContent || act.getAttribute('aria-label') || '').trim().slice(0, 40),
          clientH: Math.round(el.clientHeight),
          contentH: Math.round(el.scrollHeight),
        };
      }
    }
    return null;
  });
  if (trap) {
    throw new Error(
      `[usability] dead scroll trap: <${trap.tag}> "${trap.text}" is clipped inside a non-scrolling ` +
      `container (content ${trap.contentH}px in a ${trap.clientH}px clip box) — unreachable, the T4880 failure.`,
    );
  }
}

/**
 * Invariant #4: every listed control is a large-enough TOUCH TARGET.
 * On coarse-pointer (touch) viewports, each action's rendered box must be
 * >= 44x44 CSS px (Apple HIG / WCAG 2.5.5 AAA). This is the T5360 dimension: a
 * tablet is wide AND touch, so width-keyed sizing (the old `sm:min-w-0`) collapsed
 * its icon controls to ~26px; the fix floors them via a pointer media query, and
 * this asserts the floor actually took.
 *
 * Callers pass the SET to check via the manifest's `actions` field — auditScreen
 * feeds it the screen's `touchTargets` (the pressable icon controls), NOT the
 * reachability `actions` (which include nav/text chrome that is intentionally not a
 * 44px icon target). The self-check spec calls it directly with a synthetic
 * single-action manifest to pin both assertion directions.
 *
 * A per-action `minTarget` lets a deliberately-small dense marker (e.g. a packed
 * timeline diamond) document a lower floor rather than force overlap — use it only
 * with a written justification in the manifest.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ name: string, actions: Array<{label:string, locator:(p)=>any, minTarget?:number}> }} manifest
 * @param {{ min?: number }} [opts]
 */
export async function assertTouchTargetSizes(page, manifest, { min = 44 } = {}) {
  for (const action of manifest.actions) {
    const loc = action.locator(page);
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    expect(box, `${manifest.name} > ${action.label}: should have a rendered box`).not.toBeNull();
    const floor = action.minTarget ?? min; // dense timeline markers may justify a lower, documented floor
    // Sub-pixel slack: a 44px min-w/min-h can render at 43.99 after zoom/rounding.
    expect(box.width, `${manifest.name} > ${action.label}: touch target width`).toBeGreaterThanOrEqual(floor - 0.5);
    expect(box.height, `${manifest.name} > ${action.label}: touch target height`).toBeGreaterThanOrEqual(floor - 0.5);
  }
}

/**
 * Invariant #5 (T5674): the floating "Report a problem" trigger must never sit on
 * top of an interactive control. It is a global fixed element (`hidden lg:block`,
 * so present only on wide/desktop) that used to float mid-content over the video's
 * lower-right and collided with the player controls. We assert its rect intersects
 * NO currently-interactive control (a control that is faded/hidden — the video bar
 * at rest — is skipped: it can't be clicked, so an overlap with it is harmless).
 * No-op where the pill isn't rendered (mobile / narrow projects).
 */
export async function assertReportPillClearsControls(page) {
  const hit = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) =>
      /Report a problem/i.test(b.getAttribute('aria-label') || b.textContent || ''),
    );
    const p = btns.find((b) => getComputedStyle(b).position === 'fixed');
    if (!p) return null;
    const cs = getComputedStyle(p);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null;
    const r = p.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    for (const el of document.querySelectorAll('input[type="range"], button, a[href], [role="slider"]')) {
      if (el === p || p.contains(el) || el.contains(p)) continue;
      const q = el.getBoundingClientRect();
      if (q.width < 4 || q.height < 4) continue;
      const es = getComputedStyle(el);
      // Only controls the user can actually click count — faded/hidden video
      // controls (pointer-events:none while not hovered) are not a collision.
      if (es.pointerEvents === 'none' || es.visibility === 'hidden' || es.display === 'none' || +es.opacity === 0) continue;
      const overlaps = !(q.right <= r.left || q.left >= r.right || q.bottom <= r.top || q.top >= r.bottom);
      if (overlaps) {
        return { tag: el.tagName, label: el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').trim().slice(0, 30), cls: (el.className || '').toString().slice(0, 60) };
      }
    }
    return null;
  });
  if (hit) {
    throw new Error(
      `[usability] "Report a problem" pill overlaps an interactive control ` +
      `<${hit.tag}> "${hit.label}" (${hit.cls}) — it must stay in a safe corner clear of the player controls (T5674).`,
    );
  }
}

/**
 * Run the usability invariants against the currently-loaded screen.
 * @param {import('@playwright/test').Page} page
 * @param {{ id: string, name: string, actions: Array<{label:string, locator:(p)=>any, reachOnly?:boolean}>, touchTargets?: Array<{label:string, locator:(p)=>any, minTarget?:number}> }} manifest
 * @param {string} [tag] suffix for evidence screenshots (e.g. orientation)
 */
export async function auditScreen(page, manifest, tag = '') {
  await assertNoHorizontalOverflow(page);
  await assertNoDeadScrollTrap(page);
  await assertReportPillClearsControls(page);
  for (const action of manifest.actions) {
    await assertReachable(page, action.locator(page), `${manifest.name} > ${action.label}`, {
      reachOnly: action.reachOnly,
    });
  }
  // Invariant #4 (touch-target sizes) runs ONLY on coarse-pointer projects — the
  // exact same media query the CSS 44px floor keys off (see tailwind.config.js
  // `coarse-pointer`). Gating on it (not on a viewport width) keeps the check and
  // the fix in lockstep: where the floor applies, we assert it; on fine-pointer
  // desktop the smaller mouse targets are intentional and not checked.
  //
  // It checks the manifest's `touchTargets` — the pressable ICON controls this task
  // floors — which are DISTINCT from `actions` (invariant #1's reachability set). A
  // manifest's nav/text chrome (mode tabs, breadcrumbs, text buttons) is deliberately
  // NOT a 44px icon target, so it lives only in `actions`; floor-checking it would
  // false-fail on controls T5360 never touched. Screens with no touch icon controls
  // omit `touchTargets` (invariant #4 is then a no-op there).
  const coarse = await page.evaluate(
    () => window.matchMedia('(hover: none) and (pointer: coarse)').matches,
  );
  if (coarse && manifest.touchTargets?.length) {
    await assertTouchTargetSizes(page, { ...manifest, actions: manifest.touchTargets });
  }
  await saveEvidence(page, `usability-${manifest.id}${tag ? '-' + tag : ''}`);
}

/**
 * Audit the loaded screen in the project's native orientation, then — for PHONE
 * viewports only — rotate to landscape and re-audit. Keeps the project list lean
 * (one project per device, not one per orientation) while still covering
 * portrait AND landscape for phones, which is where clipping bites hardest.
 * The original viewport is restored afterward.
 */
export async function sweepOrientations(page, manifest) {
  const vp = page.viewportSize();
  const isPhone = vp && Math.min(vp.width, vp.height) <= 480;
  // Native orientation first.
  await runOrientation(page, manifest, isPhone ? 'portrait' : 'default');
  if (!isPhone) return;
  // Rotate to landscape (swap w/h) and re-audit — same loaded screen.
  await page.setViewportSize({ width: vp.height, height: vp.width });
  await page.waitForTimeout(300); // let responsive layout settle
  try {
    await runOrientation(page, manifest, 'landscape');
  } finally {
    await page.setViewportSize(vp); // restore portrait
  }
}

/**
 * Run one orientation, honoring the manifest's `knownIssues`. A known issue is a
 * REAL, already-filed usability failure (task id + note) that this audit surfaced
 * on a specific orientation but that predates the audit landing — we track it
 * loudly instead of leaving the suite red (the repo's known-failures idiom). It
 * is SELF-HEALING: if a known-issue orientation stops failing (the bug got
 * fixed), the audit throws so the stale entry is removed in the same change.
 */
async function runOrientation(page, manifest, orientation) {
  const known = (manifest.knownIssues || []).find((k) => k.orientation === orientation);
  // A known issue can be device-scoped via `appliesWhen(viewport)`: it only
  // reproduces on some viewports (e.g. landscape width >= the sm breakpoint that
  // renders the offending sidebar). On viewports where it does NOT apply, run the
  // normal audit — a pass there is genuine, not a "fixed" signal.
  const vp = page.viewportSize();
  if (!known || (known.appliesWhen && !known.appliesWhen(vp))) {
    return auditScreen(page, manifest, orientation);
  }
  let failed = false;
  try {
    await auditScreen(page, manifest, orientation);
  } catch (e) {
    failed = true;
    console.log(`[usability][known-issue ${known.task}] ${manifest.name} @ ${orientation}: ${known.note}\n  (tracked failure, not a regression) ${String(e).split('\n')[0]}`);
  }
  if (!failed) {
    throw new Error(
      `[usability] known issue ${known.task} (${manifest.name} @ ${orientation}) NO LONGER reproduces — ` +
      `the bug appears fixed. Remove this entry from the manifest's knownIssues.`,
    );
  }
}
