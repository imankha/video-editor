/**
 * T7360 — Multiple game uploads: the store + UI handle N at a time.
 *
 * Real-browser (chromium) drive of the queue. The global UploadProgressIndicator is
 * app-level, so it renders on any route without the Games tab loading. We drive the
 * REAL store engine (uploadStore) in-page and assert the real DOM, proving the
 * user-visible queue behaviour that jsdom unit tests can't fully guarantee:
 *   - a 2nd upload started while one runs is ACCEPTED and shown as "Queued" (the bug)
 *   - a duplicate drop is rejected VISIBLY (toast) and adds no second entry
 *   - active + failed + queued render together as a stack, each with its own control
 *   - cancelling a queued entry removes it without touching the active upload
 *
 * Network-free: seeding one active entry means a 2nd startUpload takes the QUEUED
 * branch (no uploadManager/network call), and the duplicate/cancel paths are pure.
 */

import { test, expect } from '@playwright/test';

// Setting authStore.isAuthenticated directly (below) does NOT go through App.jsx's
// bootstrap fetch (that only fires inside the real initSession().then() chain, which
// already resolved unauthenticated by the time we override). It goes through the
// separate "auth transition" subscription instead, which fires the INDIVIDUAL
// per-store fetches (fetchProfiles/fetchProjects/fetchGames/fetchProgress/...), not
// /api/bootstrap. Most of those guard a missing field with `|| []`/`|| 0`, but three
// don't and crash the render on a blanket `{}` (uncaught, no error boundary, so it
// unmounts the WHOLE tree incl. UploadProgressIndicator):
//   - /api/profiles       -> profileStore does `data.profiles.find(...)`
//   - /api/projects       -> projectsStore stores the body AS the array, needs `[]`
//   - /api/quests/progress -> questStore does `for (const quest of data.quests)`
const ENDPOINT_SHAPES = {
  '/api/profiles': { profiles: [] },
  '/api/projects': [],
  '/api/quests/progress': { quests: [] },
};

// Neutralise the backend so the app shell mounts without a real session/games fetch.
// Match on PATHNAME prefix, not a substring glob: '**/api/**' also matches the real
// frontend module /src/api/overlayActions.js, which broke module loading entirely
// (MIME-type error) and hung the app on the static index.html preloader forever.
async function stubBackend(page) {
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    const { pathname } = new URL(route.request().url());
    const body = ENDPOINT_SHAPES[pathname] ?? {};
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

// Seed one active upload directly (as if a first upload were in flight), so a second
// startUpload queues rather than hitting the network.
async function seedActiveUpload(page) {
  await page.evaluate(async () => {
    const { useUploadStore, UPLOAD_STATUS } = await import('/src/stores/uploadStore.js');
    useUploadStore.setState({
      uploads: [{
        id: 'seed-active',
        status: UPLOAD_STATUS.UPLOADING,
        file: null, files: null,
        fileName: 'first-game.mp4',
        fileKey: 'first-game.mp4:1000',
        fileSize: 1000, progress: 40,
        phase: 'uploading', message: 'Uploading...',
        startedAt: new Date().toISOString(),
        gameDetails: null, videoMetadata: null, isMultiVideo: false,
        blobUrl: null, gameName: 'first-game.mp4',
        gameId: null, createdGameName: null,
        onComplete: [], onGameCreated: null, retryContext: null,
      }],
      insufficientCredits: null,
    });
  });
}

test.beforeEach(async ({ page }) => {
  await stubBackend(page);
  await page.goto('/');
  // The app's own initSession() (unauthenticated branch, since /api/auth/me is
  // stubbed) is still in flight when goto() resolves and calls
  // setSessionState(false) asynchronously. Overriding authStore before that
  // settles is a race — initSession's callback lands AFTER our override and
  // flips isAuthenticated back to false, so the app renders SignInScreen
  // instead of the UploadProgressIndicator-bearing shell. Wait for the sign-in
  // screen (the deterministic signal that initSession has fully settled) before
  // overriding, so our override is the LAST write, not one that gets clobbered.
  await page.getByText('Sign in to get started').waitFor();
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 't7360@e2e.local', showAuthModal: false });
  });
});

