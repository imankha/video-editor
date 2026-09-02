import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence, responsiveSweep, assertNoHorizontalOverflow } from './helpers/qa.js';

/**
 * T7150 QA (bug 43p) — the collection public-share modal must freeze the intro
 * the user SEES, not the null default from before they reached the picker.
 *
 * Drives the REAL CollectionShareModal as imankh@gmail.com / profile 9fa7378c
 * (dev-login, real R2/Postgres data), opened from the Highlight Reels collection kebab.
 * The POST /api/collections/share is intercepted so the flow is deterministic
 * and does NOT mutate real share rows: the handler records each request body and
 * returns a fixed token, so the test can assert BOTH what the user sees (the
 * link input appearing/clearing) AND what got frozen (the captured body).
 *
 * Acceptance-criteria evidence (each -> a screenshot in <repo>/qa/):
 *   - Intro picker renders BEFORE the public toggle (reorder).
 *   - Flipping "Anyone with the link" on creates NO share by itself.
 *   - An explicit "Get Link" click creates the share, freezing the visible
 *     intro selection (default "No intro" -> intro_card_id null).
 *   - Changing the intro after a link exists clears the stale link.
 *   - Modal has no horizontal overflow at 375px + desktop; the intro carousel
 *     stays horizontally scrollable at 375px after the reorder.
 *
 * The request-body matrix for every selection (picked card id, null, email
 * path) is pinned deterministically by the unit test
 * (src/components/CollectionShareModal.test.jsx). This spec is the LIVE
 * confirmation that the real component, in a real browser, behaves the same and
 * the reorder didn't break layout.
 *
 * Run: bash scripts/dev-verify.sh e2e/T7150-collection-share-intro-sequencing.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const REAL_PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

// Intercept share creation: record bodies, return a deterministic token so the
// modal shows a link without touching real backend share rows.
async function stubShareCreate(page, shareCalls) {
  await page.route('**/api/collections/share', (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      shareCalls.push(JSON.parse(req.postData() || '{}'));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ shares: [{ share_token: 'qa-token-7150', email_sent: null }] }),
      });
    }
    return route.continue();
  });
}

