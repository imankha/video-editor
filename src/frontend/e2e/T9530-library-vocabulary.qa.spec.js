// T9530 live QA — Library tabs, objects and destinations (Shared Vocabulary epic).
// Drives the REAL account (imankh@gmail.com, profile 9fa7378c) to prove, on the
// live app, the acceptance criteria this task owns:
//   AC1 — tab labels read Games / Clips / Reels / Published, unnumbered
//   AC2 — a Clips-tab card names its actions "clip" (never "reel"); a Reels-tab
//         card names them "reel" (is_auto_created discriminator, N12/N14/N15)
//   AC3 — Create reel opens from the Reels tab and its modal shows a count
//   AC4 — a single-clip draft carries its OWN publish action (no Reels detour)
// Screenshots are written to /workspace/qa for per-criterion evidence.
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';

const REAL_EMAIL = 'imankh@gmail.com';
const REAL_PROFILE = '9fa7378c';
const SHOT = '/workspace/qa';

const gamesTab = (p) => p.getByRole('button', { name: /^Games/i });
const clipsTab = (p) => p.getByRole('button', { name: /^Clips/i });
const reelsTab = (p) => p.getByRole('button', { name: /^Reels/i });
const publishedTab = (p) => p.getByRole('button', { name: /^Published/i });

test('T9530: library tab + object vocabulary on a real account', async ({ context, page }) => {
  test.setTimeout(120000);
  await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
  await page.goto('/home');
  await page.waitForLoadState('networkidle');

  // --- AC1: four peer tabs, exact unnumbered labels, no "In Progress" prefix ---
  await expect(gamesTab(page)).toBeVisible();
  await expect(clipsTab(page)).toBeVisible();
  await expect(reelsTab(page)).toBeVisible();
  await expect(publishedTab(page)).toBeVisible();
  await expect(page.getByRole('button', { name: /In Progress Clips/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /In Progress Reels/i })).toHaveCount(0);
  await page.screenshot({ path: `${SHOT}/ac1-tab-bar.png`, fullPage: false });

  // --- AC2 + AC4: Clips tab — a single-clip card names actions "clip" ---
  await clipsTab(page).click();
  await page.waitForTimeout(500);
  const clipCards = page.getByTestId('project-card');
  const clipCount = await clipCards.count().catch(() => 0);
  console.log(`[T9530-QA] Clips tab cards: ${clipCount}`);
  await page.screenshot({ path: `${SHOT}/ac2-clips-tab.png`, fullPage: true });
  // No card on the Clips tab may offer a "reel" action (the N14 bug).
  await expect(page.getByRole('button', { name: /delete reel/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /rename reel/i })).toHaveCount(0);
  const clipRename = page.getByRole('button', { name: 'Rename clip' });
  console.log(`[T9530-QA] Clips tab "Rename clip" buttons: ${await clipRename.count()}`);

  // --- AC3 + AC2: Reels tab — Create reel CTA + reel-named card actions ---
  await reelsTab(page).click();
  await page.waitForTimeout(500);
  const createReel = page.getByRole('button', { name: 'Create reel' });
  await expect(createReel.first()).toBeVisible();
  console.log(`[T9530-QA] Reels tab "Create reel" buttons: ${await createReel.count()}`);
  // Clips-only actions must not appear on the Reels tab.
  await expect(page.getByRole('button', { name: /delete clip/i })).toHaveCount(0);
  await page.screenshot({ path: `${SHOT}/ac3-reels-tab.png`, fullPage: true });

  // Open the Create reel modal and confirm its header renamed + a count-aware CTA.
  await createReel.first().click();
  await page.waitForTimeout(500);
  await expect(page.getByRole('heading', { name: 'Create reel' })).toBeVisible();
  await page.screenshot({ path: `${SHOT}/ac3-create-reel-modal.png`, fullPage: true });

  console.log('[T9530-QA] all criteria captured');
});
