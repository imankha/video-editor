import { create } from 'zustand';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { useCreditStore } from './creditStore';

export const useAdminStore = create((set, get) => ({
  users: [],
  usersLoading: false,
  usersError: null,

  currentPage: 1,
  totalPages: 1,
  totalUsers: 0,
  pageSize: 10,

  grantState: {},
  funnelTotals: null,

  funnelData: null, funnelLoading: false,
  channelsData: null, channelsLoading: false,
  cohortsData: null, cohortsLoading: false,
  pulseData: null, pulseLoading: false,
  journeyData: null, journeyLoading: false, journeyUserId: null,

  fetchUsers: async (page, pageSize) => {
    const state = get();
    const p = page ?? state.currentPage;
    const ps = pageSize ?? state.pageSize;

    set({ usersLoading: true, usersError: null });
    try {
      const res = await apiFetch(
        `${API_BASE}/api/admin/users?page=${p}&page_size=${ps}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({
        users: data.users,
        currentPage: data.page,
        totalPages: data.total_pages,
        totalUsers: data.total_users,
        pageSize: data.page_size,
        funnelTotals: data.funnel_totals || null,
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

  grantCredits: async (userId, amount) => {
    set(state => ({
      grantState: { ...state.grantState, [userId]: { loading: true, error: null } },
    }));
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/users/${userId}/grant-credits`, {
        method: 'POST',
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
      useCreditStore.getState().fetchCredits();
      return balance;
    } catch (err) {
      set(state => ({
        grantState: { ...state.grantState, [userId]: { loading: false, error: err.message } },
      }));
      throw err;
    }
  },

  fetchFunnel: async (from, to, origin = 'all') => {
    set({ funnelLoading: true });
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (origin) params.set('origin', origin);
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/funnel?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set({ funnelData: await res.json(), funnelLoading: false });
    } catch { set({ funnelLoading: false }); }
  },

  fetchChannels: async (from, to) => {
    set({ channelsLoading: true });
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/channels?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set({ channelsData: await res.json(), channelsLoading: false });
    } catch { set({ channelsLoading: false }); }
  },

  fetchCohorts: async (granularity = 'week', origin = 'all') => {
    set({ cohortsLoading: true });
    try {
      const params = new URLSearchParams({ granularity, origin });
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/cohorts?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set({ cohortsData: await res.json(), cohortsLoading: false });
    } catch { set({ cohortsLoading: false }); }
  },

  fetchPulse: async (days = 30) => {
    set({ pulseLoading: true });
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/pulse?days=${days}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set({ pulseData: await res.json(), pulseLoading: false });
    } catch { set({ pulseLoading: false }); }
  },

  fetchJourney: async (userId) => {
    set({ journeyLoading: true, journeyUserId: userId });
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/journey/${userId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set({ journeyData: await res.json(), journeyLoading: false });
    } catch { set({ journeyLoading: false }); }
  },

  clearJourney: () => set({ journeyData: null, journeyUserId: null }),

  setCredits: async (userId, amount) => {
    set(state => ({
      grantState: { ...state.grantState, [userId]: { loading: true, error: null } },
    }));
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/users/${userId}/set-credits`, {
        method: 'POST',
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
