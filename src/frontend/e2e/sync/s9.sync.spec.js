import { test, expect } from '@playwright/test';
import {
  deviceOf, expectClean, finishedBadge, gotoHome, idsOf, loginSyncUser, openTab,
  probe, seedHighlight, setSyncFault, syncStep, tileAction, traceMark, uniqueUser,
} from '../helpers/syncCheck.js';

test.beforeEach(() => test.setTimeout(240000)); // each step waits on network idle (~15s)

// S9: Open as Draft while the restore FAILS. The UI must stay consistent with the DB and a failed
// restore must not half-change the DB (published_at nulled before the archive restore at downloads.py:2654).
const publishedAt = async (page, ids) => (await probe(page, ids)).final_videos[0]?.published_at ?? null;

// T13870 (filed): a failed restore half-changes the DB (published_at nulled first) and the client never refreshes.
test.fixme('T13870 S9a restore under 503 (sync-fault): UI and DB unchanged', async ({ page, context }, testInfo) => {
  const device = deviceOf(testInfo);
  await loginSyncUser(page, context, uniqueUser('s9a'));
  const ids = idsOf(await seedHighlight(page, { name: 'S9a HL' }));
  await gotoHome(page);
  await openTab(page, 'published');
  expect(await finishedBadge(page)).toBe(1);

  await setSyncFault(page, true);
  try {
    const seq0 = await traceMark(page);
    await tileAction(page, 'Open as Draft');
    await page.waitForLoadState('networkidle').catch(() => {});
    const r = await syncStep(page, { scenario: 'S9a', device, step: '1-after-failed-restore', ids, seq0 });
    expectClean(expect, r, 'after 503 restore', {}, testInfo);
    expect.soft(r.probe.final_videos[0].published_at, 'DB: published_at after failed restore').not.toBeNull();
  } finally {
    await setSyncFault(page, false);
  }
  await gotoHome(page);
  await openTab(page, 'published');
  expect.soft(await finishedBadge(page), 'badge after failed restore + reload').toBe(1);
});

// T13870 (filed): a 404 archive-missing restore leaves published_at nulled in the DB.
test.fixme('T13870 S9b restore with the archive missing must not half-change the DB', async ({ page, context }, testInfo) => {
  await loginSyncUser(page, context, uniqueUser('s9b'));
  const ids = idsOf(await seedHighlight(page, { name: 'S9b HL', archive_missing: true }));
  await gotoHome(page);
  await openTab(page, 'published');
  await tileAction(page, 'Open as Draft');
  await page.waitForLoadState('networkidle').catch(() => {});
  const r = await syncStep(page, { scenario: 'S9b-T13870', device: deviceOf(testInfo), step: '1-after-404-restore', ids });
  expect(await publishedAt(page, ids), 'DB: published_at after 404 restore').not.toBeNull();
  expectClean(expect, r, 'after 404 restore');
});
