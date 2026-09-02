/**
 * framingDraft — shared "open a reel draft from its title-regex chip" helper (Family A).
 *
 * WHY THIS EXISTS. Four Framing/Overlay real-account specs each open a reel draft by
 * clicking the drafts-drawer chip whose `title` matches the framing-openable pattern
 * `[tags]: ... (click to open)`. The chip regex was copy-pasted character-for-character
 * into T4550 + T4880 (`openFramingDraft`), echoed with a different post-click wait in
 * T6190 (`openFramingChip`), and inlined in T5370 (`tryReachOverlay`). Divergent copies
 * of this setup are exactly the kind of drift the T7760 redundancy survey flagged, so the
 * canonical regex + the click-and-wait step live here once.
 *
 * The exported `FRAMING_CHIP_TITLE_RE` is the correctly-escaped bracket form
 * `/\[.+\]: .*\(click to open\)/` — the `[` and `]` are literal characters in the chip
 * title, so they must be escaped in the regex. Consumers that need a DIFFERENT matcher
 * (T6190 deliberately matches untagged Focus segments and excludes Overlay segments per
 * T7750) pass their own `titleRe`; the open mechanics stay shared.
 */

/**
 * Canonical drafts-chip title matcher. T7800 (first staging gate run): the bracket-
 * REQUIRING form `/\[.+\]: .*\(click to open\)/` is the documented FIXTURE-CONTRACT
 * chip-title gotcha — only a per-clip segment carries a `[tags]` bracket, so on an
 * account whose drafts are framing-complete/aggregate (title `Focus: ... (click to
 * open)`) it silently matches nothing and the open hangs to timeout. Canonical form is
 * T6190's: any `(click to open)` segment that is NOT the trailing `Overlay:` one.
 */
export const FRAMING_CHIP_TITLE_RE = /^(?!Overlay:).*\(click to open\)/;

/** Default post-click ready signal: the Framing crop editor mounted. */
const DEFAULT_CROP_READY = '.crop-handle';

/**
 * Open the first framing-openable reel draft via its title-regex chip, then wait for the
 * given post-click ready selector (the Framing crop editor by default).
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [opts]
 * @param {string} [opts.waitFor='.crop-handle'] selector to await after the chip click
 *   (the proof the target editor mounted).
 * @param {RegExp} [opts.titleRe=FRAMING_CHIP_TITLE_RE] chip title matcher; override only
 *   when a spec intentionally matches a different chip set (e.g. T6190/T7750).
 * @param {number} [opts.chipTimeout=30000] ms to wait for the chip to appear.
 * @param {number} [opts.readyTimeout=90000] ms to wait for the post-click ready selector.
 */
export async function openFramingDraft(
  page,
  { waitFor = DEFAULT_CROP_READY, titleRe = FRAMING_CHIP_TITLE_RE, chipTimeout = 30000, readyTimeout = 90000 } = {},
) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Clips' }).click();
  const chip = page.getByTitle(titleRe).first();
  await chip.waitFor({ timeout: chipTimeout });
  await chip.click();
  await page.locator(waitFor).first().waitFor({ timeout: readyTimeout });
}
