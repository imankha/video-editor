import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T17060 - on desktop the round "Report a problem" button never covers the "Dismiss" button of
 * the "Your highlight is in Highlights" card, at 1440x900, 1280x800 and 1920x1080.
 *
 * That card shows on Home only after a sharpen finished while the parent was away (an
 * unacknowledged framing export), and hides itself after 8 seconds. A real sharpen is a paid
 * render, so the check answers the app's own exports lists with one finished framing job for a
 * real project of the account, and answers the acknowledge call itself (the job is not real).
 * Guidance is off so the card sits in its own corner, not moved clear of a coach card.
 */
test.setTimeout(180000);

const FAKE_JOB = 't17060-check-job';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

async function showFinishedCard(page) {
  await page.goto('/home');
  await disableGuidanceForCheck(page);
  const projects = await page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    return res.ok ? res.json() : null;
  }, checkApi('/projects'));
  const list = Array.isArray(projects) ? projects : projects?.projects || [];
  expect(list.length, 'the account has a project to name in the card').toBeGreaterThan(0);
  const job = {
    job_id: FAKE_JOB, project_id: list[0].id, project_name: list[0].name,
    type: 'framing', status: 'complete', finished: true,
  };

  await page.route((url) => /\/api\/(bootstrap|exports\/unacknowledged)$/.test(url.pathname), async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    const holder = new URL(route.request().url()).pathname.endsWith('/bootstrap') ? body.exports : body;
    if (holder) holder[holder === body ? 'exports' : 'unacknowledged'] = [job];
    return route.fulfill({ response: res, json: body });
  });
  await page.route((url) => url.pathname.endsWith('/api/exports/acknowledge'), (route) => route.fulfill({ json: { ok: true } }));

  await page.goto('/home');
  const card = page.getByTestId('focus-completion-recovery');
  await expect(card).toContainText('Your highlight is in Highlights', { timeout: 60000 });
  return card;
}

async function expectDismissClear(page) {
  await loginForCheck(page);
  const card = await showFinishedCard(page);
  await expect(page.getByRole('button', { name: 'Report a problem' })).toBeVisible();
  const dismiss = card.getByRole('button', { name: 'Dismiss' });

  // Every point of Dismiss (corners and middle) answers a click as Dismiss, not Report a problem.
  // Corners are sampled 4px in: Dismiss is rounded (6px), and its very corner belongs to the card.
  const hits = await dismiss.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const pts = [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4],
      [r.right - 4, r.bottom - 4], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]];
    return pts.map(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return { x, y, dismiss: !!hit && el.contains(hit), hit: hit?.getAttribute('aria-label') || `${hit?.tagName}.${hit?.getAttribute('data-testid') || ''}.${String(hit?.className).slice(0, 120)}` };
    });
  });
  const covered = hits.filter((h) => !h.dismiss);
  expect(covered, `points of Dismiss answered by something else: ${JSON.stringify(covered)}`).toEqual([]);

  const report = await page.getByRole('button', { name: 'Report a problem' }).boundingBox();
  const box = await dismiss.boundingBox();
  const overlap = report.x < box.x + box.width && box.x < report.x + report.width
    && report.y < box.y + box.height && box.y < report.y + report.height;
  expect(overlap, `Report a problem ${JSON.stringify(report)} overlaps Dismiss ${JSON.stringify(box)}`).toBe(false);

  await dismiss.click();
  await expect(card).toHaveCount(0);
}

test.describe('1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('T17060:C1 at 1440x900 Dismiss is fully clickable and not covered by Report a problem', async ({ page }) => {
    await expectDismissClear(page);
  });
});

test.describe('1280', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test('T17060:C2 at 1280x800 Dismiss is fully clickable and not covered by Report a problem', async ({ page }) => {
    await expectDismissClear(page);
  });
});

test.describe('1920', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  test('T17060:C2 at 1920x1080 Dismiss is fully clickable and not covered by Report a problem', async ({ page }) => {
    await expectDismissClear(page);
  });
});
