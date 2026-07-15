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
 * Run the three invariants against the currently-loaded screen.
 * @param {import('@playwright/test').Page} page
 * @param {{ id: string, name: string, actions: Array<{label:string, locator:(p)=>any, reachOnly?:boolean}> }} manifest
 * @param {string} [tag] suffix for evidence screenshots (e.g. orientation)
 */
export async function auditScreen(page, manifest, tag = '') {
  await assertNoHorizontalOverflow(page);
  await assertNoDeadScrollTrap(page);
  for (const action of manifest.actions) {
    await assertReachable(page, action.locator(page), `${manifest.name} > ${action.label}`, {
      reachOnly: action.reachOnly,
    });
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
