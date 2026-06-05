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

  segmentOrigin: null,
  segmentFrom: null,
  segmentTo: null,
  userFilter: null,

  funnelData: null, funnelLoading: false,
  channelsData: null, channelsLoading: false,
  cohortsData: null, cohortsLoading: false,
  pulseData: null, pulseLoading: false,
  userDetailData: null, userDetailLoading: false, userDetailUserId: null,

  setSegmentFilter: (origin, from, to) => {
    set({ segmentOrigin: origin || null, segmentFrom: from || null, segmentTo: to || null });
    get().fetchUsers(1);
    get().fetchPulse();
  },

  setUserFilter: (filter) => {
    set({ userFilter: filter || null });
    get().fetchUsers(1);
    get().fetchPulse();
  },

  clearSegmentFilter: () => {
    set({ segmentOrigin: null, segmentFrom: null, segmentTo: null, userFilter: null });
    get().fetchUsers(1);
    get().fetchPulse();
  },

  fetchUsers: async (page, pageSize) => {
    const state = get();
    const p = page ?? state.currentPage;
    const ps = pageSize ?? state.pageSize;

    set({ usersLoading: true, usersError: null });
    try {
      const params = new URLSearchParams({ page: p, page_size: ps });
      if (state.segmentOrigin) params.set('origin', state.segmentOrigin);
      if (state.segmentFrom) params.set('acquired_from', state.segmentFrom);
      if (state.segmentTo) params.set('acquired_to', state.segmentTo);
      if (state.userFilter) params.set('filter', state.userFilter);
      const res = await apiFetch(`${API_BASE}/api/admin/users?${params}`);
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
    const state = get();
    set({ pulseLoading: true });
    try {
      const params = new URLSearchParams({ days });
      if (state.segmentOrigin) params.set('origin', state.segmentOrigin);
      if (state.segmentFrom) params.set('acquired_from', state.segmentFrom);
      if (state.segmentTo) params.set('acquired_to', state.segmentTo);
      if (state.userFilter) params.set('filter', state.userFilter);
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/pulse?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set({ pulseData: await res.json(), pulseLoading: false });
    } catch { set({ pulseLoading: false }); }
  },

  fetchUserDetail: async (userId) => {
    set({ userDetailLoading: true, userDetailUserId: userId });
    try {
      const [journeyRes, actionsRes] = await Promise.all([
        apiFetch(`${API_BASE}/api/admin/analytics/journey/${userId}`),
        apiFetch(`${API_BASE}/api/admin/analytics/user/${userId}/actions?page_size=200`),
      ]);
      if (!journeyRes.ok || !actionsRes.ok) throw new Error('Failed to fetch user detail');
      const journey = await journeyRes.json();
      const actions = await actionsRes.json();
      set({ userDetailData: { ...journey, actionLog: actions.actions }, userDetailLoading: false });
    } catch { set({ userDetailLoading: false }); }
  },

  clearUserDetail: () => set({ userDetailData: null, userDetailUserId: null }),

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
