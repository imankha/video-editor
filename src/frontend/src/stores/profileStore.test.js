import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock sessionInit before importing profileStore
vi.mock('../utils/sessionInit', () => ({
  reinstallProfileHeader: vi.fn(),
  getProfileId: vi.fn(() => 'abc12345'),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock config
vi.mock('../config', () => ({
  API_BASE: '',
}));

describe('profileStore', () => {
  let useProfileStore;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();

    // Re-import to get fresh store
    const module = await import('./profileStore');
    useProfileStore = module.useProfileStore;

    // Reset store state
    useProfileStore.setState({
      profiles: [],
      currentProfileId: null,
      isLoading: false,
      isInitialized: false,
      error: null,
    });
  });

  describe('fetchProfiles', () => {
    it('fetches profiles from API and populates store', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          profiles: [
            { id: 'abc12345', name: 'Marcus', color: '#3B82F6', isDefault: true, isCurrent: true },
            { id: 'def67890', name: 'Jordan', color: '#10B981', isDefault: false, isCurrent: false },
          ]
        }),
      });

      await useProfileStore.getState().fetchProfiles();

      const state = useProfileStore.getState();
      expect(state.profiles).toHaveLength(2);
      expect(state.currentProfileId).toBe('abc12345');
      expect(state.isLoading).toBe(false);
      expect(state.isInitialized).toBe(true);
    });

    it('sets error on fetch failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await useProfileStore.getState().fetchProfiles();

      const state = useProfileStore.getState();
      expect(state.error).toBeTruthy();
      expect(state.isLoading).toBe(false);
    });
  });

  describe('switchProfile', () => {
    it('calls API and updates currentProfileId', async () => {
      // Set initial state with profiles
      useProfileStore.setState({
        profiles: [
          { id: 'abc12345', name: 'Marcus', isCurrent: true },
          { id: 'def67890', name: 'Jordan', isCurrent: false },
        ],
        currentProfileId: 'abc12345',
        isInitialized: true,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ profileId: 'def67890' }),
      });

      await useProfileStore.getState().switchProfile('def67890');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/profiles/current',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ profileId: 'def67890' }),
        }),
      );

      expect(useProfileStore.getState().currentProfileId).toBe('def67890');
    });

    it('calls reinstallProfileHeader with new profile ID', async () => {
      const { reinstallProfileHeader } = await import('../utils/sessionInit');

      useProfileStore.setState({
        profiles: [
          { id: 'abc12345', name: 'Marcus', isCurrent: true },
          { id: 'def67890', name: 'Jordan', isCurrent: false },
        ],
        currentProfileId: 'abc12345',
        isInitialized: true,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ profileId: 'def67890' }),
      });

      await useProfileStore.getState().switchProfile('def67890');

      expect(reinstallProfileHeader).toHaveBeenCalledWith('def67890');
    });
  });

  describe('createProfile', () => {
    it('calls API with name and color, returns new profile', async () => {
      useProfileStore.setState({
        profiles: [
          { id: 'abc12345', name: 'Marcus', color: '#3B82F6', isCurrent: true },
        ],
        currentProfileId: 'abc12345',
        isInitialized: true,
      });

      // Mock create response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'new12345', name: 'Jordan', color: '#10B981' }),
      });

      // Mock fetchProfiles after create
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          profiles: [
            { id: 'abc12345', name: 'Marcus', color: '#3B82F6', isDefault: true, isCurrent: false },
            { id: 'new12345', name: 'Jordan', color: '#10B981', isDefault: false, isCurrent: true },
          ]
        }),
      });

      // Mock switch response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ profileId: 'new12345' }),
      });

      await useProfileStore.getState().createProfile('Jordan', '#10B981');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/profiles',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Jordan', color: '#10B981' }),
        }),
      );
    });
  });

  describe('updateProfile', () => {
    it('calls API with updates and refreshes profiles', async () => {
      useProfileStore.setState({
        profiles: [
          { id: 'abc12345', name: 'Marcus', color: '#3B82F6', isCurrent: true },
        ],
        currentProfileId: 'abc12345',
        isInitialized: true,
      });

      // Mock update response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'abc12345', name: 'Marcus Jr.', color: '#EF4444' }),
      });

      // Mock fetchProfiles
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          profiles: [
            { id: 'abc12345', name: 'Marcus Jr.', color: '#EF4444', isDefault: true, isCurrent: true },
          ]
        }),
      });

      await useProfileStore.getState().updateProfile('abc12345', { name: 'Marcus Jr.', color: '#EF4444' });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/profiles/abc12345',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'Marcus Jr.', color: '#EF4444' }),
        }),
      );
    });
  });

  describe('deleteProfile', () => {
    it('calls DELETE API and refreshes profiles', async () => {
      useProfileStore.setState({
        profiles: [
          { id: 'abc12345', name: 'Marcus', color: '#3B82F6', isCurrent: true },
          { id: 'def67890', name: 'Jordan', color: '#10B981', isCurrent: false },
        ],
        currentProfileId: 'abc12345',
        isInitialized: true,
      });

      // Mock delete response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ deleted: 'def67890' }),
      });

      // Mock fetchProfiles
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          profiles: [
            { id: 'abc12345', name: 'Marcus', color: '#3B82F6', isDefault: true, isCurrent: true },
          ]
        }),
      });

      await useProfileStore.getState().deleteProfile('def67890');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/profiles/def67890',
        expect.objectContaining({ method: 'DELETE' }),
      );

      // Should have refetched and only have 1 profile now
      expect(useProfileStore.getState().profiles).toHaveLength(1);
    });
  });

  describe('computed helpers', () => {
    it('hasMultipleProfiles returns false for single profile', () => {
      useProfileStore.setState({
        profiles: [{ id: 'abc12345', name: 'Marcus' }],
      });
      expect(useProfileStore.getState().hasMultipleProfiles()).toBe(false);
    });

    it('hasMultipleProfiles returns true for 2+ profiles', () => {
      useProfileStore.setState({
        profiles: [
          { id: 'abc12345', name: 'Marcus' },
          { id: 'def67890', name: 'Jordan' },
        ],
      });
      expect(useProfileStore.getState().hasMultipleProfiles()).toBe(true);
    });

    it('currentProfile returns the profile matching currentProfileId', () => {
      useProfileStore.setState({
        profiles: [
          { id: 'abc12345', name: 'Marcus' },
          { id: 'def67890', name: 'Jordan' },
        ],
        currentProfileId: 'def67890',
      });
      expect(useProfileStore.getState().currentProfile()).toEqual(
        { id: 'def67890', name: 'Jordan' }
      );
    });
  });
});
