import { create } from 'zustand';
import { API_BASE } from '../config';
import { useCreditStore } from './creditStore';

/**
 * Admin Store — manages admin panel data (T550, T1590).
 *
 * T1590: Paginated fetch with profile-centric response.
 * Stats are per-profile, credits are per-user.
 */
export const useAdminStore = create((set, get) => ({
  users: [],
  usersLoading: false,
  usersError: null,

  // Pagination state
  currentPage: 1,
  totalPages: 1,
  totalProfiles: 0,
  pageSize: 10,

  // GPU drilldown: { [userId]: { data, loading, error } }
  gpuUsage: {},

  // Credit grant state: { [userId]: { loading, error } }
  grantState: {},

  fetchUsers: async (page, pageSize) => {
    const state = get();
    const p = page ?? state.currentPage;
    const ps = pageSize ?? state.pageSize;

    set({ usersLoading: true, usersError: null });
    try {
      const res = await fetch(
        `${API_BASE}/api/admin/users?page=${p}&page_size=${ps}`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({
        users: data.users,
        currentPage: data.page,
        totalPages: data.total_pages,
        totalProfiles: data.total_profiles,
        pageSize: data.page_size,
        usersLoading: false,
      });
    } catch (err) {
      set({ usersLoading: false, usersError: err.message });
    }
  },

  nextPage: () => {
    const { currentPage, totalPages, fetchUsers } = get();
    if (currentPage < totalPages) fetchUsers(currentPage + 1);
  },

  prevPage: () => {
    const { currentPage, fetchUsers } = get();
    if (currentPage > 1) fetchUsers(currentPage - 1);
  },

  fetchGpuUsage: async (userId, profileId) => {
    set(state => ({
      gpuUsage: { ...state.gpuUsage, [userId]: { data: null, loading: true, error: null } },
    }));
    try {
      const params = profileId ? `?profile_id=${profileId}` : '';
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}/gpu-usage${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set(state => ({
        gpuUsage: { ...state.gpuUsage, [userId]: { data, loading: false, error: null } },
      }));
    } catch (err) {
      set(state => ({
        gpuUsage: { ...state.gpuUsage, [userId]: { data: null, loading: false, error: err.message } },
      }));
    }
  },

  grantCredits: async (userId, amount) => {
    set(state => ({
      grantState: { ...state.grantState, [userId]: { loading: true, error: null } },
    }));
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}/grant-credits`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const { balance } = await res.json();
      // Update the user's credit balance in the users list
      set(state => ({
        grantState: { ...state.grantState, [userId]: { loading: false, error: null } },
        users: state.users.map(u =>
          u.user_id === userId ? { ...u, credits: balance } : u
        ),
      }));
      // Refresh current user's credit store in case admin changed their own balance
      useCreditStore.getState().fetchCredits();
      return balance;
    } catch (err) {
      set(state => ({
        grantState: { ...state.grantState, [userId]: { loading: false, error: err.message } },
      }));
      throw err;
    }
  },

  setCredits: async (userId, amount) => {
    set(state => ({
      grantState: { ...state.grantState, [userId]: { loading: true, error: null } },
    }));
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}/set-credits`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const { balance } = await res.json();
      set(state => ({
        grantState: { ...state.grantState, [userId]: { loading: false, error: null } },
        users: state.users.map(u =>
          u.user_id === userId ? { ...u, credits: balance } : u
        ),
      }));
      // Refresh current user's credit store in case admin changed their own balance
      useCreditStore.getState().fetchCredits();
      return balance;
    } catch (err) {
      set(state => ({
        grantState: { ...state.grantState, [userId]: { loading: false, error: err.message } },
      }));
      throw err;
    }
  },
}));
