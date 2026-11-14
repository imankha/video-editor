import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// T11175: the engagement events that rode the quest achievements POST now travel
// through the funnel transport under their milestone names, deduped per session.
vi.mock('../config', () => ({ API_BASE: 'https://api.test' }));
const apiFetchMock = vi.fn(() => Promise.resolve({ ok: true }));
vi.mock('./apiFetch', () => ({ default: (...a) => apiFetchMock(...a) }));
vi.mock('../stores/authStore.js', () => ({
  useAuthStore: { getState: () => ({ impersonator: null }) },
}));

import { recordFunnelEvent, resetFunnelEventSession, FUNNEL_EVENTS } from './funnelEvents';

// Milestone names exactly as quests.py ACHIEVEMENT_TO_MILESTONE stored them, so the
// admin Journey history stays continuous across the transport change.
const REROUTED_MILESTONES = [
  'add_game_opened', 'upload_file_selected', 'add_clip_opened',
  'framing_opened', 'overlay_opened',
  'gallery_viewed', 'custom_project_viewed', 'gallery_watched_1s', 'annotations_played',
  'crop_adjusted', 'speed_segment_created',
  'overlay_players_assigned', 'overlay_color_set', 'overlay_shape_set',
  'overlay_offered', 'overlay_deferred', 'overlay_declined',
  'previewed_draft_reel_1s',
  'watched_annotate_tutorial', 'watched_framing_tutorial',
  'watched_overlay_tutorial', 'watched_publish_tutorial',
];

const posted = () => apiFetchMock.mock.calls.map(([url, opts]) => {
  expect(url).toBe('https://api.test/api/telemetry/funnel-event');
  return JSON.parse(opts.body).event;
});

beforeEach(() => {
  apiFetchMock.mockClear();
  resetFunnelEventSession();
});

describe('T11175 rerouted engagement events', () => {
  it('every rerouted milestone is in the client vocabulary and reaches the funnel endpoint', () => {
    const vocabulary = new Set(Object.values(FUNNEL_EVENTS));
    for (const name of REROUTED_MILESTONES) {
      expect(vocabulary.has(name), name).toBe(true);
      recordFunnelEvent(name);
    }
    expect(posted()).toEqual(REROUTED_MILESTONES);
  });

  it('crop_adjusted is sent once per session, not once per drag', () => {
    for (let i = 0; i < 5; i++) recordFunnelEvent(FUNNEL_EVENTS.CROP_ADJUSTED, { clip_id: 'c1' });
    expect(posted()).toEqual(['crop_adjusted']);
    resetFunnelEventSession(); // profile switch starts a new session
    recordFunnelEvent(FUNNEL_EVENTS.CROP_ADJUSTED);
    expect(posted()).toEqual(['crop_adjusted', 'crop_adjusted']);
  });

  it('repeatable T10010 events are still sent every time', () => {
    recordFunnelEvent(FUNNEL_EVENTS.FRAMING_POINT_ADDED);
    recordFunnelEvent(FUNNEL_EVENTS.FRAMING_POINT_ADDED);
    expect(posted()).toEqual(['framing_point_added', 'framing_point_added']);
  });

  it('the crop drag handler fires crop_adjusted through the funnel transport', () => {
    const src = readFileSync(resolve(__dirname, '../containers/FocusContainer.jsx'), 'utf8');
    expect(src).toContain('recordFunnelEvent(FUNNEL_EVENTS.CROP_ADJUSTED');
  });

  it('no production code records a quest achievement any more', () => {
    const out = execSync(
      "git grep -n 'recordAchievement(' -- 'src/**/*.js' 'src/**/*.jsx' ':!*.test.*' ':!src/stores/questStore.js' || true",
      { cwd: resolve(__dirname, '../..'), encoding: 'utf8' },
    );
    expect(out.trim()).toBe('');
  });
});
