/**
 * T11740 - Editor header fits phones, game name always visible.
 *
 * The bug: `UnifiedHeader` renders one non-wrapping row on mobile (Back + title +
 * chips + three always-labeled mode buttons, ~550px wide). At 390px and below the
 * title (`truncate flex-1 min-w-0`, the only shrinkable child) collapses to 0px and
 * the row overflows, so /annotate and /focus scroll sideways and "Frame Highlight" /
 * "Add Spotlight" are cut off (evidence: iphone/07, iphone/08).
 *
 * The fix: below `md` (768px) the header becomes two rows (title block + chips, then
 * the mode tabs as a 3-col grid); at `md`+ it stays one row exactly as today.
 *
 * This asserts BEHAVIOUR (no horizontal overflow + the title stays visible with a
 * non-zero width) across the phone widths and at the 768 tablet boundary, on both the
 * Annotate and Focus editors. REAL-BROWSER ONLY against a real account with a clipped
 * game + a framing-openable reel draft. Authored as a QA artifact — needs Playwright
 * browsers + a live backend, so it is NOT run in Branch CI; run it against a stack
 * serving CURRENT code via:
 *   bash scripts/dev-verify.sh e2e/T11740-editor-header-no-overflow.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { openFramingDraft } from './helpers/framingDraft.js';
import { openLoadableOverlayDraft } from './helpers/overlayDraft.js';
import { saveEvidence, assertNoHorizontalOverflow } from './helpers/qa.js';

const AUDIT_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const AUDIT_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';
const API_BASE = process.env.E2E_API_BASE || '/api';

// The phone widths from the acceptance criteria plus the 768 tablet boundary, where
// the header must still be exactly one row (and still not overflow).
const WIDTHS = [320, 360, 375, 390, 768];

const headerTitle = (page) => page.getByTestId('editor-header-title');
const editorHeader = (page) => page.getByTestId('editor-header');

/** The editor header title must be rendered, visible, and NOT collapsed to 0px. */
async function assertTitleVisibleWithWidth(page, where) {
  const title = headerTitle(page);
  await expect(title, `${where}: header title must be visible`).toBeVisible();
  const box = await title.boundingBox();
  expect(box, `${where}: header title must have a bounding box`).toBeTruthy();
  expect(box.width, `${where}: header title must have a non-zero width`).toBeGreaterThan(0);
}

/**
 * T11740's own deliverable: the compact header fits the viewport with no internal
 * horizontal overflow (its content width never exceeds its box, and its right edge
 * stays inside the viewport). This is the precise contract for the header fix, and
 * it must hold at EVERY width 320-768 on both editors.
 */
async function assertHeaderFits(page, where) {
  const header = editorHeader(page);
  await expect(header, `${where}: compact header must render`).toBeVisible();
  const m = await header.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    right: el.getBoundingClientRect().right,
    vw: window.innerWidth,
  }));
  expect(m.scrollWidth, `${where}: header content (${m.scrollWidth}) overflows its box (${m.clientWidth})`)
    .toBeLessThanOrEqual(m.clientWidth + 1);
  expect(m.right, `${where}: header right edge (${m.right}) spills past the viewport (${m.vw})`)
    .toBeLessThanOrEqual(m.vw + 1);
}

/**
 * Discover an active game that has clips, via an authenticated request. Doubles as
 * an auth warm-up (validates the session before any page navigation, which avoids
 * the cold-start dev-login/sign-in race on the first test). Mirrors T11150.
 */
async function findActiveGameWithClips(context) {
  const res = await context.request.get(
    `${API_BASE}/games`,
    AUDIT_PROFILE ? { headers: { 'X-Profile-ID': AUDIT_PROFILE } } : undefined,
  );
  expect(res.ok(), `GET ${API_BASE}/games (${res.status()})`).toBeTruthy();
  const games = (await res.json()).games || [];
  return games.find((g) => g.storage_status === 'active' && (g.clip_count || 0) > 0);
}

