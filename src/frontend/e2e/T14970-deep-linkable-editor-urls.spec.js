import { test, expect } from '@playwright/test';
import { loginAsDevPreset } from './helpers/realAuth';

/**
 * T14970: an editor page has an address, and a cold load of it reproduces the page.
 * Runs on a desktop and a phone viewport against the `full` dev preset.
 *
 * Run: bash scripts/dev-verify.sh e2e/T14970-deep-linkable-editor-urls.spec.js --reporter=line
 */

const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
  { name: 'phone', viewport: { width: 390, height: 844 } },
];

const UNKNOWN_ID = 99999999;

async function listProjects(page) {
  return page.evaluate(async () => {
    const res = await fetch('/api/projects', { credentials: 'include' });
    return res.json();
  });
}

async function listGames(page) {
  return page.evaluate(async () => {
    const res = await fetch('/api/games', { credentials: 'include' });
    const body = await res.json();
    return body.games ?? body;
  });
}

async function currentProfileId(page) {
  return page.evaluate(async () => {
    const { useProfileStore } = await import('/src/stores/profileStore.js');
    await useProfileStore.getState().fetchProfiles({ force: true });
    return useProfileStore.getState().currentProfileId;
  });
}

async function createAndSelectEmptyProfile(page) {
  return page.evaluate(async () => {
    const created = await fetch('/api/profiles', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `T14970 ${crypto.randomUUID().slice(0, 8)}`, color: '#3b82f6' }),
    }).then((res) => res.json());
    return created.id;
  }).then(async (id) => {
    await selectProfile(page, id);
    return id;
  });
}

async function selectProfile(page, profileId) {
  await page.evaluate(async (id) => {
    await fetch('/api/profiles/current', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: id }),
    });
  }, profileId);
}

// A value that only survives while the same document stays loaded.
async function markDocument(page) {
  return page.evaluate(() => {
    window.__t14970Mark ??= crypto.randomUUID();
    return window.__t14970Mark;
  });
}

async function expectOnGame(page, gameId) {
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 30000 }).toBe(`/annotate/g/${gameId}`);
  await expect.poll(
    () => page.evaluate(async () => {
      const { useEditorStore } = await import('/src/stores/editorStore.js');
      return useEditorStore.getState().activeAnnotateGameId;
    }),
    { timeout: 30000 },
  ).toBe(gameId);
}

async function loadFirstGame(page) {
  const [{ id }] = await listGames(page);
  return page.evaluate(async (gameId) => {
    const res = await fetch(`/api/games/${gameId}/load`, { credentials: 'include' });
    return (await res.json()).game;
  }, id);
}

function pathProjectId(page) {
  const match = new URL(page.url()).pathname.match(/^\/(?:focus|overlay)\/p\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

// Tap a tile on the Plays tab, skipping the play in `other`.
async function openPlayFromTile(page, { other = null } = {}) {
  const tile = page.locator(other == null
    ? '[data-testid="project-card"]'
    : `[data-testid="project-card"]:not([data-project-id="${other}"])`).first();
  await tile.waitFor({ timeout: 30000 });
  const id = Number(await tile.getAttribute('data-project-id'));
  await tile.click();
  await expectOnPlay(page, id);
  return id;
}

async function openPlaysTab(page) {
  await page.getByRole('button', { name: /^Plays\b/ }).click();
}

async function clickPlaysLink(page) {
  await page.locator('[data-testid="editor-home"]:visible').first().click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 30000 }).toMatch(/^\/home/);
  await openPlaysTab(page);
}

async function expectGamesTabWithNotice(page, notice) {
  await expect(page.getByText(notice)).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveURL(/\/home\/games$/);
  const [game] = await listGames(page);
  await expect(page.getByText(game.name).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("We couldn't load your games")).toHaveCount(0);
  await expect(page.getByTestId('home-games-retry')).toHaveCount(0);
}

// What the user sees: the <video> not hidden behind the two-slot crossfade.
async function expectVideoAt(page, seconds) {
  await expect.poll(
    () => page.evaluate(() => {
      const video = [...document.querySelectorAll('video')]
        .find((v) => v.getAttribute('aria-hidden') !== 'true' && v.currentSrc);
      return video ? video.currentTime : null;
    }),
    { timeout: 45000, message: `visible video reaches ${seconds}s` },
  ).toBeCloseTo(seconds, 0);
}

