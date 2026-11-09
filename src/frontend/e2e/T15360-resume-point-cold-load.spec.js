import { test, expect } from '@playwright/test';
import { loginAsDevPreset } from './helpers/realAuth';

/**
 * T15360:C4 - the cold-load restore must be covered by a test that drives a REAL
 * browser navigation to '/' (full document load, so editorStore's module-load
 * canonicalization actually runs before App's restore gate reads coldLoadPathname),
 * not a direct call to restoreFromResumePoint/canonicalPath. Unit tests
 * (resumePointRestore.test.js etc.) call those functions in isolation and can't
 * observe the ordering bug T15360 fixed (coldLoadPathname captured pre-rewrite).
 *
 * Resume points are set via page.request (the shared-cookie API context, same as
 * loginAsDevPreset) rather than visiting the app first -- visiting any route is
 * itself a navigation gesture that writes its OWN resume point (writeResumePoint),
 * which would overwrite the point this test is trying to set up before the real
 * cold-load navigation it is testing.
 *
 * Run: bash scripts/dev-verify.sh e2e/T15360-resume-point-cold-load.spec.js --reporter=line
 */

async function setResumePoint(page, point) {
  const res = await page.request.post('/api/me/resume-point', { data: point });
  expect(res.status()).toBe(204);
}

async function firstProjectId(page) {
  const res = await page.request.get('/api/projects');
  const projects = await res.json();
  return projects[0].id;
}

test.describe('T15360 resume point cold load', () => {
  test('a bare cold load of / restores a Focus resume point, not /home', async ({ page }) => {
    await loginAsDevPreset(page, 'full');
    const projectId = await firstProjectId(page);
    await setResumePoint(page, {
      path: `/focus/p/${projectId}`,
      screen: 'framing',
      t: 3,
      left_at: new Date().toISOString(),
    });

    // A real document navigation to the bare root -- this is the exact arrival
    // editorStore's module-load canonicalization rewrites (coldLoadPathname) before
    // App.jsx's restore gate ever runs, which is the ordering this test covers.
    await page.goto('/');

    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30000 }).toBe(`/focus/p/${projectId}`);
    await expect.poll(
      () => page.evaluate(async () => {
        const { useProjectsStore } = await import('/src/stores/projectsStore.js');
        return useProjectsStore.getState().selectedProjectId;
      }),
      { timeout: 30000 },
    ).toBe(projectId);
  });

  test('a bare cold load of / restores an Overlay resume point', async ({ page }) => {
    await loginAsDevPreset(page, 'full');
    const projectId = await firstProjectId(page);
    await setResumePoint(page, {
      path: `/overlay/p/${projectId}`,
      screen: 'overlay',
      t: 2,
      left_at: new Date().toISOString(),
    });

    await page.goto('/');

    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30000 }).toBe(`/overlay/p/${projectId}`);
  });

  test('a cold load of / with no resume point lands on Home as before', async ({ page }) => {
    await loginAsDevPreset(page, 'full');
    await page.request.delete('/api/me/resume-point');

    await page.goto('/');

    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30000 }).toMatch(/^\/home/);
  });
});