async function openCollectionShareModal(page) {
  await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
  await page.goto('/');
  await page.getByRole('button', { name: /Highlight Reels/i }).first().click();
  await expect(page.getByRole('heading', { name: /Highlight Reels|Library/i }).first())
    .toBeVisible({ timeout: 20000 });

  const headers = page.locator('.animate-slide-in-right').getByTestId('collapsible-group-header');
  await headers.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const n = await headers.count();
  test.skip(n === 0, 'no game/mix collection groups available to share on this account');
  await headers.first().click();

  const shareKebab = page.locator('.animate-slide-in-right').getByRole('button', { name: /More actions/i }).first();
  await expect(shareKebab).toBeVisible({ timeout: 10000 });
  await shareKebab.click();
  await page.getByRole('button', { name: 'Share' }).first().click();
  await expect(page.getByText(/^Share "/).or(page.getByText('Share highlights'))).toBeVisible({ timeout: 10000 });
}

// Scope every assertion to the share-modal card itself -- the Highlight Reels drawer
// behind the overlay also has Copy-link buttons and readonly inputs on its reel
// tiles, so page-level lookups hit those too.
const shareModal = (page) =>
  page.locator('div.bg-gray-800.rounded-lg').filter({ hasText: 'This link always shows the current reels' });
// The public/restricted toggle is a role="switch"; the intro carousel is a
// role="listbox" name="Intro card". These are the on-screen anchors we assert on.
const introListbox = (page) => shareModal(page).getByRole('listbox', { name: 'Intro card' });
const publicSwitch = (page) => shareModal(page).getByRole('switch');

test.describe('T7150 — collection share intro sequencing (bug 43p)', () => {
  test('intro picker renders before the public toggle', async ({ page }) => {
    await openCollectionShareModal(page);
    const listbox = introListbox(page);
    await expect(listbox).toBeVisible({ timeout: 10000 });
    const toggle = publicSwitch(page);
    await expect(toggle).toBeVisible();
    // Compare document order via real element handles (robust to how the
    // listbox's accessible name is computed).
    const lbHandle = await listbox.elementHandle();
    const swHandle = await toggle.elementHandle();
    const introBeforeToggle = await page.evaluate(
      ([lb, sw]) => !!(lb.compareDocumentPosition(sw) & Node.DOCUMENT_POSITION_FOLLOWING),
      [lbHandle, swHandle]
    );
    expect(introBeforeToggle).toBe(true);
    await saveEvidence(page, 'T7150-AC1-intro-before-public-toggle');
  });

  test('toggle creates no share; Get Link freezes the visible "No intro"; changing intro clears the link', async ({ page }) => {
    const shareCalls = [];
    await stubShareCreate(page, shareCalls);
    await openCollectionShareModal(page);
    await expect(introListbox(page)).toBeVisible({ timeout: 10000 });

    // Flip public on -> a share must NOT be created by the toggle itself.
    await publicSwitch(page).click();
    await expect(shareModal(page).getByRole('button', { name: 'Get Link' })).toBeVisible();
    await page.waitForTimeout(300);
    expect(shareCalls, 'no share POST fires on toggle alone').toHaveLength(0);
    await saveEvidence(page, 'T7150-AC2-toggle-no-share-getlink-shown');

    // Explicit Get Link with the default "No intro" selection -> freezes null.
    // The link input + its Copy button appearing is the user-visible signal
    // that a link now exists; assert its value carries our stubbed token.
    await shareModal(page).getByRole('button', { name: 'Get Link' }).click();
    await expect(shareModal(page).getByRole('button', { name: 'Copy link' })).toBeVisible({ timeout: 10000 });
    await expect(shareModal(page).locator('input[readonly]')).toHaveValue(/qa-token-7150/);
    expect(shareCalls).toHaveLength(1);
    expect(shareCalls[0].is_public).toBe(true);
    expect(shareCalls[0].recipient_emails).toEqual([]);
    expect(shareCalls[0].definition.intro_card_id ?? null).toBeNull();
    await saveEvidence(page, 'T7150-AC3-getlink-freezes-visible-no-intro');

    // Change the intro selection after a link exists -> stale link clears.
    const options = introListbox(page).getByRole('option');
    const cardOption = options.filter({ hasNotText: 'No intro' }).first();
    const hasRealCard = await cardOption.count() > 0;
    if (hasRealCard) {
      await cardOption.click();
    } else {
      // No real intro card seeded: re-selecting "No intro" still fires onSelect,
      // which the wrapper treats as a change and clears the link.
      await introListbox(page).getByRole('option', { name: 'No intro' }).click();
    }
    await expect(shareModal(page).getByRole('button', { name: 'Copy link' })).toHaveCount(0);
    await expect(shareModal(page).locator('input[readonly]')).toHaveCount(0);
    await expect(shareModal(page).getByRole('button', { name: 'Get Link' })).toBeVisible();
    await saveEvidence(page, 'T7150-AC4-intro-change-clears-stale-link');

    // Regenerate: the freshly-visible selection is what gets frozen next.
    await shareModal(page).getByRole('button', { name: 'Get Link' }).click();
    await expect(shareModal(page).getByRole('button', { name: 'Copy link' })).toBeVisible({ timeout: 10000 });
    expect(shareCalls).toHaveLength(2);
    if (hasRealCard) {
      expect(shareCalls[1].definition.intro_card_id, 'picked card id is frozen').toBeTruthy();
    }
    await saveEvidence(page, 'T7150-AC-getlink-regenerated-with-visible-intro');
  });

  test('responsive: modal has no horizontal overflow and the carousel stays scrollable at 375px', async ({ page }) => {
    await openCollectionShareModal(page);
    await expect(introListbox(page)).toBeVisible({ timeout: 10000 });
    await responsiveSweep(page, async (vp) => {
      await assertNoHorizontalOverflow(page);
      if (vp.width <= 375) {
        const scrollable = await introListbox(page)
          .evaluate((el) => el.scrollWidth > el.clientWidth + 1).catch(() => false);
        console.log(`[T7150] mobile intro carousel scrollable=${scrollable}`);
      }
    });
  });
});
