import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T6650 QA -- proves, end to end in the REAL running app (real backend + real
 * R2), that a shared intro image object is no longer destroyed by a delete from
 * one owner, and that a dangling key surfaces as a visible "photo missing"
 * state instead of a silent broken <img>.
 *
 * The live repro this replaces (task file): "create a card, delete it, and the
 * profile photo is gone" -- the card seeds its image_key from the profile's
 * intro_photo_key, and the card delete used to hard-delete that shared R2
 * object. These tests drive the REAL endpoints so the assertion (the object
 * survives the card delete) is a true R2 round trip, not a client echo.
 *
 * Account: imankh@gmail.com / profile 9fa7378c (dev-login, real R2/Postgres) --
 * the account from the bug evidence and the T6680/T6710 QA specs.
 *
 * Run: bash scripts/dev-verify.sh e2e/T6650-intro-photo-ownership.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const REAL_PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

// A minimal valid 8x8 PNG (cv2-decodable) used to seed/replace the profile
// photo. Generated via cv2.imencode, checked in as base64.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAK0lEQVQIHW3BAQEAAADBMNqI+IhiKWBziR6X6HGJHpfocYkel+hxiR6X6BnkqAtJWhhtsgAAAABJRU5ErkJggg==';

// Upload an intro photo via the BROWSER's own fetch (credentials: 'include') so
// the real session cookie rides along -- Playwright's request.post(multipart)
// does not attach the browser-context session cookie for multipart bodies.
async function uploadIntroPhotoViaBrowser(page, profileId) {
  return page.evaluate(
    async ({ profileId, b64 }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const form = new FormData();
      form.append('image', new Blob([bytes], { type: 'image/png' }), 'photo.png');
      const resp = await fetch(`/api/profiles/${profileId}/intro/image`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      return { ok: resp.ok, status: resp.status, body: resp.ok ? await resp.json() : null };
    },
    { profileId, b64: PNG_BASE64 },
  );
}

async function getProfile(page) {
  const resp = await page.request.get('/api/profiles');
  expect(resp.ok(), 'GET /api/profiles').toBe(true);
  const { profiles } = await resp.json();
  const profile = profiles.find((p) => p.id === REAL_PROFILE) || profiles[0];
  expect(profile, 'a profile must exist').toBeTruthy();
  return profile;
}

// Create a card and confirm it is durably listed before returning -- the real
// account rides async R2 DB sync, so an immediate follow-up write can race a
// mid-sequence restore. Polling GET (what the real UI does) makes the QA
// deterministic without masking any product behaviour.
async function createCardAndConfirm(page, data) {
  const createResp = await page.request.post('/api/intro-cards', { data });
  expect(createResp.ok(), 'create card').toBe(true);
  const created = await createResp.json();
  for (let i = 0; i < 10; i++) {
    const list = await page.request.get('/api/intro-cards');
    const { cards } = await list.json();
    if (cards.some((c) => c.id === created.id)) return created;
    await page.waitForTimeout(500);
  }
  throw new Error(`created card ${created.id} never became durably listed`);
}

// Delete a card, tolerating a transient 404 from the same async-sync race.
async function deleteCard(page, cardId) {
  for (let i = 0; i < 10; i++) {
    const resp = await page.request.delete(`/api/intro-cards/${cardId}`);
    if (resp.ok()) return;
    if (resp.status() !== 404) {
      expect(resp.ok(), `delete card (status ${resp.status()})`).toBe(true);
    }
    // 404 -> card row not visible yet under the current synced snapshot; settle.
    const list = await page.request.get('/api/intro-cards');
    const { cards } = await list.json();
    if (!cards.some((c) => c.id === cardId)) return; // already gone -> done
    await page.waitForTimeout(500);
  }
  throw new Error(`card ${cardId} could not be deleted`);
}

async function objectExists(page, presignedUrl) {
  if (!presignedUrl) return false;
  const resp = await page.request.get(presignedUrl);
  return resp.status() === 200;
}

async function ensureConsent(page, profileId) {
  await page.request.post(`/api/profiles/${profileId}/intro/consent`);
}

async function ensureProfilePhoto(page, profile) {
  if (profile.introPhotoKey) return profile;
  const up = await uploadIntroPhotoViaBrowser(page, profile.id);
  expect(up.ok, `seed profile photo upload (status ${up.status})`).toBe(true);
  return getProfile(page);
}

test.describe('T6650 intro image shared ownership (real account)', () => {
  test('AC: deleting a card whose image_key is the profile photo leaves the object intact', async ({ page }) => {
    await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    let profile = await getProfile(page);
    await ensureConsent(page, profile.id);
    profile = await ensureProfilePhoto(page, profile);

    const sharedKey = profile.introPhotoKey;
    expect(sharedKey, 'profile must have an intro photo key').toBeTruthy();
    // Baseline: the object exists right now.
    expect(await objectExists(page, profile.introPhotoUrl), 'profile photo object exists pre-delete').toBe(true);

    // Create a card that DEFAULTS its image to the profile key (the real
    // introCardDefaults behaviour -- same key, not a copy).
    const created = await createCardAndConfirm(page, {
      name: `T6650 QA ${Date.now()}`,
      treatment: 'gold',
      image_key: sharedKey,
    });
    expect(created.image_key, 'card shares the profile key').toBe(sharedKey);

    // Delete the card -- the gesture that used to destroy the shared object.
    await deleteCard(page, created.id);

    // THE ASSERTION: the profile still points at the key AND the R2 object is
    // still there. Re-fetch a FRESH presigned URL (the old one may have
    // expired) via GET /api/profiles -- a real round trip through the backend.
    const after = await getProfile(page);
    expect(after.introPhotoKey, 'profile key unchanged by the card delete').toBe(sharedKey);
    expect(
      await objectExists(page, after.introPhotoUrl),
      'CORE BUG FIXED: profile photo object survives the card delete',
    ).toBe(true);

    await saveEvidence(page, 'T6650-card-delete-keeps-profile-photo');
  });

  test('mirror AC: replacing the profile photo leaves an object a card still references intact', async ({ page }) => {
    await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    let profile = await getProfile(page);
    await ensureConsent(page, profile.id);
    profile = await ensureProfilePhoto(page, profile);
    const originalKey = profile.introPhotoKey;

    // A card references the SAME object as the profile.
    const created = await createCardAndConfirm(page, {
      name: `T6650 mirror ${Date.now()}`,
      treatment: 'gold',
      image_key: originalKey,
    });

    try {
      // Replace the profile photo -> mints a NEW key; the OLD object must NOT be
      // destroyed because the card still references it.
      const up = await uploadIntroPhotoViaBrowser(page, profile.id);
      expect(up.ok, `replace profile photo (status ${up.status})`).toBe(true);
      expect(up.body.key, 'replace minted a new key').not.toBe(originalKey);

      // The card still points at the original key, and that object still exists.
      const cardsResp = await page.request.get('/api/intro-cards');
      const { cards } = await cardsResp.json();
      const stillThere = cards.find((c) => c.id === created.id);
      expect(stillThere.image_key, 'card still references the original key').toBe(originalKey);
      expect(
        await objectExists(page, stillThere.previewUrl),
        'MIRROR BUG FIXED: the card-referenced object survives the profile-photo replace',
      ).toBe(true);

      await saveEvidence(page, 'T6650-profile-replace-keeps-card-photo');
    } finally {
      await deleteCard(page, created.id).catch(() => {});
    }
  });

  test('AC: a dangling key shows a visible "photo missing" state (not a silent broken img)', async ({ page }) => {
    await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    let profile = await getProfile(page);
    await ensureConsent(page, profile.id);
    profile = await ensureProfilePhoto(page, profile);

    // Force the intro photo object to fail to load in the REAL browser (a dead
    // key looks exactly like this to the <img>), so the onError -> "photo
    // missing" state is exercised end to end. We do NOT delete a real object.
    await page.route(
      (url) => /\/intro\//.test(url.pathname) && /\.(png|jpg|jpeg)/i.test(url.pathname),
      (route) => route.fulfill({ status: 404, body: '' }),
    );

    // Open Manage Profiles -> Edit -> the Athlete Intro Card section.
    await page.getByRole('button', { name: /Switch sport or profile/i }).click();
    await expect(page.getByRole('heading', { name: 'Manage Profiles' })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Edit name, color & sport' }).first().click();
    await expect(page.getByRole('heading', { name: 'Athlete Intro Card' })).toBeVisible({ timeout: 10000 });

    // The thumbnail's <img> load fails -> the visible "photo missing" state.
    await expect(page.getByTestId('profile-photo-missing')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Re-upload' })).toBeVisible();

    await saveEvidence(page, 'T6650-dangling-key-photo-missing');
  });
});
