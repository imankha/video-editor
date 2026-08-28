import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('../../utils/sessionInit', () => ({ reinstallProfileHeader: vi.fn() }));

import apiFetch from '../../utils/apiFetch';
import { useProfileStore } from '../profileStore';

// T7922: updateProfile optimistically patches the local profile so the Add Clip
// tag picker swaps to real tags the instant a sport is picked (no PUT+refetch
// lag), then reconciles with the server via fetchProfiles. On PUT failure it
// rolls the optimistic patch back (founder-approved).

const okJson = (body) => ({ ok: true, json: async () => body });

beforeEach(() => {
  vi.clearAllMocks();
  useProfileStore.setState({
    profiles: [{ id: 'p1', name: 'Alex', sport: 'no_sport', isCurrent: true }],
    currentProfileId: 'p1',
    error: null,
  });
});

describe('profileStore.updateProfile — optimistic sport patch (T7922)', () => {
  it('patches the local profile synchronously, before the network resolves', async () => {
    // PUT ok, then the reconciling GET returns the server-confirmed sport.
    apiFetch
      .mockResolvedValueOnce(okJson({})) // PUT /api/profiles/p1
      .mockResolvedValueOnce(okJson({ profiles: [{ id: 'p1', name: 'Alex', sport: 'soccer', isCurrent: true }] })); // GET refetch

    const promise = useProfileStore.getState().updateProfile('p1', { sport: 'soccer' });

    // Optimistic: reflected BEFORE awaiting the PUT/refetch.
    expect(useProfileStore.getState().profiles[0].sport).toBe('soccer');

    await promise;
    // Reconciled with the server (still soccer).
    expect(useProfileStore.getState().profiles[0].sport).toBe('soccer');
  });

  it('rolls the optimistic patch back when the PUT fails', async () => {
    apiFetch.mockResolvedValueOnce({ ok: false, status: 500 }); // PUT fails

    await expect(
      useProfileStore.getState().updateProfile('p1', { sport: 'soccer' })
    ).rejects.toThrow();

    // Rolled back to the pre-gesture sport.
    expect(useProfileStore.getState().profiles[0].sport).toBe('no_sport');
  });
});
