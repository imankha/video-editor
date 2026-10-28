import { test, expect } from '@playwright/test';
import {
  confirmDelete, createSecondProfile, deviceOf, expectClean, finishedBadge, gotoHome, idsOf,
  loginSyncUser, openTab, seedHighlight, switchProfile, syncStep, tileAction, traceMark, uniqueUser,
} from '../helpers/syncCheck.js';

test.beforeEach(() => test.setTimeout(240000)); // each step waits on network idle (~15s)

// S4: a published highlight deleted from the Finished tile menu.
const KNOWN_S4 = {};

test('S4 publish -> delete: badge, tile, group and game counts agree', async ({ page, context }, testInfo) => {
  const device = deviceOf(testInfo);
  await loginSyncUser(page, context, uniqueUser('s4'));
  const ids = idsOf(await seedHighlight(page, { name: 'S4 HL' }));
  const clean = (r, label) => expectClean(expect, r, label, KNOWN_S4, testInfo);
  const step = (step, extra = {}) => syncStep(page, { scenario: 'S4', device, step, ids, ...extra });

  await gotoHome(page);
  await openTab(page, 'published');
  expect(await finishedBadge(page)).toBe(1);
  clean(await step('1-published'), 'published baseline');

  const seq0 = await traceMark(page);
  await tileAction(page, 'Delete');
  await confirmDelete(page);
  await expect(page.getByTestId('reel-card')).toHaveCount(0);
  const r = await step('2-after-delete', { seq0, expectHolders: ['galleryStore.count', 'gamesDataStore.games'] });
  clean(r, 'after delete');
  expect.soft(r.probe.counts.downloads_count, 'server count after delete').toBe(0);

  await openTab(page, 'clips');
  clean(await step('3-clips-tab'), 'clips tab, no reload');
  await openTab(page, 'games');
  clean(await step('4-games-tab'), 'games tab, no reload');
  await gotoHome(page);
  clean(await step('5-after-reload'), 'after reload');
  expect.soft(await finishedBadge(page), 'Finished badge after reload').toBe(0);
});

// T13860: delete applies a local delta to the Finished badge (galleryStore.count) without a reload.
test('T13860 S4 delete refreshes galleryStore.count', async ({ page, context }, testInfo) => {
  await loginSyncUser(page, context, uniqueUser('s4f'));
  const ids = idsOf(await seedHighlight(page, { name: 'S4 HL' }));
  await gotoHome(page);
  await openTab(page, 'published');
  const seq0 = await traceMark(page);
  await tileAction(page, 'Delete');
  await confirmDelete(page);
  await expect(page.getByTestId('reel-card')).toHaveCount(0);
  const r = await syncStep(page, { scenario: 'S4-T13860', device: deviceOf(testInfo), step: 'after-delete', ids, seq0, expectHolders: ['galleryStore.count'] });
  expect(r.missingHolders).toEqual([]);
  expect(r.check.mismatches.filter((m) => m.holder === 'galleryStore.count')).toEqual([]);
  expect(await finishedBadge(page)).toBe(0);
});

// S5: move to a second profile, then read both sides.
const KNOWN_S5 = {};

test('S5 publish -> move to second profile: source down, target up', async ({ page, context }, testInfo) => {
  const device = deviceOf(testInfo);
  await loginSyncUser(page, context, uniqueUser('s5'));
  const targetName = `S5 target ${Date.now().toString(36)}`;
  const { a, b } = await createSecondProfile(page, targetName);
  const seeded = await seedHighlight(page, { name: 'S5 HL' });
  const ids = idsOf(seeded);
  const clean = (r, label) => expectClean(expect, r, label, KNOWN_S5, testInfo);
  const step = (step, extra = {}) => syncStep(page, { scenario: 'S5', device, step, ids, ...extra });

  await gotoHome(page);
  await openTab(page, 'published');
  expect(await finishedBadge(page)).toBe(1);
  clean(await step('1-published'), 'published baseline');

  const seq0 = await traceMark(page);
  await tileAction(page, 'Move to profile…');
  // the shared e2e account accumulates profiles, pushing this one below the modal's fold
  await page.getByRole('button', { name: new RegExp(targetName) }).first().evaluate((el) => el.click());
  await page.getByRole('button', { name: /^Move highlight/ }).click();
  await expect(page.getByTestId('reel-card')).toHaveCount(0, { timeout: 30000 });
  const r = await step('2-after-move-source', { seq0, expectHolders: ['galleryStore.count'] });
  clean(r, 'source after move');
  expect.soft(r.probe.counts.downloads_count, 'source server count').toBe(0);
  expect.soft(await finishedBadge(page), 'source badge after move').toBe(0);

  await switchProfile(page, b);
  await openTab(page, 'published');
  const target = await syncStep(page, { scenario: 'S5', device, step: '2b-target-profile', ids: {} });
  expect.soft(target.probe.counts.downloads_count, 'target server count after move').toBe(1);
  expect.soft(await finishedBadge(page), 'target badge after move').toBe(1);
  await expect(page.getByTestId('reel-card')).toHaveCount(1);

  await switchProfile(page, a);
  await gotoHome(page);
  clean(await step('3-source-after-reload'), 'source after reload');
  expect.soft(await finishedBadge(page), 'source badge after reload').toBe(0);
});
