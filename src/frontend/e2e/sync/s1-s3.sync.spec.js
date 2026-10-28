import { test, expect } from '@playwright/test';
import {
  deviceOf, expectClean, finishedBadge, gotoHome, idsOf, loginSyncUser, openTab,
  seedHighlight, syncStep, tileAction, traceMark, uniqueUser,
} from '../helpers/syncCheck.js';

test.beforeEach(() => test.setTimeout(240000)); // each step waits on network idle (~15s)

// S2 (from the seam): a published highlight, then "Open as Draft" from the Finished tile menu.
test('S2 publish -> Open as Draft: every listening surface agrees', async ({ page, context }, testInfo) => {
  const device = deviceOf(testInfo);
  await loginSyncUser(page, context, uniqueUser('s2'));
  const seeded = await seedHighlight(page, { name: 'S2 HL' });
  const ids = idsOf(seeded);
  const KNOWN = {};
  const clean = (r, label) => expectClean(expect, r, label, KNOWN, testInfo);
  const step = (step, extra = {}) => syncStep(page, { scenario: 'S2', device, step, ids, ...extra });

  await gotoHome(page);
  await openTab(page, 'published');
  expect(await finishedBadge(page)).toBe(1);
  clean(await step('1-published'), 'published baseline');

  const seq0 = await traceMark(page);
  await tileAction(page, 'Open as Draft');
  await page.waitForLoadState('networkidle').catch(() => {});
  const restored = await step('2-after-restore', { seq0, expectHolders: ['galleryStore.count', 'projectsStore.projects', 'gamesDataStore.games'] });
  clean(restored, 'after restore');
  expect.soft(restored.probe.final_videos[0].published_at, 'server unpublished').toBeNull();

  // Same session, other listening screens, no reload.
  await openTab(page, 'published');
  expect.soft(await finishedBadge(page), 'Finished badge after restore').toBe(0);
  clean(await step('3-finished-tab'), 'finished tab, no reload');
  await openTab(page, 'clips');
  clean(await step('4-clips-tab'), 'clips tab, no reload');
  await openTab(page, 'games');
  clean(await step('5-games-tab'), 'games tab, no reload');

  await gotoHome(page);
  clean(await step('6-after-reload'), 'after reload');
  expect.soft(await finishedBadge(page), 'Finished badge after reload').toBe(0);
});

// T13850: restore must refresh the game card's reel_count.
test('T13850 S2 Open as Draft refreshes gamesDataStore reel_count without a reload', async ({ page, context }, testInfo) => {
  await loginSyncUser(page, context, uniqueUser('s2f'));
  const seeded = await seedHighlight(page, { name: 'S2 HL' });
  const ids = idsOf(seeded);
  await gotoHome(page);
  await openTab(page, 'published');
  const seq0 = await traceMark(page);
  await tileAction(page, 'Open as Draft');
  const r = await syncStep(page, { scenario: 'S2-T13850', device: deviceOf(testInfo), step: 'after-restore', ids, seq0, expectHolders: ['gamesDataStore.games'] });
  expect(r.missingHolders).toEqual([]);
  expect(r.check.mismatches.filter((m) => m.holder === 'gamesDataStore.games')).toEqual([]);
});