test('a 2nd upload started while one runs is accepted and shown as Queued (the bug)', async ({ page }) => {
  await seedActiveUpload(page);

  // Start a second, different game while the first is "in flight".
  const result = await page.evaluate(async () => {
    const { useUploadStore } = await import('/src/stores/uploadStore.js');
    const f = new File([new Uint8Array(2000)], 'second-game.mp4', { type: 'video/mp4' });
    const id = useUploadStore.getState().startUpload(f, { opponentName: 'Rivals' }, { duration: 1 });
    const s = useUploadStore.getState();
    return { id, count: s.uploads.length, second: s.uploads.find(u => u.fileName === 'second-game.mp4')?.status };
  });

  expect(result.id).toBeTruthy();      // accepted, not dropped (old code returned null)
  expect(result.count).toBe(2);        // both coexist
  expect(result.second).toBe('queued'); // second waits behind the active one

  // The global indicator renders the active card AND a Queued row. Scoped to the
  // corner indicator: ProjectManager's Games-tab card ALSO renders the same queue
  // (both are correct, independent consumer surfaces per the design), so an
  // unscoped getByText('second-game.mp4') matches both and is ambiguous.
  const indicator = page.locator('div.fixed.bottom-4.right-4');
  await expect(indicator.getByText('Uploading first-game.mp4')).toBeVisible();
  await expect(indicator.getByText('second-game.mp4')).toBeVisible();
  await expect(indicator.getByText('Queued')).toBeVisible();
});

test('a duplicate drop is rejected visibly and adds no second entry', async ({ page }) => {
  await seedActiveUpload(page);

  const result = await page.evaluate(async () => {
    const { useUploadStore } = await import('/src/stores/uploadStore.js');
    // Same identity as the seeded active upload (name + size).
    const dup = new File([new Uint8Array(1000)], 'first-game.mp4', { type: 'video/mp4' });
    const id = useUploadStore.getState().startUpload(dup);
    return { id, count: useUploadStore.getState().uploads.length };
  });

  expect(result.id).toBe('seed-active'); // returns the EXISTING entry's id
  expect(result.count).toBe(1);          // no second entry created
  // Visible rejection (was a silent console.warn).
  await expect(page.getByText(/already queued/i)).toBeVisible();
});

test('active + failed + queued render as a stack, each with its own control', async ({ page }) => {
  await page.evaluate(async () => {
    const { useUploadStore, UPLOAD_STATUS } = await import('/src/stores/uploadStore.js');
    const mk = (id, name, status, over = {}) => ({
      id, status, file: null, files: null, fileName: name, fileKey: `${name}:1`,
      fileSize: 1000, progress: 0, phase: 'hashing', message: 'Queued',
      startedAt: new Date().toISOString(), gameDetails: null, videoMetadata: null,
      isMultiVideo: false, blobUrl: null, gameName: name, gameId: null,
      createdGameName: null, onComplete: [], onGameCreated: null, retryContext: {}, ...over,
    });
    useUploadStore.setState({
      uploads: [
        mk('a', 'active.mp4', UPLOAD_STATUS.UPLOADING, { progress: 55, phase: 'uploading', message: 'Uploading...' }),
        mk('b', 'failed.mp4', UPLOAD_STATUS.ERROR, { phase: 'error', message: 'Upload failed' }),
        mk('c', 'waiting.mp4', UPLOAD_STATUS.QUEUED),
      ],
      insufficientCredits: null,
    });
  });

  // Scoped to the corner indicator: ProjectManager's Games-tab card ALSO renders
  // this same queue (both are correct, independent consumer surfaces per the
  // design) with its own Retry/Cancel controls, so unscoped locators are ambiguous.
  const indicator = page.locator('div.fixed.bottom-4.right-4');
  await expect(indicator.getByText('Uploading active.mp4')).toBeVisible(); // active card
  await expect(indicator.getByText('Upload failed')).toBeVisible();        // failed row...
  await expect(indicator.getByRole('button', { name: 'Retry' })).toBeVisible();   // ...with Retry
  await expect(indicator.getByText('waiting.mp4')).toBeVisible();          // queued row...
  await expect(indicator.getByRole('button', { name: 'Cancel' })).toBeVisible();  // ...with Cancel

  // Cancelling the queued entry removes it; the active upload is untouched.
  await indicator.getByRole('button', { name: 'Cancel' }).click();
  await expect(indicator.getByText('waiting.mp4')).toHaveCount(0);
  await expect(indicator.getByText('Uploading active.mp4')).toBeVisible();
  const count = await page.evaluate(async () => {
    const { useUploadStore } = await import('/src/stores/uploadStore.js');
    return useUploadStore.getState().uploads.length;
  });
  expect(count).toBe(2);
});
