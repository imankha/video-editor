import { describe, it, expect, vi, beforeEach } from 'vitest';

// apiFetch is the single network seam for the store.
vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('../config', () => ({ API_BASE: '' }));
vi.mock('./creditStore', () => ({
  useCreditStore: { getState: () => ({ setBalance: vi.fn() }) },
}));
vi.mock('../utils/analytics', () => ({ track: vi.fn() }));

import apiFetch from '../utils/apiFetch';
import { useQuestStore } from './questStore';

const ALL_STEP_IDS = useQuestStore
  .getState()
  .definitions.flatMap((q) => q.step_ids);

/** Build a full progress payload with a specific set of steps flipped true. */
function progressPayload(trueSteps = []) {
  const truthy = new Set(trueSteps);
  return {
    quests: useQuestStore.getState().definitions.map((q) => ({
      id: q.id,
      steps: Object.fromEntries(q.step_ids.map((sid) => [sid, truthy.has(sid)])),
      completed: false,
      reward_claimed: false,
    })),
  };
}

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

describe('questStore.recordAchievement (T6270)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    useQuestStore.getState().reset();
  });

  it('consumes progress from the POST body without a follow-up GET', async () => {
    apiFetch.mockResolvedValueOnce(
      jsonResponse({
        key: 'opened_framing_editor',
        achieved_at: '2026-08-28T00:00:00Z',
        progress: progressPayload(['open_framing']),
      }),
    );

    useQuestStore.getState().recordAchievement('opened_framing_editor');
    // Let the fire-and-forget .then chain settle.
    await new Promise((r) => setTimeout(r, 0));

    // Exactly one network call — the POST. No GET /quests/progress chaser.
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = apiFetch.mock.calls[0];
    expect(url).toContain('/api/quests/achievements/opened_framing_editor');
    expect(opts.method).toBe('POST');

    // Store reflects the POST-embedded progress.
    const state = useQuestStore.getState();
    expect(state.loaded).toBe(true);
    const q2 = state.quests.find((q) => q.id === 'quest_2');
    expect(q2.steps.open_framing).toBe(true);
    expect(state.totalCompleted).toBe(1);
  });

  it('falls back to a GET when the POST omits progress (deploy skew)', async () => {
    // First call = POST (old backend, no progress). Second = fallback GET.
    apiFetch
      .mockResolvedValueOnce(
        jsonResponse({ key: 'opened_overlay_editor', achieved_at: '2026-08-28T00:00:00Z' }),
      )
      .mockResolvedValueOnce(jsonResponse(progressPayload(['open_overlay'])));

    useQuestStore.getState().recordAchievement('opened_overlay_editor');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch.mock.calls[1][0]).toContain('/api/quests/progress');
    const q3 = useQuestStore.getState().quests.find((q) => q.id === 'quest_3');
    expect(q3.steps.open_overlay).toBe(true);
  });

  it('re-arms dedup on a failed POST so a retry can fire', async () => {
    apiFetch.mockResolvedValueOnce(jsonResponse({}, false));

    useQuestStore.getState().recordAchievement('opened_framing_editor');
    await new Promise((r) => setTimeout(r, 0));

    // A successful retry should now be allowed (dedup was cleared on failure).
    apiFetch.mockResolvedValueOnce(
      jsonResponse({
        key: 'opened_framing_editor',
        achieved_at: '2026-08-28T00:00:00Z',
        progress: progressPayload(['open_framing']),
      }),
    );
    useQuestStore.getState().recordAchievement('opened_framing_editor');
    await new Promise((r) => setTimeout(r, 0));

    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('dedups repeat achievements within a session', () => {
    apiFetch.mockResolvedValue(
      jsonResponse({ key: 'k', achieved_at: 'x', progress: progressPayload() }),
    );
    useQuestStore.getState().recordAchievement('crop_adjusted');
    useQuestStore.getState().recordAchievement('crop_adjusted');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});

// Guards the assumption that step ids are non-empty (payload builder relies on it).
describe('questStore definitions', () => {
  it('exposes step ids', () => {
    expect(ALL_STEP_IDS.length).toBeGreaterThan(0);
  });
});