// A second profile whose first game has the same id as `game`: the collision ?profile=
// exists to resolve. It reuses the preset's short video, so it is a real, distinct game.
async function createTwinProfile(page, game) {
  return page.evaluate(async ({ hash, duration }) => {
    const json = { 'Content-Type': 'application/json' };
    const profile = await fetch('/api/profiles', {
      method: 'POST',
      credentials: 'include',
      headers: json,
      body: JSON.stringify({ name: `Twin ${crypto.randomUUID().slice(0, 6)}`, color: '#3b82f6' }),
    }).then((res) => res.json());
    const created = await fetch('/api/games', {
      method: 'POST',
      credentials: 'include',
      headers: { ...json, 'X-Profile-ID': profile.id },
      body: JSON.stringify({
        name: 'Twin game',
        videos: [{ sequence: 1, blake3_hash: hash, duration, file_size: 1000, width: 1280, height: 720, fps: 30 }],
      }),
    }).then((res) => res.json());
    return { id: profile.id, name: profile.name, gameId: created.game_id };
  }, { hash: game.videos.at(-1).blake3_hash, duration: game.videos.at(-1).duration });
}

async function serverActiveProfile(page) {
  return page.evaluate(async () => {
    const { profiles } = await fetch('/api/profiles', { credentials: 'include' }).then((res) => res.json());
    return profiles.find((p) => p.isCurrent)?.id;
  });
}

async function switchProfileInUi(page, profileName) {
  await page.getByTitle(/Switch sport or profile/).first().click();
  await page.getByRole('button', { name: new RegExp(profileName) }).first().click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 30000 }).toMatch(/^\/home/);
}

async function openedGameName(page) {
  return page.evaluate(async () => {
    const { useGamesDataStore } = await import('/src/stores/gamesDataStore.js');
    return useGamesDataStore.getState().selectedGame?.name ?? null;
  });
}

async function expectGameOpen(page, gameId, name) {
  await expectOnGame(page, gameId);
  await expect.poll(() => openedGameName(page), { timeout: 30000 }).toBe(name);
}

function urlProfile(page) {
  return new URL(page.url()).searchParams.get('profile');
}

async function backUntil(page, matches) {
  for (let step = 0; step < 6 && !matches(new URL(page.url())); step += 1) {
    await page.goBack();
    await page.waitForTimeout(400);
  }
  expect(matches(new URL(page.url())), `history reached ${page.url()}`).toBe(true);
}

async function expectVisibleVideoLongerThan(page, seconds) {
  await expect.poll(
    () => page.evaluate(() => {
      const video = [...document.querySelectorAll('video')]
        .find((v) => v.getAttribute('aria-hidden') !== 'true' && v.currentSrc);
      return video?.duration ?? 0;
    }),
    { timeout: 45000, message: 'the visible video is this game\'s long video, not the twin' },
  ).toBeGreaterThan(seconds);
}

// Leaves the path on an editor object, or fails: a bounce home is what this guards.
async function expectOnPlay(page, projectId) {
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 30000 })
    .toMatch(new RegExp(`^/(focus|overlay)/p/${projectId}$`));
  await expect.poll(
    () => page.evaluate(async () => {
      const { useProjectsStore } = await import('/src/stores/projectsStore.js');
      return useProjectsStore.getState().selectedProject?.id ?? null;
    }),
    { timeout: 30000 },
  ).toBe(projectId);
}

