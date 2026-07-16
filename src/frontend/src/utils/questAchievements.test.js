import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../stores/questStore', () => {
  const api = { recordAchievement: vi.fn() };
  const useQuestStore = () => api;
  useQuestStore.getState = () => api;
  return { useQuestStore };
});

import { useQuestStore } from '../stores/questStore';
import { maybeRecordRatedAndTagged } from './questAchievements';

describe('maybeRecordRatedAndTagged', () => {
  beforeEach(() => {
    useQuestStore.getState().recordAchievement.mockClear();
  });

  it('fires clip_rated once rating and tags are both present', () => {
    maybeRecordRatedAndTagged(4, ['assist']);
    expect(useQuestStore.getState().recordAchievement).toHaveBeenCalledWith('clip_rated');
  });

  it('does not fire when rating is missing', () => {
    maybeRecordRatedAndTagged(0, ['assist']);
    expect(useQuestStore.getState().recordAchievement).not.toHaveBeenCalled();
  });

  it('does not fire when tags are empty', () => {
    maybeRecordRatedAndTagged(5, []);
    expect(useQuestStore.getState().recordAchievement).not.toHaveBeenCalled();
  });

  it('does not fire when tags are undefined', () => {
    maybeRecordRatedAndTagged(5, undefined);
    expect(useQuestStore.getState().recordAchievement).not.toHaveBeenCalled();
  });
});
