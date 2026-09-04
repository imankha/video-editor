import { describe, it, expect, beforeEach } from 'vitest';
import { usePublishIntentStore } from './publishIntentStore';

describe('publishIntentStore (T8390)', () => {
  beforeEach(() => {
    usePublishIntentStore.getState().clear();
  });

  it('defaults to no staked project', () => {
    expect(usePublishIntentStore.getState().projectId).toBeNull();
  });

  it('set() stakes a project id; clear() resets it', () => {
    usePublishIntentStore.getState().set(42);
    expect(usePublishIntentStore.getState().projectId).toBe(42);

    usePublishIntentStore.getState().clear();
    expect(usePublishIntentStore.getState().projectId).toBeNull();
  });
});
