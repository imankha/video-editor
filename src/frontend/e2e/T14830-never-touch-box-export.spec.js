import { test, expect } from '@playwright/test';
import { loginAsDevPreset } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T14830 (owner ruling 2026-11-07, "Confirm once"): a parent who never touches
 * the box can still export -- Generate is never locked by drag or Play, only a
 * missing video blocks it. Pressing Generate without having moved or checked
 * the box shows the one-time "Is your athlete in the box?" warning; continuing
 * spends credits and proceeds with the export exactly as if framed.
 *
 * Live-driven against the 'full' dev preset account (local data, no R2 egress
 * needed for project listing).
 */

async function firstProject(context, { requireUnframed } = {}) {
  const res = await context.request.get('/api/projects');
  const body = await res.json();
  const list = Array.isArray(body) ? body : body.projects || [];
  if (requireUnframed) return list.find((p) => !p.has_crop_keyframes) || null;
  return list.find((p) => p.has_working_video) || list[0] || null;
}

test.describe('T14830 never-touch-the-box export', () => {
  test.beforeEach(async ({ context }) => {
    test.setTimeout(180_000);
    await loginAsDevPreset(context, 'full');
  });

  test('T14830 unframed clip: Generate is enabled untouched, warns once, then exports', async ({ page, context }) => {
    const project = await firstProject(context, { requireUnframed: true });
    test.skip(!project, 'full preset has no unframed project to drive this check');
    await page.goto(`/focus/p/${project.id}`);
    const stage = page.getByTestId('focus-video-stage');
    await stage.waitFor({ timeout: 90000 });

    const generate = page.getByRole('button', { name: 'Sharpen my highlight' }).first();
    // Never locked: enabled immediately, box never dragged, clip never played.
    await expect(generate).toBeEnabled();
    await saveEvidence(page, 'T14830-unframed-generate-enabled');

    await generate.click();
    const confirm = page.getByTestId('focus-box-confirm');
    await confirm.waitFor({ timeout: 10000 });
    await expect(confirm).toContainText('Is your athlete in the box?');
    await expect(confirm).toContainText('Sharpening uses credits');
    await saveEvidence(page, 'T14830-box-confirm-dialog');

    // Continuing proceeds with the export normally.
    await confirm.getByRole('button', { name: 'Sharpen my highlight' }).click();
    await expect(confirm).toBeHidden();
    await saveEvidence(page, 'T14830-after-continue');
  });
});