for (const { name, viewport } of VIEWPORTS) {
  test.describe(`deep-linkable editor URLs (${name})`, () => {
    test.use({ viewport });

    test.beforeEach(async ({ context }) => {
      await loginAsDevPreset(context, 'full');
    });

    test('reload on an open play lands on the same play', async ({ page }) => {
      await page.goto('/home/reels');
      const [project] = await listProjects(page);
      expect(project, 'the full preset has a play').toBeTruthy();

      await page.goto(`/focus/p/${project.id}`);
      await expectOnPlay(page, project.id);

      await page.reload();
      await expectOnPlay(page, project.id);
    });

    test('Back reaches the previous play after clicking through the Plays link', async ({ page }) => {
      await page.goto('/home/games');
      await openPlaysTab(page);
      const playA = await openPlayFromTile(page);
      const documentMark = await markDocument(page);

      await clickPlaysLink(page);
      const playB = await openPlayFromTile(page, { other: playA });
      expect(playB).not.toBe(playA);

      await page.goBack();
      await expect.poll(() => new URL(page.url()).pathname, { timeout: 30000 }).toMatch(/^\/home/);
      await page.goBack();
      await expectOnPlay(page, playA);

      await page.goForward();
      await expect.poll(() => new URL(page.url()).pathname, { timeout: 30000 }).toMatch(/^\/home/);
      await page.goForward();
      await expectOnPlay(page, playB);

      expect(await markDocument(page), 'every step stayed in one document').toBe(documentMark);
    });

    test('Watch plays keeps the game address during playback, after it, and on a reload', async ({ page }) => {
      await page.goto('/home/games');
      const games = await listGames(page);
      const game = games.find(g => g.clip_count > 0);
      expect(game, 'the full preset has a game with plays').toBeTruthy();

      // 150 s sits between plays: the Watch plays card is hidden while a play is selected.
      await page.goto(`/annotate/g/${game.id}?t=150`);
      await expectOnGame(page, game.id);
      const address = () => { const url = new URL(page.url()); return url.pathname + url.search; };
      const before = address();

      const watchPlays = page.locator('[data-testid="annotate-review-plays"]:visible').first();
      await watchPlays.waitFor({ timeout: 30000 });
      await watchPlays.click();
      await expect(page.getByTestId('playback-mode-badge')).toBeVisible({ timeout: 30000 });
      expect(address()).toBe(before);

      await page.goBack();
      await expect(page.getByTestId('playback-mode-badge')).toBeHidden({ timeout: 30000 });
      expect(address()).toBe(before);

      await page.reload();
      await expectOnGame(page, game.id);
    });

    test('reload on an open game lands on the same game', async ({ page }) => {
      await page.goto('/home/games');
      const [game] = await listGames(page);
      expect(game, 'the full preset has a game').toBeTruthy();

      await page.goto(`/annotate/g/${game.id}`);
      await expectOnGame(page, game.id);

      await page.reload();
      await expectOnGame(page, game.id);
    });

    test("a game in another of the user's profiles switches profile and opens it", async ({ page }) => {
      await page.goto('/home/games');
      const [game] = await listGames(page);
      const ownerProfileId = await currentProfileId(page);
      const emptyProfileId = await createAndSelectEmptyProfile(page);

      try {
        await page.goto(`/annotate/g/${game.id}`);
        await expectOnGame(page, game.id);
        expect(await currentProfileId(page)).toBe(ownerProfileId);
        expect(ownerProfileId).not.toBe(emptyProfileId);
      } finally {
        // The preset account is shared by the tests after this one.
        await selectProfile(page, ownerProfileId);
      }
    });

    test('an unknown play lands on a working Games tab with the notice', async ({ page }) => {
      await page.goto(`/focus/p/${UNKNOWN_ID}`);
      await expectGamesTabWithNotice(page, 'That play is no longer here');
    });

    test('an unknown game lands on a working Games tab with the notice', async ({ page }) => {
      await page.goto(`/annotate/g/${UNKNOWN_ID}`);
      await expectGamesTabWithNotice(page, 'That game is no longer here');
    });

    test('a malformed play id gets the same notice', async ({ page }) => {
      await page.goto('/focus/p/abc');
      await expectGamesTabWithNotice(page, 'That play is no longer here');
    });

    test('a malformed game id gets the same notice', async ({ page }) => {
      await page.goto('/annotate/g/abc');
      await expectGamesTabWithNotice(page, 'That game is no longer here');
    });

    test('?t= moves the real video on a multi-video game, in either video', async ({ page }) => {
      await page.goto('/home/games');
      const game = await loadFirstGame(page);
      expect(game.videos.length, 'the full preset game has two videos').toBeGreaterThan(1);
      const firstVideoLength = game.videos[0].duration;

      await page.goto(`/annotate/g/${game.id}?t=60`);
      await expectOnGame(page, game.id);
      await expectVideoAt(page, 60);

      const inSecondVideo = firstVideoLength + 20;
      await page.goto(`/annotate/g/${game.id}?t=${inSecondVideo}`);
      await expectOnGame(page, game.id);
      await expectVideoAt(page, 20);
    });

    test('?t= moves the real video on a single-video game', async ({ page }) => {
      await page.goto('/home/games');
      const game = await loadFirstGame(page);

      // Every preset game has two videos. Trim /load to the first so the single-video path
      // runs on real bytes; only this response is rewritten.
      await page.route(`**/api/games/${game.id}/load`, async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        const [only] = body.game.videos;
        body.game.videos = [only];
        body.game.video_duration = only.duration;
        await route.fulfill({ response, json: body });
      });

      await page.goto(`/annotate/g/${game.id}?t=60`);
      await expectOnGame(page, game.id);
      await expectVideoAt(page, 60);
    });

    test('a profile the user does not own lands on Games with the notice', async ({ page }) => {
      await page.goto('/home/games');
      const [game] = await listGames(page);
      const [project] = await listProjects(page);

      await page.goto(`/annotate/g/${game.id}?profile=deadbeef`);
      await expectGamesTabWithNotice(page, 'That game is no longer here');
      expect(await openedGameName(page)).toBeNull();

      await page.goto(`/focus/p/${project.id}?profile=deadbeef`);
      await expectGamesTabWithNotice(page, 'That play is no longer here');
    });

    test('?t= survives opening a named profile from another one, and a reload', async ({ page }) => {
      await page.goto('/home/games');
      const game = await loadFirstGame(page);
      const ownerProfileId = await currentProfileId(page);
      const emptyProfileId = await createAndSelectEmptyProfile(page);
      try {
        await page.goto(`/annotate/g/${game.id}?profile=${ownerProfileId}&t=60`);
        await expectOnGame(page, game.id);
        await expectVideoAt(page, 60);
        expect(new URL(page.url()).searchParams.get('t')).toBe('60');

        await page.reload();
        await expectOnGame(page, game.id);
        await expectVideoAt(page, 60);
        expect(await serverActiveProfile(page), 'opening a link leaves the active profile alone').toBe(emptyProfileId);
      } finally {
        await selectProfile(page, ownerProfileId);
      }
    });

    test('?t= survives the 404 search on an old bookmark, and a reload', async ({ page }) => {
      await page.goto('/home/games');
      const game = await loadFirstGame(page);
      const ownerProfileId = await currentProfileId(page);
      await createAndSelectEmptyProfile(page);
      try {
        await page.goto(`/annotate/g/${game.id}?t=60`);
        await expectOnGame(page, game.id);
        await expectVideoAt(page, 60);
        await expect.poll(() => new URL(page.url()).search).toBe(`?profile=${ownerProfileId}&t=60`);

        await page.reload();
        await expectOnGame(page, game.id);
        await expectVideoAt(page, 60);
      } finally {
        await selectProfile(page, ownerProfileId);
      }
    });

    test('Back during a slow load lands on the right play with the right clips', async ({ page }) => {
      await page.goto('/home/games');
      await openPlaysTab(page);
      const playA = await openPlayFromTile(page);
      await clickPlaysLink(page);

      const playB = await page.locator(`[data-testid="project-card"]:not([data-project-id="${playA}"])`)
        .first().getAttribute('data-project-id');
      await page.route(`**/api/clips/projects/${playB}/clips*`, async (route) => {
        await new Promise((resolve) => { setTimeout(resolve, 4000); });
        await route.continue();
      });
      await page.locator(`[data-project-id="${playB}"]`).click();
      await expect.poll(() => pathProjectId(page), { timeout: 30000 }).toBe(Number(playB));

      await page.goBack();
      await expect.poll(() => new URL(page.url()).pathname, { timeout: 30000 }).toMatch(/^\/home/);
      await page.goBack();
      await expectOnPlay(page, playA);

      // Past the delayed response, so a stale load has had every chance to land.
      await page.waitForTimeout(6000);
      await expectOnPlay(page, playA);
      const clips = await page.evaluate(async (id) => {
        const { useProjectDataStore } = await import('/src/stores/projectDataStore.js');
        const expected = await fetch(`/api/clips/projects/${id}/clips`, { credentials: 'include' }).then((res) => res.json());
        return {
          shown: useProjectDataStore.getState().clips.map((clip) => clip.id),
          expected: expected.map((clip) => clip.id),
        };
      }, playA);
      expect(clips.shown).toEqual(clips.expected);
      expect(clips.shown.length).toBeGreaterThan(0);
    });

    test('a cold /home/reels stays on Plays for an account with plays', async ({ page }) => {
      await page.goto('/home/reels');
      await expect(page.getByTestId('project-card').first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1000);
      await expect(page).toHaveURL(/\/home\/reels$/);
      await expect(page.getByTestId('project-card').first()).toBeVisible();
    });

    test('a tab keeps its own media after a second tab switches the account', async ({ page, context }) => {
      await page.goto('/home/games');
      const game = await loadFirstGame(page);
      const ownerProfileId = await currentProfileId(page);
      const otherProfile = await page.evaluate(async () => fetch('/api/profiles', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Second ${crypto.randomUUID().slice(0, 6)}`, color: '#3b82f6' }),
      }).then((res) => res.json()));

      const secondTab = await context.newPage();
      try {
        await secondTab.goto('/home/games');
        await switchProfileInUi(secondTab, otherProfile.name);
        await expect.poll(() => serverActiveProfile(secondTab), { timeout: 30000 }).toBe(otherProfile.id);

        // The first tab was never told. A media element cannot send the header, so its URL is
        // all that says which profile it means.
        const videoResponses = [];
        page.on('response', (response) => {
          if (new URL(response.url()).pathname === `/api/games/${game.id}/video`) videoResponses.push(response);
        });
        await page.getByText(game.name).first().click();
        await expectGameOpen(page, game.id, game.name);
        await expect.poll(() => videoResponses.length, { timeout: 30000 }).toBeGreaterThan(0);
        for (const response of videoResponses) {
          expect(new URL(response.url()).searchParams.get('profile_id')).toBe(ownerProfileId);
          expect(response.status(), response.url()).toBeLessThan(400);
        }
        expect(await currentProfileId(page)).toBe(ownerProfileId);
      } finally {
        await secondTab.close();
        await selectProfile(page, ownerProfileId);
      }
    });

    test('a bare editor path still bounces home', async ({ page }) => {
      await page.goto('/focus');
      await expect(page).toHaveURL(/\/home/, { timeout: 30000 });
    });
  });

  // The `upload` preset's game is id 1, and a fresh profile's first game is id 1 too.
  test.describe(`one id in two profiles (${name})`, () => {
    test.use({ viewport });

    test.beforeEach(async ({ context }) => {
      await loginAsDevPreset(context, 'upload');
    });

    test('?profile= decides which game opens, through clicks, Back and a reload', async ({ page }) => {
      await page.goto('/home/games');
      const game = await loadFirstGame(page);
      const ownerProfileId = await currentProfileId(page);
      const twin = await createTwinProfile(page, game);
      expect(twin.gameId, 'the two games share an id').toBe(game.id);

      try {
        // Open each game by tapping its tile, moving between profiles in the real switcher.
        await page.getByText(game.name).first().click();
        await expectGameOpen(page, game.id, game.name);
        expect(urlProfile(page)).toBe(ownerProfileId);
        const ownerUrl = new URL(page.url()).pathname + new URL(page.url()).search;

        await page.locator('[data-testid="editor-home"]:visible').first().click();
        await expect.poll(() => new URL(page.url()).pathname, { timeout: 30000 }).toMatch(/^\/home/);
        await switchProfileInUi(page, twin.name);
        await page.getByRole('button', { name: /^Games\b/ }).click();
        await page.getByText('Twin game').first().click();
        await expectGameOpen(page, game.id, 'Twin game');
        expect(urlProfile(page)).toBe(twin.id);

        // Back across the profile boundary, in one document.
        await backUntil(page, (url) => url.pathname.startsWith('/annotate') && url.searchParams.get('profile') === ownerProfileId);
        await expectGameOpen(page, game.id, game.name);
        await expectVisibleVideoLongerThan(page, 1000);

        // The account's active profile is the twin's. The URL still decides.
        await page.goto(ownerUrl);
        await expectGameOpen(page, game.id, game.name);
        await expectVisibleVideoLongerThan(page, 1000);
        await page.reload();
        await expectGameOpen(page, game.id, game.name);
        await expectVisibleVideoLongerThan(page, 1000);
        expect(await serverActiveProfile(page), 'nothing here changed the active profile').toBe(twin.id);

        await page.goto(`/annotate/g/${game.id}?profile=${twin.id}`);
        await expectGameOpen(page, game.id, 'Twin game');
      } finally {
        await selectProfile(page, ownerProfileId);
      }
    });

    test('the T7670 email link opens the right game in the right profile', async ({ page }) => {
      await page.goto('/home/games');
      const game = await loadFirstGame(page);
      const ownerProfileId = await currentProfileId(page);
      const twin = await createTwinProfile(page, game);
      await selectProfile(page, twin.id);

      try {
        await page.goto(`/?game=${game.id}&profile=${ownerProfileId}`);
        await expectGameOpen(page, game.id, game.name);
        expect(urlProfile(page)).toBe(ownerProfileId);
        await expectVisibleVideoLongerThan(page, 1000);
      } finally {
        await selectProfile(page, ownerProfileId);
      }
    });
  });
}