test.describe('T11740 Annotate editor header fits phones', () => {
  let gameId;

  test.beforeEach(async ({ context }) => {
    test.setTimeout(180_000);
    await loginAsRealUser(context, AUDIT_EMAIL, AUDIT_PROFILE);
    const target = await findActiveGameWithClips(context);
    test.skip(!target, '[T11740] no active game with clips available');
    gameId = target.id;
  });

  for (const width of WIDTHS) {
    test(`@ ${width}px: Annotate header has no horizontal overflow and the game name stays visible`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await openGameInAnnotate(page, gameId);
      await page.locator('.clip-marker').first().waitFor({ state: 'visible', timeout: 30000 });

      // T11740's deliverable: the header itself fits and keeps the game name visible.
      await assertHeaderFits(page, `Annotate @ ${width}px`);
      await assertTitleVisibleWithWidth(page, `Annotate @ ${width}px`);

      // Page-level no-overflow holds at every width EXCEPT 320, where a SEPARATE,
      // pre-existing overflow lives in the video/controls card at AnnotateModeView.jsx:~733
      // (a `flex gap-2` row ~339px wide in a ~278px box). Proven pre-existing: the identical
      // scrollWidth 360 shows on master with this branch's source reverted. That card is
      // owned by T11780 (annotate video-card overflow @320, filed separately) — NOT T11750,
      // whose scope is only the zero-plays action row at AnnotateModeView.jsx:1470-1499. It
      // is file-disjoint from T11740; fixing it here would cross task boundaries. The
      // header-fits assertion above still proves T11740's own fix at 320.
      if (width !== 320) {
        await assertNoHorizontalOverflow(page);
      }
      await saveEvidence(page, `t11740-annotate-${width}`);
    });
  }
});

test.describe('T11740 Focus editor header fits phones', () => {
  test.beforeEach(async ({ context }) => {
    test.setTimeout(180_000);
    await loginAsRealUser(context, AUDIT_EMAIL, AUDIT_PROFILE);
    // Auth warm-up before any navigation (avoids the cold sign-in race).
    await findActiveGameWithClips(context);
  });

  for (const width of WIDTHS) {
    test(`@ ${width}px: Focus header has no horizontal overflow and the play + game name stays visible`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await openFramingDraft(page);

      await assertHeaderFits(page, `Focus @ ${width}px`);
      await assertTitleVisibleWithWidth(page, `Focus @ ${width}px`);
      // Focus has no separate content overflow — the header was the only source,
      // so the whole page must be clean at every width.
      await assertNoHorizontalOverflow(page);
      await saveEvidence(page, `t11740-focus-${width}`);
    });
  }
});

test.describe('T11740 Overlay editor header fits phones', () => {
  test.beforeEach(async ({ context }) => {
    test.setTimeout(180_000);
    await loginAsRealUser(context, AUDIT_EMAIL, AUDIT_PROFILE);
    // Auth warm-up before any navigation (avoids the cold sign-in race).
    await findActiveGameWithClips(context);
  });

  for (const width of WIDTHS) {
    test(`@ ${width}px: Overlay header has no horizontal overflow and the play + game name stays visible`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      // Overlay uses the SAME App.jsx UnifiedHeader instance as Focus (AC1 names
      // /overlay). Opening it needs an In-Overlay draft whose working video streams;
      // if none opens, skip loudly rather than fail (helper's contract).
      // minReadyState:2 — a pure geometry/no-overflow read, no seeking.
      //
      // NOTE (T11905): openLoadableOverlayDraft currently skips in EVERY env — its
      // drafts-filter regex still looks for "In Spotlight (N)" but the chip was
      // renamed "In Overlay (N)" in a Sept copy-pass, so it never matches. Until
      // T11905 fixes the helper, THIS case asserts nothing at runtime (not live-proven).
      //
      // Overlay's header is instead a BYTE-FOR-BYTE STRICT SUBSET of Focus's header,
      // established by reading the render code (not a live sample): App.jsx:1011-1026
      // renders ONE shared <UnifiedHeader editorMode={editorMode}
      // extraControls={<FramingHeaderStatus editorMode=.../>}> for the whole
      // non-Annotate branch (framing AND overlay). In overlay mode the only
      // mode-gated chips both vanish: UnifiedHeader.jsx:80 `{editorMode === 'framing'
      // && <CreditBalance/>}` is false, and extraControls = FramingHeaderStatus which
      // returns null outside framing (FramingHeaderStatus.jsx:18). Back button, title
      // block and the ModeSwitcher row are the same nodes. So Overlay's header == a
      // Focus header with strictly fewer chips → it cannot overflow where Focus (which
      // IS asserted live above) does not. The case is kept so it runs live once T11905 lands.
      const opened = await openLoadableOverlayDraft(page, { minReadyState: 2 });
      test.skip(!opened.ok, `[T11740] no openable In-Overlay draft: ${opened.reason}`);

      await assertHeaderFits(page, `Overlay @ ${width}px`);
      await assertTitleVisibleWithWidth(page, `Overlay @ ${width}px`);
      await assertNoHorizontalOverflow(page);
      await saveEvidence(page, `t11740-overlay-${width}`);
    });
  }
});
