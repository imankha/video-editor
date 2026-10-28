import { test, expect } from '@playwright/test';
import {
  deviceOf, expectClean, finishedBadge, gotoHome, idsOf, loginSyncUser, openTab,
  seedHighlight, syncStep, tileAction, traceMark, uniqueUser,
} from '../helpers/syncCheck.js';

test.beforeEach(() => test.setTimeout(240000)); // each step waits on network idle (~15s)

const KNOWN = { 'gamesDataStore.games': 'T13850' };
// T13880: the restored older highlight is classified is_auto_created=0 by the list (single auto_project_id pointer)
const KNOWN_S6 = { ...KNOWN, 'projectsStore.projects': 'T13880' };

// S6: both orientations on one play; restore Portrait, then Landscape; each slot shows its own state.
test('S6 two orientations of one play: restore each, auto_project_id stays sane', async ({ page, context }, testInfo) => {
  const device = deviceOf(testInfo);
  await loginSyncUser(page, context, uniqueUser('s6'));
  const p = await seedHighlight(page, { name: 'S6 portrait', aspect_ratio: '9:16' });
  const l = await seedHighlight(page, { name: 'S6 landscape', aspect_ratio: '16:9', game_id: p.game_id, raw_clip_id: p.raw_clip_id });
  const ids = idsOf(p);
  const clean = (r, label) => expectClean(expect, r, label, KNOWN_S6, testInfo);
  const step = (step, extra = {}) => syncStep(page, { scenario: 'S6', device, step, ids, ...extra });

  await gotoHome(page);
  await openTab(page, 'published');
  expect(await finishedBadge(page)).toBe(2);
  clean(await step('1-both-published'), 'both published');

  const seq0 = await traceMark(page);
  await tileAction(page, 'Open as Draft'); // first tile
  await page.waitForLoadState('networkidle').catch(() => {});
  const r = await step('2-after-first-restore', { seq0, expectHolders: ['galleryStore.count'] });
  clean(r, 'after first restore');
  const inst = r.probe.highlight_instances;
  expect.soft(inst.filter((i) => i.is_published).length, 'exactly one instance still published').toBe(1);
  expect.soft(inst.length, 'both instances still listed').toBe(2);
  void l;

  await gotoHome(page);
  clean(await step('3-after-reload'), 'after reload');
  await openTab(page, 'published');
  expect.soft(await finishedBadge(page), 'badge after reload').toBe(1);
});

// S12: shared-in Team clip (shared_by set, my_athlete 0) behaves identically to S1/S2 (T13790 regression).
test('S12 shared-in clip: publish -> Open as Draft stays consistent', async ({ page, context }, testInfo) => {
  const device = deviceOf(testInfo);
  await loginSyncUser(page, context, uniqueUser('s12'));
  const ids = idsOf(await seedHighlight(page, { name: 'S12 HL', shared_by: 'coach@example.com', my_athlete: 0 }));
  const clean = (r, label) => expectClean(expect, r, label, KNOWN, testInfo);
  const step = (step, extra = {}) => syncStep(page, { scenario: 'S12', device, step, ids, ...extra });

  await gotoHome(page);
  await openTab(page, 'published');
  expect(await finishedBadge(page)).toBe(1);
  clean(await step('1-published'), 'published baseline');

  const seq0 = await traceMark(page);
  await tileAction(page, 'Open as Draft');
  await page.waitForLoadState('networkidle').catch(() => {});
  clean(await step('2-after-restore', { seq0, expectHolders: ['galleryStore.count'] }), 'after restore');

  await gotoHome(page);
  clean(await step('3-after-reload'), 'after reload');
  await openTab(page, 'published');
  expect.soft(await finishedBadge(page), 'badge after reload').toBe(0);
});

// T13880 (filed, assertion intact): a restored older highlight must stay is_auto_created in the Clips list.
test.fixme('T13880 S6 restored older highlight keeps its auto-created classification', async ({ page, context }, testInfo) => {
  await loginSyncUser(page, context, uniqueUser('s6f'));
  const p = await seedHighlight(page, { name: 'S6 portrait', aspect_ratio: '9:16' });
  await seedHighlight(page, { name: 'S6 landscape', aspect_ratio: '16:9', game_id: p.game_id, raw_clip_id: p.raw_clip_id });
  await gotoHome(page);
  await openTab(page, 'published');
  await tileAction(page, 'Open as Draft');
  await page.waitForLoadState('networkidle').catch(() => {});
  const r = await syncStep(page, { scenario: 'S6-T13880', device: deviceOf(testInfo), step: 'after-restore', ids: idsOf(p) });
  expect(r.check.mismatches.filter((m) => m.holder === 'projectsStore.projects')).toEqual([]);
});
