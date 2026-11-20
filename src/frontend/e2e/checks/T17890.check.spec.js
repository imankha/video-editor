/**
 * T17890 - the T17860:C2 steps on a play whose stored cut list is partial.
 *
 * The staging run of T17860:C2 timed out waiting for the split's save: its play stored
 * segments_data {trimRange: null} (what clear_trim_range writes on a play no gesture had touched;
 * the backend keeps only the keys a gesture wrote), and Frame's split mirror threw before sending
 * split_segment. This check makes that state on a new play: it marks a play on a game Frame can
 * load, sends the clear-trim gesture's save, confirms the server holds exactly {trimRange: null},
 * then runs the T17860:C2 steps (each split, trim and speed save must succeed). The play is
 * deleted afterwards.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17890.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';
import { closeKeepsEdits } from '../helpers/trimToggleCheck';

test.setTimeout(300000);

async function apiJson(page, apiPath) {
  const res = await page.request.get(checkApi(apiPath));
  expect(res.ok(), `${apiPath} -> ${res.status()}`).toBeTruthy();
  return res.json();
}

/** A play on live (not expired) game footage whose highlight Frame can load (playback-url 200). */
async function loadablePlay(page) {
  const games = await apiJson(page, '/games');
  const status = new Map((Array.isArray(games) ? games : games.games).map((g) => [g.id, g.storage_status]));
  const plays = (await apiJson(page, '/clips/raw'))
    .filter((c) => c.auto_project_id && status.get(c.game_id) !== 'expired');
  for (const play of plays) {
    const [clip] = await apiJson(page, `/clips/projects/${play.auto_project_id}/clips`);
    if (!clip) continue;
    const res = await page.request.get(checkApi(`/clips/projects/${play.auto_project_id}/clips/${clip.id}/playback-url`));
    if (res.ok()) return play;
  }
  throw new Error(`no play on live game footage that Frame can load among ${plays.length} plays`);
}

test.use({ viewport: { width: 1440, height: 900 } });

test('T17890:C1 - on a play whose stored cut list is {trimRange: null}, the T17860:C2 steps save the split and closing the track keeps the edits', async ({ context, page }) => {
  await loginForCheck(context);
  const source = await loadablePlay(page);
  // A new play inside the source play's range; a unique end time keeps the save from matching
  // an existing play (its idempotency key is game, end time and video part).
  const shift = 0.1 + (Date.now() % 50) / 100;
  const made = await page.request.post(checkApi('/clips/raw/save'), {
    data: {
      game_id: source.game_id,
      start_time: source.start_time + shift,
      end_time: Math.max(source.end_time - shift, source.start_time + shift + 2),
      ...(source.video_sequence != null ? { video_sequence: source.video_sequence } : {}),
      name: `T17890 partial cut list ${Date.now()}`,
      create_project: true,
    },
  });
  expect(made.ok(), `new play saved (HTTP ${made.status()})`).toBeTruthy();
  const { raw_clip_id: rawClipId, project_id: projectId, project_created: projectCreated } = await made.json();
  try {
    expect(projectCreated, 'the save made a new play, not an existing one').toBe(true);
    const [clip] = await apiJson(page, `/clips/projects/${projectId}/clips`);
    expect(clip.segments_data ?? null, 'a new play has no stored cut list').toBeNull();
    const cleared = await page.request.post(checkApi(`/clips/projects/${projectId}/clips/${clip.id}/actions`), {
      data: { action: 'clear_trim_range' },
    });
    expect(cleared.ok(), `clear_trim_range saved (HTTP ${cleared.status()})`).toBeTruthy();
    const [partial] = await apiJson(page, `/clips/projects/${projectId}/clips`);
    expect(partial.segments_data, 'the stored cut list is partial').toEqual({ trimRange: null });

    await closeKeepsEdits(page, `/focus/p/${projectId}`);
  } finally {
    const del = await page.request.delete(checkApi(`/clips/raw/${rawClipId}`));
    expect(del.ok() || del.status() === 404, `test play ${rawClipId} deleted (HTTP ${del.status()})`).toBeTruthy();
  }
});
