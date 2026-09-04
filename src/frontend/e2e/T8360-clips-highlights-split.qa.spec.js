import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { waitForAppReady } from './helpers/appReady.js';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

/**
 * T8360 QA — split single-clip "Clips" drafts from multi-clip "Highlights" drafts
 * (LIVE, real user). Drives the app as imankh@gmail.com so the account's real mixed
 * drafts (both auto-created and manually-assembled) exercise the split without
 * needing to fabricate fixtures.
 *
 * Acceptance-criterion map (T8360-design.md, T8545 supersedes the entry-point +
 * naming ACs below — see T8545's own e2e file for the tab-bar/rename coverage):
 *   AC1 Clips tab (Home) shows ONLY is_auto_created===true projects,
 *       never a multi-clip "N clips" badge, no Create Highlight Reel button here
 *   AC2 Highlights tab (DownloadsPanel, inline since T8545) shows a Highlights
 *       (in-progress) section with ONLY is_auto_created===false projects, above
 *       the published list
 *   AC3 Create Highlight Reel button lives on the Highlights tab, not on the
 *       Clips tab
 *   AC4 no surface renders stale "Reel Drafts" terminology
 *   AC5 responsive (375px mobile + desktop) — no horizontal overflow on either surface
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T8360-clips-highlights-split.qa.spec.js --reporter=line
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE_ID = process.env.E2E_REAL_PROFILE || '9fa7378c';

test.beforeEach(async ({ context }) => {
  await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
});

test('AC1/AC3/AC4: Clips tab shows only single-clip auto-drafts, no Create button, no stale naming', async ({ page }) => {
  await page.goto('/home/reels');
  await waitForAppReady(page, { ready: page.getByRole('button', { name: /^Clips/ }) });

  // Ground truth from the API: every project the account has, keyed by is_auto_created,
  // plus whether ANY game has extracted clips (drives the dead-end guard below).
  const [projects, games] = await page.evaluate(async () => {
    const [pr, gr] = await Promise.all([
      fetch('/api/projects', { credentials: 'include' }),
      fetch('/api/games', { credentials: 'include' }),
    ]);
    const projectsJson = pr.ok ? await pr.json() : [];
    const gamesJson = gr.ok ? (await gr.json()).games ?? [] : [];
    return [projectsJson, gamesJson];
  });
  const autoDrafts = projects.filter((p) => p.is_auto_created);
  const highlightDrafts = projects.filter((p) => !p.is_auto_created);
  const hasClips = games.some((g) => g.clip_count > 0);

  const tab = page.getByRole('button', { name: /^Clips/ });
  await expect(tab).toBeVisible();
  // AC4: no stale "Reel Drafts" copy anywhere on this tab.
  await expect(page.locator('body')).not.toContainText('Reel Drafts');
  // AC3: Create Highlight Reel does not live on Home anymore.
  await expect(page.getByRole('button', { name: 'Create Highlight Reel' })).toHaveCount(0);

  if (autoDrafts.length === 0 && !hasClips) {
    // Real, provable state for a fully empty account: the dead-end guard must
    // disable the tab (clipsTabDisabled) rather than showing a false-empty list.
    await expect(tab).toBeDisabled();
    await expect(tab).toHaveAttribute('title', /Extract clips from a game first/i);
  } else if (autoDrafts.length > 0) {
    // AC1: the tab's count chip reflects auto-drafts only, not the full projects list.
    await expect(tab).toContainText(String(autoDrafts.length));

    // AC1: every visible project card corresponds to an auto-draft id -- no multi-clip
    // card (by id) renders here, even if the account happens to have both kinds. The
    // poster <img> src (`/api/projects/{id}/poster.jpg`) is the only id carrier in the
    // DOM (DraftTile has no data-project-id attribute).
    const cardIds = await page.locator('[data-testid="project-card"] img').evaluateAll(
      (els) => els.map((el) => el.src.match(/\/projects\/(\d+)\/poster\.jpg/)?.[1]).filter(Boolean)
    );
    const highlightIds = new Set(highlightDrafts.map((p) => String(p.id)));
    for (const id of cardIds) {
      expect(highlightIds.has(id), `Clips tab must not render multi-clip project ${id}`).toBe(false);
    }
  } else {
    console.log('[qa] account has extracted clips but no auto-drafts yet -- skipping the data cross-check, structural assertions above still ran');
  }

  await saveEvidence(page, 'T8360-AC1-AC3-AC4-clips-tab-desktop');
  await responsiveSweep(page);
});

test('AC2/AC3/AC4: Highlights tab shows Highlights (in-progress) above published, with the Create button', async ({ page }) => {
  await page.goto('/home/highlights');
  await waitForAppReady(page, { ready: page.getByTestId('highlights-tab-panel') });

  const projects = await page.evaluate(async () => {
    const r = await fetch('/api/projects', { credentials: 'include' });
    return r.ok ? r.json() : [];
  });
  const autoDrafts = projects.filter((p) => p.is_auto_created);

  const panel = page.getByTestId('highlights-tab-panel');
  await expect(panel.getByText('Highlights', { exact: true })).toBeVisible({ timeout: 10000 });

  // AC3: the relocated Create Highlight Reel button lives here.
  await expect(page.getByRole('button', { name: 'Create Highlight Reel' })).toBeVisible();
  // AC4: no stale "Reel Drafts" copy on this surface either.
  await expect(panel).not.toContainText('Reel Drafts');

  // AC2: the Highlights section sits ABOVE the published reel cards (CollectionsTab
  // has no separate section heading of its own -- `data-testid="reel-card"` is the
  // published list's own real content, not the panel's shared top header).
  const highlightsY = await panel.getByText('Highlights', { exact: true }).boundingBox();
  const publishedReel = page.getByTestId('reel-card').first();
  if (await publishedReel.count() > 0) {
    const publishedY = await publishedReel.boundingBox();
    if (highlightsY && publishedY) {
      expect(highlightsY.y, 'Highlights section must render above published reel cards').toBeLessThan(publishedY.y);
    }
  }

  // AC1 cross-check: no single-clip auto-draft id renders inside the Highlights section.
  const cardIds = await panel.locator('[data-testid="project-card"] img').evaluateAll(
    (els) => els.map((el) => el.src.match(/\/projects\/(\d+)\/poster\.jpg/)?.[1]).filter(Boolean)
  );
  if (cardIds.length > 0) {
    const autoIds = new Set(autoDrafts.map((p) => String(p.id)));
    for (const id of cardIds) {
      expect(autoIds.has(id), `Highlights section must not render single-clip project ${id}`).toBe(false);
    }
  }

  await saveEvidence(page, 'T8360-AC2-AC3-AC4-highlights-section-desktop');
  await responsiveSweep(page);
});
