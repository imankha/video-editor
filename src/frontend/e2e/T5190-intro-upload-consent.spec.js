import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

/**
 * T5190 — Card image upload + parental-consent attestation (QA live-drive).
 *
 * Three tests:
 *  1. API round-trip as the real account: upload a real image -> per-profile key
 *     (SHAPE includes the profile id, the 404 landmine) + a preview URL that
 *     actually fetches the stored object; consent recorded, exposed on the
 *     profiles payload, isolated per profile, and gone after revoke/delete.
 *  2. API round-trip for structured facts (position/class/team, epic decision 3
 *     reversal 2026-08-04): persistence, exposure on BOTH GET /api/profiles and
 *     GET /api/bootstrap, independent clearing, isolation between profiles, and
 *     a FRESH-request reload-persistence check -- the exact gap that missed the
 *     photo-key regression before (see TestPhotoPersistence in the pytest file).
 *  3. UI live-drive of the profile surface: open Manage Profiles -> Edit ->
 *     upload a photo (preview renders) -> tick consent -> fill position/class/
 *     team, blur each -> reload -> reopen and confirm ALL of it PERSISTED.
 *     Evidence per acceptance criterion + a 375px + desktop responsive sweep.
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T5190-intro-upload-consent.spec.js
 *
 * Requires the spec's user in this env's Postgres (seed with
 * scripts/copy_user_between_envs.py if dev-login 404s).
 */
const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const API_BASE = process.env.E2E_API_BASE || '/api';

// A tiny but genuinely-decodable 1x1 JPEG (base64). The backend rejects by
// DECODING, so this must be real image bytes, not a renamed text file.
const JPEG_1x1_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
  'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB' +
  'AAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==';
const JPEG_1x1 = Buffer.from(JPEG_1x1_B64, 'base64');

async function currentProfileId(context) {
  const res = await context.request.get(`${API_BASE}/profiles`);
  expect(res.ok(), `GET /api/profiles (${res.status()})`).toBeTruthy();
  const { profiles } = await res.json();
  const current = profiles.find((p) => p.isCurrent) || profiles[0];
  return { pid: current.id, profiles };
}

