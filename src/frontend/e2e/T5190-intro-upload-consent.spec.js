import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

/**
 * T5190 — Card image upload + parental-consent attestation (QA live-drive).
 *
 * Two tests:
 *  1. API round-trip as the real account: upload a real image -> per-profile key
 *     (SHAPE includes the profile id, the 404 landmine) + a preview URL that
 *     actually fetches the stored object; consent recorded, exposed on the
 *     profiles payload, isolated per profile, and gone after revoke/delete.
 *  2. UI live-drive of the profile surface: open Manage Profiles -> Edit ->
 *     upload a photo (preview renders) -> tick consent -> reload -> reopen and
 *     confirm consent PERSISTED. Evidence per acceptance criterion + a 375px +
 *     desktop responsive sweep of the changed screen.
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
  await expect(page.getByText('Player intro card')).toBeVisible();
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

  // --- criterion 5 (persistence): reload, reopen, confirm consent AND the
  // photo preview both survived -- this is the bug fix. The original T5190
  // e2e only reloaded to check consent, which is exactly why the missing
  // photo-key persistence slipped through.
  await page.reload();
  await page.getByRole('button', { name: /switch sport or profile/i }).click();
  await page.getByTitle(/Edit name, color/i).first().click();
  await expect(page.getByText('Player intro card')).toBeVisible();
  await expect(page.getByRole('checkbox'), 'consent PERSISTED across reload').toBeChecked();
  const previewAfterReload = page.getByAltText('Intro card');
  await expect(previewAfterReload, 'photo preview PERSISTED across reload').toBeVisible({ timeout: 30000 });
  await expect(previewAfterReload).toHaveJSProperty('complete', true);
  await saveEvidence(page, 'criterion-1-photo-persisted-after-reload');
  await saveEvidence(page, 'criterion-4-consent-persisted-after-reload');

  // Responsive sweep of the changed screen (375px + desktop, no h-overflow).
  await responsiveSweep(page);

  // Leave the account as found: remove the photo, untick consent (revoke).
  await page.getByRole('button', { name: /remove/i }).click();
  await expect(page.getByAltText('Intro card')).not.toBeVisible();
  await page.getByRole('checkbox').click();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
});
