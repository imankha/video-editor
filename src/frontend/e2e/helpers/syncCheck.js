/**
 * T13820 sync QA helpers: login as an isolated e2e account, seed linked highlights
 * through the test seam, and run the per-step contract
 *   wait (trace-based, no sleeps) -> UI assertions -> __syncCheck -> server probe
 * saving evidence under qa/sync/<scenario>/<device>/<step>/.
 */
import fs from 'fs';
import path from 'path';
import { QA_DIR } from './qa.js';

export const SYNC_DIR = path.join(QA_DIR, 'sync');

/** Isolated account per spec (never the user's own). Returns the profile id used for server probes. */
export async function loginSyncUser(page, context, userId) {
  await page.setExtraHTTPHeaders({ 'X-User-ID': userId, 'X-Test-Mode': 'true' });
  await page.goto('/');
  await page.evaluate(async () => {
    await fetch('/api/auth/test-login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Test-Mode': 'true' },
    });
  });
  await page.evaluate(async (email) => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email, showAuthModal: false });
  }, `${userId}@e2e.local`);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  // test-login always resolves to ONE shared e2e account, so isolate each spec in its
  // own fresh profile (empty games/projects/downloads) instead.
  await page.waitForFunction(async () => {
    const { useProfileStore } = await import('/src/stores/profileStore.js');
    return useProfileStore.getState().isInitialized;
  });
  await page.evaluate(async (name) => {
    const { useProfileStore } = await import('/src/stores/profileStore.js');
    await useProfileStore.getState().createProfile(name, '#3B82F6');
  }, userId);
  await setGuidanceOff(page);
}

/** Guidance defaults on for a new account; its shade blocks every click. */
export async function setGuidanceOff(page) {
  const toggle = page.getByTestId('guidance-toggle').first();
  await toggle.waitFor({ timeout: 30000 });
  if ((await toggle.getAttribute('aria-checked')) !== 'false') await toggle.click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="guidance-toggle"]')?.getAttribute('aria-checked') === 'false',
  );
}

/** Profile id the page's API calls use (read from the live session, not guessed). */
export async function currentProfileId(page) {
  return page.evaluate(async () => {
    const { useProfileStore } = await import('/src/stores/profileStore.js');
    return useProfileStore.getState().currentProfileId;
  });
}

