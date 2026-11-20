/**
 * T17870 - per-criterion acceptance checks (group checks protocol).
 *
 * Frame's desktop Settings panel used to hide "Fix a tilted camera" and "Dim outside"
 * behind a collapsed "More options" link. Now Fix a tilted camera shows directly, and
 * the dim setting (and the dimming outside the box) is removed: Preview shows the
 * framed result.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17870.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

test.setTimeout(240000);

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const FRONTEND_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const DIM_CODE = /dimOpacity|onToggleDim|DARKEN_OUTSIDE/;

/** Every `file:line` under src/frontend/src naming a removed dim identifier. */
function dimCodeLeftovers(dir = FRONTEND_SRC) {
  const hits = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { hits.push(...dimCodeLeftovers(full)); continue; }
    if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue;
    fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
      if (DIM_CODE.test(line)) hits.push(`${path.relative(FRONTEND_SRC, full)}:${i + 1}`);
    });
  }
  return hits;
}

/** A project Frame can edit: its game video still exists (same lookup as T17230's check). */
async function findFrameableProject(page) {
  const projectsRes = await page.request.get(checkApi('/projects'));
  expect(projectsRes.ok(), `GET /projects -> ${projectsRes.status()}`).toBeTruthy();
  const body = await projectsRes.json();
  const projects = (Array.isArray(body) ? body : body.projects || []).filter((p) => p.clip_count > 0);
  for (const p of projects) {
    const clipsRes = await page.request.get(checkApi(`/clips/projects/${p.id}/clips`));
    if (!clipsRes.ok()) continue;
    const [clip] = await clipsRes.json();
    if (!clip) continue;
    const res = await page.request.get(checkApi(`/clips/projects/${p.id}/clips/${clip.id}/playback-url`));
    if (res.ok()) return p.id;
  }
  return null;
}

/** No playable project: make one from a play on a game whose video is active (the
 *  request the play's "Make highlight" sends). Deleted by the test. */
async function makeFrameableProject(page) {
  const gamesRes = await page.request.get(checkApi('/games'));
  expect(gamesRes.ok(), `GET /games -> ${gamesRes.status()}`).toBeTruthy();
  for (const game of (await gamesRes.json()).games || []) {
    if (game.storage_status !== 'active') continue;
    const gameRes = await page.request.get(checkApi(`/games/${game.id}`));
    if (!gameRes.ok()) continue;
    const play = ((await gameRes.json()).annotations || []).find((a) => a.auto_project_id == null);
    if (!play) continue;
    const res = await page.request.put(checkApi(`/clips/raw/${play.id}`), { data: { create_project: true } });
    expect(res.ok(), `PUT /clips/raw/${play.id} create_project -> ${res.status()}`).toBeTruthy();
    return (await res.json()).project_id;
  }
  return null;
}

/** In-page DELETE: page.request after the app started its own session got 401 on staging (T16100). */
async function deleteProject(page, projectId) {
  const status = await page.evaluate(async (url) => (await fetch(url, { method: 'DELETE', credentials: 'include' })).status,
    checkApi(`/projects/${projectId}`));
  expect([200, 404], `DELETE /projects/${projectId}`).toContain(status);
}

/** Log in, open Frame on a playable highlight and wait for the crop box. Returns the id
 *  of a project made for the test (to delete), or null. */
async function openFrame(context, page) {
  await loginForCheck(context);
  const existing = await findFrameableProject(page);
  const made = existing ? null : await makeFrameableProject(page);
  const projectId = existing ?? made;
  expect(projectId, 'a project whose game video Frame can play').toBeTruthy();
  await page.goto(`/focus/p/${projectId}`);
  await page.getByTestId('crop-rect').waitFor({ timeout: 180000 });
  return made;
}

test('T17870:C3 - no dim code left in src/frontend/src (dimOpacity, onToggleDim, DARKEN_OUTSIDE)', () => {
  expect(fs.existsSync(path.join(FRONTEND_SRC, 'modes', 'focus')), `source tree at ${FRONTEND_SRC}`).toBe(true);
  expect(dimCodeLeftovers()).toEqual([]);
});

test.describe('desktop', () => {
  test.use({ viewport: DESKTOP });

  test('T17870:C1 - Settings shows Fix a tilted camera without a click; no More options control', async ({ context, page }) => {
    const made = await openFrame(context, page);
    try {
      const rail = page.getByTestId('settings-rail');
      await expect(rail.getByText('Fix a tilted camera', { exact: true })).toBeVisible({ timeout: 60000 });
      await expect(rail.getByRole('button', { name: 'Fix a tilted camera' })).toBeVisible();
      await expect(page.getByRole('button', { name: /more options/i })).toHaveCount(0);
      await expect(page.getByText(/more options/i)).toHaveCount(0);
    } finally {
      if (made) await deleteProject(page, made);
    }
  });

  test('T17870:C2 - Fix a tilted camera turns the straighten tool on and off from the panel', async ({ context, page }) => {
    const made = await openFrame(context, page);
    try {
      const toggle = page.getByTestId('settings-rail').getByRole('button', { name: 'Fix a tilted camera' });
      await expect(toggle).toHaveAttribute('aria-pressed', 'false', { timeout: 60000 });
      await expect(page.getByLabel('Rotation angle')).toHaveCount(0);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByLabel('Rotation angle')).toHaveCount(1);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByLabel('Rotation angle')).toHaveCount(0);
    } finally {
      if (made) await deleteProject(page, made);
    }
  });

  test('T17870:C3 - no Dim/Darken setting and no dimming outside the box; Preview still works', async ({ context, page }) => {
    const made = await openFrame(context, page);
    try {
      // No dim layer while framing: neither the mask over the video nor the box's outer shadow.
      const shadow = await page.getByTestId('crop-rect').evaluate((el) => getComputedStyle(el).boxShadow);
      expect(shadow, 'no dim shadow around the crop box').toBe('none');
      await expect(page.locator('mask#cropMask')).toHaveCount(0);
      // No Dim/Darken row in Settings (and no disclosure that could hide one).
      await expect(page.getByTestId('settings-rail')).toBeVisible({ timeout: 60000 });
      await expect(page.getByText(/dim outside|darken outside/i)).toHaveCount(0);
      await expect(page.getByRole('button', { name: /more options/i })).toHaveCount(0);
      // Preview still opens and closes.
      const preview = page.getByRole('button', { name: /^Preview/ }).filter({ visible: true }).first();
      await preview.click({ timeout: 60000 });
      await expect(page.getByTestId('crop-rect')).toHaveCount(0, { timeout: 60000 });
      await page.getByRole('button', { name: /Close preview/ }).filter({ visible: true }).first().click({ timeout: 60000 });
      await expect(page.getByTestId('crop-rect')).toBeVisible({ timeout: 60000 });
    } finally {
      if (made) await deleteProject(page, made);
    }
  });
});

test.describe('phone', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('T17870:C4 - the phone settings drawer still holds Shape and Include audio only', async ({ context, page }) => {
    const made = await openFrame(context, page);
    try {
      await page.getByTestId('mobile-settings-row').click({ timeout: 60000 });
      const drawer = page.getByTestId('settings-drawer');
      await expect(drawer.getByText('Shape', { exact: true })).toBeVisible({ timeout: 60000 });
      await expect(drawer.getByText('Include audio', { exact: true })).toBeVisible();
      await expect(drawer.getByText('Fix a tilted camera')).toHaveCount(0);
      await expect(drawer.getByText(/more options|dim outside|darken/i)).toHaveCount(0);
    } finally {
      if (made) await deleteProject(page, made);
    }
  });
});