test('T5190 API: upload -> per-profile key + fetchable preview; consent record/expose/gate/revoke', async ({ context }) => {
  test.setTimeout(120000);
  await loginAsRealUser(context, REAL_EMAIL);

  const { pid } = await currentProfileId(context);

  // --- criterion 1 + 2: valid image uploads to the per-profile intro/ prefix ---
  const up = await context.request.post(`${API_BASE}/profiles/${pid}/intro/image`, {
    multipart: { image: { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: JPEG_1x1 } },
  });
  expect(up.ok(), `upload (${up.status()})`).toBeTruthy();
  const { key, previewUrl } = await up.json();
  // THE 404 landmine assertion: the key must sit under THIS profile's prefix.
  expect(key, 'key includes the profile id (per-profile prefix)').toContain(`/profiles/${pid}/intro/`);
  expect(previewUrl, 'a presigned preview URL is returned').toBeTruthy();

  // The preview URL fetches the stored object -> the R2 object really persisted.
  const preview = await context.request.get(previewUrl);
  expect(preview.ok(), `preview URL fetches the object (${preview.status()})`).toBeTruthy();
  expect((await preview.body()).length, 'preview object has bytes').toBeGreaterThan(0);

  // --- reload-persistence regression: the upload response alone is not proof
  // of persistence -- a FRESH GET (simulating a reload/new session) must carry
  // the key + a freshly presigned URL that also fetches the object. ---
  const reloaded = await currentProfileId(context);
  const meAfterUpload = reloaded.profiles.find((p) => p.id === pid);
  expect(meAfterUpload.introPhotoKey, 'photo key SURVIVES a reload').toBe(key);
  expect(meAfterUpload.introPhotoUrl, 'a freshly presigned URL is exposed on reload').toBeTruthy();
  const reloadedPreview = await context.request.get(meAfterUpload.introPhotoUrl);
  expect(reloadedPreview.ok(), 'the reload-fetched URL fetches the object').toBeTruthy();

  // --- criterion 2: a non-image (text renamed .jpg) is rejected by decoding ---
  const bad = await context.request.post(`${API_BASE}/profiles/${pid}/intro/image`, {
    multipart: { image: { name: 'evil.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not an image') } },
  });
  expect(bad.status(), 'non-image rejected 400').toBe(400);

  // --- criterion 4: consent recorded per profile + exposed on the payload ---
  const consent = await context.request.post(`${API_BASE}/profiles/${pid}/intro/consent`);
  expect(consent.ok(), `record consent (${consent.status()})`).toBeTruthy();
  const ts = (await consent.json()).introConsentAt;
  expect(ts, 'consent returns a timestamp').toBeTruthy();

  const after = await currentProfileId(context);
  const me = after.profiles.find((p) => p.id === pid);
  expect(me.introConsentAt, 'consent exposed on the profiles payload').toBe(ts);
  // Per-profile isolation: any OTHER profile is still ungated.
  for (const other of after.profiles.filter((p) => p.id !== pid)) {
    expect(other.introConsentAt, `profile ${other.id} unaffected`).toBeNull();
  }

  // --- criterion 3: delete removes the R2 object ---
  const del = await context.request.delete(`${API_BASE}/profiles/${pid}/intro/image`, {
    data: { key },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(del.ok(), `delete image (${del.status()})`).toBeTruthy();
  const gone = await context.request.get(previewUrl);
  expect(gone.ok(), 'preview URL 404/403s after delete').toBeFalsy();
  const afterDelete = await currentProfileId(context);
  expect(afterDelete.profiles.find((p) => p.id === pid).introPhotoKey, 'photo key cleared on delete').toBeNull();

  // Clean up consent so the account is left as found (re-shown if revoked).
  const revoke = await context.request.delete(`${API_BASE}/profiles/${pid}/intro/consent`);
  expect(revoke.ok(), `revoke consent (${revoke.status()})`).toBeTruthy();
  const reverted = await currentProfileId(context);
  expect(reverted.profiles.find((p) => p.id === pid).introConsentAt, 'consent revoked').toBeNull();
});

test('T5190 API: intro facts (position/class/team) persist, expose on profiles + bootstrap, clear independently', async ({ context }) => {
  test.setTimeout(120000);
  await loginAsRealUser(context, REAL_EMAIL);

  const { pid } = await currentProfileId(context);

  async function setFact(field, value) {
    const res = await context.request.put(`${API_BASE}/profiles/${pid}/intro/facts`, {
      data: { field, value },
    });
    expect(res.ok(), `set ${field} (${res.status()})`).toBeTruthy();
    return res.json();
  }

  // --- persistence: set all three fields ---
  const posResult = await setFact('position', 'Midfielder 6-8-10');
  expect(posResult).toEqual({ field: 'position', value: 'Midfielder 6-8-10' });
  await setFact('class', '2029');
  await setFact('team', 'Riverside FC');

  // --- exposure on BOTH payloads ---
  const { profiles } = await currentProfileId(context);
  const me = profiles.find((p) => p.id === pid);
  expect(me.position, 'position exposed on GET /api/profiles').toBe('Midfielder 6-8-10');
  expect(me.class, 'class exposed on GET /api/profiles').toBe('2029');
  expect(me.team, 'team exposed on GET /api/profiles').toBe('Riverside FC');

  const boot = await context.request.get(`${API_BASE}/bootstrap`);
  expect(boot.ok()).toBeTruthy();
  const bootMe = (await boot.json()).profiles.find((p) => p.id === pid);
  expect(bootMe.position, 'position exposed on GET /api/bootstrap').toBe('Midfielder 6-8-10');
  expect(bootMe.class, 'class exposed on GET /api/bootstrap').toBe('2029');
  expect(bootMe.team, 'team exposed on GET /api/bootstrap').toBe('Riverside FC');

  // --- independent clearing: clearing "class" must not touch position/team ---
  const clearResult = await setFact('class', '');
  expect(clearResult).toEqual({ field: 'class', value: null });
  const afterClear = await currentProfileId(context);
  const meAfterClear = afterClear.profiles.find((p) => p.id === pid);
  expect(meAfterClear.class, 'class cleared').toBeNull();
  expect(meAfterClear.position, 'position untouched by clearing class').toBe('Midfielder 6-8-10');
  expect(meAfterClear.team, 'team untouched by clearing class').toBe('Riverside FC');

  // --- reload-persistence regression: a FRESH GET, not just the write
  // response. NOTE: a real browser reload keeps the SAME session cookie (it
  // does not re-login), so the correct simulation is another request on this
  // SAME context, exactly like currentProfileId() above and exactly like the
  // photo/consent test's reload check. A second loginAsRealUser() would
  // re-issue rb_session for this user and invalidate THIS context's cookie
  // (single-active-session model in _issue_session_cookie -- see
  // routers/auth.py), which would make every call after it 401. ---
  const reloaded = await currentProfileId(context);
  const meAfterReload = reloaded.profiles.find((p) => p.id === pid);
  expect(meAfterReload.position, 'position SURVIVES a reload').toBe('Midfielder 6-8-10');
  expect(meAfterReload.class, 'cleared class stays cleared across reload').toBeNull();
  expect(meAfterReload.team, 'team SURVIVES a reload').toBe('Riverside FC');

  const bootReloaded = await context.request.get(`${API_BASE}/bootstrap`);
  const bootMeReloaded = (await bootReloaded.json()).profiles.find((p) => p.id === pid);
  expect(bootMeReloaded.position, 'position SURVIVES a reload (bootstrap)').toBe('Midfielder 6-8-10');
  expect(bootMeReloaded.team, 'team SURVIVES a reload (bootstrap)').toBe('Riverside FC');

  // Clean up: leave the account as found.
  await setFact('position', '');
  await setFact('team', '');
});

test('T5190 UI: profile surface uploads a photo, ticks consent, and consent persists across reload', async ({ context, page }) => {
  test.setTimeout(120000);
  await loginAsRealUser(context, REAL_EMAIL);
  await page.goto('/');

  // Open Manage Profiles from the header sport button, then edit the current profile.
  const profileButton = page.getByRole('button', { name: /switch sport or profile/i });
  await expect(profileButton).toBeVisible({ timeout: 30000 });
  await profileButton.click();
  await expect(page.getByText('Manage Profiles')).toBeVisible();
  await page.getByTitle(/Edit name, color/i).first().click();

  // The intro section renders in edit mode.
  // T6660 renamed "Player intro card" -> "Athlete Intro Card". Exact match so
  // the singular section heading isn't confused with the plural "Athlete Intro
  // Cards" library button in the same edit view.
  await expect(page.getByText('Athlete Intro Card', { exact: true })).toBeVisible();
  await saveEvidence(page, 'criterion-5-profile-intro-surface');

  // --- criterion 1: upload a photo, preview renders ---
  // Scope to the modal's OWN hidden input (the app has other file inputs).
  await page.setInputFiles('[data-testid="intro-image-input"]', {
    name: 'photo.jpg', mimeType: 'image/jpeg', buffer: JPEG_1x1,
  });
  const preview = page.getByAltText('Intro card');
  await expect(preview, 'uploaded preview renders').toBeVisible({ timeout: 30000 });
  await expect(preview).toHaveJSProperty('complete', true);
  await saveEvidence(page, 'criterion-1-image-preview-rendered');

  // --- criterion 4: tick consent ---
  const consent = page.getByRole('checkbox');
  await expect(consent).not.toBeChecked();
  // Controlled checkbox: it only flips once the POST resolves and the store
  // updates, so click once and let the assertion retry (never .check(), which
  // re-clicks when the state doesn't change synchronously).
  await consent.click();
  await expect(consent, 'consent reflects after the write (live store)').toBeChecked();
  await saveEvidence(page, 'criterion-4-consent-ticked');

  // --- structured facts: fill position/class/team, blur each (gesture
  // commit, never per-keystroke -- typing must not fire a request per char).
  // Each PUT /intro/facts is explicitly awaited before moving to the next
  // field: the app serializes per-user writes behind a write lock (see
  // db_sync middleware), so firing three blurs back-to-back can leave the
  // LAST one still in flight when the reload below fires -- a real race that
  // cost a full diagnosis pass (see T5190 task file 2026-08-04 follow-up).
  // blur() only dispatches the DOM event; it does not wait for the async
  // onBlur handler's fetch, so the response wait must be explicit.
  async function fillFact(input, value) {
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes('/intro/facts') && res.request().method() === 'PUT'
    );
    await input.fill(value);
    await input.blur();
    const response = await responsePromise;
    expect(response.ok(), `PUT /intro/facts for "${value}" (${response.status()})`).toBeTruthy();
  }

  const positionInput = page.getByPlaceholder('e.g. Midfielder 6-8-10');
  const classInput = page.getByPlaceholder('e.g. 2029');
  const teamInput = page.getByPlaceholder('e.g. Riverside FC');
  await fillFact(positionInput, 'Midfielder 6-8-10');
  await fillFact(classInput, '2029');
  await fillFact(teamInput, 'Riverside FC');
  await saveEvidence(page, 'criterion-facts-filled');

  // --- criterion 5 (persistence): reload, reopen, confirm consent, photo AND
  // the three facts all survived -- this is the exact bug fix this task
  // guards against. The original T5190 e2e only reloaded to check consent,
  // which is exactly why the missing photo-key persistence slipped through.
  await page.reload();
  await page.getByRole('button', { name: /switch sport or profile/i }).click();
  await page.getByTitle(/Edit name, color/i).first().click();
  // T6660 renamed "Player intro card" -> "Athlete Intro Card". Exact match so
  // the singular section heading isn't confused with the plural "Athlete Intro
  // Cards" library button in the same edit view.
  await expect(page.getByText('Athlete Intro Card', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox'), 'consent PERSISTED across reload').toBeChecked();
  const previewAfterReload = page.getByAltText('Intro card');
  await expect(previewAfterReload, 'photo preview PERSISTED across reload').toBeVisible({ timeout: 30000 });
  await expect(previewAfterReload).toHaveJSProperty('complete', true);
  await expect(page.getByPlaceholder('e.g. Midfielder 6-8-10'), 'position PERSISTED across reload').toHaveValue('Midfielder 6-8-10');
  await expect(page.getByPlaceholder('e.g. 2029'), 'class PERSISTED across reload').toHaveValue('2029');
  await expect(page.getByPlaceholder('e.g. Riverside FC'), 'team PERSISTED across reload').toHaveValue('Riverside FC');
  await saveEvidence(page, 'criterion-1-photo-persisted-after-reload');
  await saveEvidence(page, 'criterion-4-consent-persisted-after-reload');
  await saveEvidence(page, 'criterion-facts-persisted-after-reload');

  // Responsive sweep of the changed screen (375px + desktop, no h-overflow).
  await responsiveSweep(page);

  // Leave the account as found: clear the facts, remove the photo, untick
  // consent (revoke). Clearing via blur-with-empty-value exercises the
  // independent-clear path through the real UI, not just the API. Same
  // wait-for-response helper as above -- the write-lock serialization race
  // is just as real here even though nothing downstream re-asserts on it.
  await fillFact(page.getByPlaceholder('e.g. Midfielder 6-8-10'), '');
  await fillFact(page.getByPlaceholder('e.g. 2029'), '');
  await fillFact(page.getByPlaceholder('e.g. Riverside FC'), '');
  await expect(page.getByPlaceholder('e.g. Midfielder 6-8-10')).toHaveValue('');
  await page.getByRole('button', { name: /remove/i }).click();
  await expect(page.getByAltText('Intro card')).not.toBeVisible();
  await page.getByRole('checkbox').click();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
});