async function api(page, method, url, body) {
  return page.evaluate(async ({ method, url, body }) => {
    const { default: apiFetch } = await import('/src/utils/apiFetch.js');
    const res = await apiFetch(url, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { method, url, body });
}

/** POST /api/test/seed-published-highlight; throws on a non-200 so a broken seam is loud. */
export async function seedHighlight(page, opts = {}) {
  const r = await api(page, 'POST', '/api/test/seed-published-highlight', opts);
  if (r.status !== 200) throw new Error(`seed-published-highlight -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

export const setSyncFault = (page, enabled) => api(page, 'POST', '/api/test/sync-fault', { enabled });

/** Server truth: the T13810 probe. */
export async function probe(page, ids) {
  const q = new URLSearchParams();
  if (ids.projectId != null) q.set('project_id', ids.projectId);
  if (ids.rawClipId != null) q.set('raw_clip_id', ids.rawClipId);
  if (ids.gameId != null) q.set('game_id', ids.gameId);
  return (await api(page, 'GET', `/api/qa/sync-state?${q}`)).body;
}

const slug = (s) => String(s).replace(/[^a-z0-9._-]/gi, '_');

/**
 * One step. `seq0` = trace length before the gesture (from traceMark). `expectHolders`
 * are holders that must show a fetch/write entry after seq0 -- a missing one is itself the
 * finding ("holder never refreshed by this gesture"), reported with the holder named.
 * Returns {check, probe, missingHolders}; never throws on a mismatch -- the caller asserts
 * so every step's evidence is saved first.
 */
export async function syncStep(page, { scenario, device, step, ids, seq0 = 0, expectHolders = [] }) {
  await page.waitForLoadState('networkidle').catch(() => {});
  const missingHolders = [];
  for (const holder of expectHolders) {
    const ok = await page.waitForFunction(
      ({ holder, seq0 }) => (window.__syncTrace?.entries() || []).some((e) => e.holder === holder && e.seq > seq0),
      { holder, seq0 }, { timeout: 10000 },
    ).then(() => true).catch(() => false);
    if (!ok) missingHolders.push(holder);
  }
  const check = await page.evaluate((ids) => window.__syncCheck(ids), ids);
  const trace = await page.evaluate(() => window.__syncTrace.entries());
  const server = await probe(page, ids);
  const dir = path.join(SYNC_DIR, slug(scenario), slug(device), slug(step));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'check.json'), JSON.stringify(check, null, 2));
  fs.writeFileSync(path.join(dir, 'trace.json'), JSON.stringify(trace, null, 2));
  fs.writeFileSync(path.join(dir, 'probe.json'), JSON.stringify(server, null, 2));
  fs.writeFileSync(path.join(dir, 'missing-holders.json'), JSON.stringify(missingHolders));
  await page.screenshot({ path: path.join(dir, 'screen.png'), fullPage: true });
  return { check, probe: server, missingHolders, trace };
}

/** Current trace length, to scope the next step's expectHolders to entries after the gesture. */
export const traceMark = (page) => page.evaluate(() => {
  const e = window.__syncTrace.entries();
  return e.length ? e[e.length - 1].seq : 0;
});

/** Navigate home (a full load) and drop the guidance shade, which re-arms on every load. */
export async function gotoHome(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle').catch(() => {});
  await setGuidanceOff(page);
}

export const deviceOf = (testInfo) => testInfo.project.name.replace(/-sync$/, '');
export const uniqueUser = (tag) => `e2e-t13820-${tag}-${Date.now().toString(36)}`;
export const idsOf = (s) => ({ projectId: s.project_id, rawClipId: s.raw_clip_id, gameId: s.game_id });

/** Finished-tab badge number as the user reads it (the tab button's text). */
export async function finishedBadge(page) {
  const txt = await page.getByTestId('home-tab-published').innerText();
  const m = txt.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

/** In-app navigation (no reload): leave the editor via its home button if we are in one, then open a home tab. */
export async function openTab(page, name) {
  const home = page.getByTestId('editor-home').first();
  if (await home.isVisible().catch(() => false)) await home.click();
  await page.getByTestId(`home-tab-${name}`).click();
  await page.waitForLoadState('networkidle').catch(() => {});
}

export async function tileAction(page, label) {
  await page.getByTestId('reel-card').first().hover();
  await page.getByRole('button', { name: 'More actions' }).first().click();
  await page.getByTestId('reel-tile-menu').getByText(label, { exact: true }).click();
}

/**
 * Assert a step's __syncCheck is clean and no expected holder went unrefreshed (soft: evidence
 * is saved first). `known` maps holder -> filed T-id: that holder's mismatch / missed refresh
 * is already a FILED finding (its own `test.fixme('<T-id>')` carries the assertion), so it is
 * reported as an annotation here instead of failing the rest of the scenario.
 */
export function expectClean(expect, r, label, known = {}, testInfo = null) {
  const open = (h) => !(h in known);
  for (const h of [...r.missingHolders, ...r.check.mismatches.map((m) => m.holder)]) {
    if (!open(h)) testInfo?.annotations.push({ type: `known:${known[h]}`, description: `${label}: ${h}` });
  }
  expect.soft(r.missingHolders.filter(open), `${label}: holders never refreshed by this gesture`).toEqual([]);
  expect.soft(r.check.mismatches.filter((m) => open(m.holder)), `${label}: __syncCheck mismatches`).toEqual([]);
}

/** Create a second profile and come back; returns {a, b} profile ids (a = the original, current). */
export async function createSecondProfile(page, name) {
  return page.evaluate(async (name) => {
    const { useProfileStore } = await import('/src/stores/profileStore.js');
    const a = useProfileStore.getState().currentProfileId;
    const created = await useProfileStore.getState().createProfile(name, '#10B981');
    await useProfileStore.getState().switchProfile(a);
    return { a, b: created.id };
  }, name);
}

export async function switchProfile(page, id) {
  await page.evaluate(async (id) => {
    const { useProfileStore } = await import('/src/stores/profileStore.js');
    await useProfileStore.getState().switchProfile(id);
  }, id);
  await page.waitForLoadState('networkidle').catch(() => {});
}

/** Confirm the "Delete?" dialog the tile menu opens. */
export const confirmDelete = (page) => page.getByRole('button', { name: 'Delete', exact: true }).last().click();
