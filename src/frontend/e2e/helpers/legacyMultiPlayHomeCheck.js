import { expect } from '@playwright/test';
import { loginForCheck, checkApi } from './checkAuth';

const isList = (body) => (Array.isArray(body) ? body : body.projects || []);

/**
 * T17840:C1 steps, shared with T17900:C1: on Home, an old highlight made from several plays
 * says, without any click, that such highlights are no longer supported for editing, and its
 * card shows neither the rename pencil nor an "In progress" badge.
 *
 * The account's own multi-play highlight is used when it has one (staging's owner account
 * does). Accounts made after the old editor was retired hold none, so otherwise the check
 * relabels one of the account's real projects as a multi-play highlight in the /api/bootstrap
 * and /api/projects responses the page reads: only the list data is changed, the screen under test is real.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ beforeOpen?: (projects: object[]) => Promise<void> }} [options] - runs after login,
 *   before the resume point is cleared and '/' opens
 */
export async function expectLegacyMultiPlayOnHome(page, { beforeOpen } = {}) {
  await loginForCheck(page);
  const res = await page.request.get(checkApi('/projects'));
  expect(res.ok(), `/projects -> ${res.status()}`).toBeTruthy();
  const projects = isList(await res.json());
  if (beforeOpen) await beforeOpen(projects);
  let legacy = projects.find((p) => !p.is_auto_created && p.clip_count > 1 && !p.has_final_video);
  if (!legacy) {
    expect(projects.length, 'a project on the account').toBeGreaterThan(0);
    legacy = projects[0];
    const relabel = (list) => {
      for (const p of list || []) {
        if (p.id === legacy.id) Object.assign(p, {
          is_auto_created: false, clip_count: 3, has_final_video: false, is_published: false, final_video_id: null,
        });
      }
    };
    // Home's first load reads the list from /api/bootstrap; later refreshes from /api/projects.
    await page.route((url) => /\/api\/(bootstrap|projects)$/.test(url.pathname), async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      relabel(Array.isArray(body) ? body : body.projects);
      await route.fulfill({ response, json: body });
    });
  }

  // T17900: '/' reopens the account's last editor (T14980 resume point); on the shared staging
  // account an earlier check left it in Frame, which took the page off Home after the tab click.
  const cleared = await page.request.delete(checkApi('/me/resume-point'));
  expect(cleared.ok(), `DELETE /me/resume-point -> ${cleared.status()}`).toBeTruthy();

  await page.goto('/');
  await page.getByTestId('home-tab-clips').first().click();
  const group = page.getByTestId('legacy-reel-drafts');
  await expect(group).toBeVisible({ timeout: 60000 });
  await expect(group).toContainText('Highlights made from several plays are no longer supported for editing.');

  const card = group.locator(`[data-testid="project-card"][data-project-id="${legacy.id}"]`);
  await expect(card).toBeVisible({ timeout: 60000 });
  await expect(card).toContainText('Not supported');
  await expect(card).not.toContainText('In progress');
  await expect(card.getByRole('button', { name: 'Rename highlight' })).toHaveCount(0);
  // A list refresh may still be in flight through the relabel route when the test ends.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
}
