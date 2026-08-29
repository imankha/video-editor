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
  bulkActionLoading: false,
  funnelTotals: null,

  segmentOrigin: null,
  segmentFrom: null,
  segmentTo: null,
  userFilter: null,

  funnelData: null, funnelLoading: false,
  shareFunnelData: null, shareFunnelLoading: false,
  channelsData: null, channelsLoading: false,
  cohortsData: null, cohortsLoading: false,
  pulseData: null, pulseLoading: false,
  platformsData: null, platformsLoading: false,
  userDetailData: null, userDetailLoading: false, userDetailUserId: null,

  // T5760: Stripe revenue reconciliation (on-demand — never auto-fetched, Stripe latency)
  reconciliationData: null, reconciliationLoading: false, reconciliationError: null,

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

  // T8020: one round-trip for the whole admin dashboard on mount. Fans the combined
  // GET /api/admin/dashboard response out into the SAME state fields the 5 individual
  // actions populate, so downstream components don't change. The individual actions
  // (fetchUsers/fetchPulse/...) stay for their other callers (pagination, campaign
  // click-through). Mirrors fetchUsers' exact users->state field mapping.
  fetchDashboard: async () => {
    set({
      usersLoading: true, usersError: null,
      pulseLoading: true, channelsLoading: true,
      cohortsLoading: true, platformsLoading: true,
    });
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/dashboard`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({
        users: data.users.users,
        currentPage: data.users.page,
        totalPages: data.users.total_pages,
        totalUsers: data.users.total_users,
        pageSize: data.users.page_size,
        funnelTotals: data.users.funnel_totals || null,
        pulseData: data.pulse,
        channelsData: data.channels,
        cohortsData: data.cohorts,
        platformsData: data.platforms,
        usersLoading: false, pulseLoading: false, channelsLoading: false,
        cohortsLoading: false, platformsLoading: false,
      });
    } catch (err) {
      set({
        usersError: err.message,
        usersLoading: false, pulseLoading: false, channelsLoading: false,
        cohortsLoading: false, platformsLoading: false,
      });
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

  // T5840: requestId is minted by the CALLER (CreditGrantModal) once per grant
  // attempt and reused across a retry of that SAME click -- that's what makes
  // the retry idempotent server-side (admin:{admin}:{requestId} key). A new
  // click (new attempt) gets a new id.
  grantCredits: async (userId, amount, requestId) => {
    set(state => ({
      grantState: { ...state.grantState, [userId]: { loading: true, error: null } },
    }));
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/users/${userId}/grant-credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, request_id: requestId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const { balance, applied } = await res.json();
      set(state => ({
        grantState: { ...state.grantState, [userId]: { loading: false, error: null } },
        users: state.users.map(u =>
          u.user_id === userId ? { ...u, credits: balance } : u
        ),
      }));
      useCreditStore.getState().fetchCredits();
      return { balance, applied };
    } catch (err) {
      set(state => ({
        grantState: { ...state.grantState, [userId]: { loading: false, error: err.message } },
      }));
      throw err;
    }
  },

  // T4860: bulk grant credits. Follows grantCredits shape but patches every
  // successfully-granted user's balance from the per-user results array.
  // T5840: batchId is minted once per bulk attempt (see grantCredits above).
  bulkGrantCredits: async (userIds, amount, batchId) => {
    set({ bulkActionLoading: true });
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/users/bulk/grant-credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ids: userIds, amount, batch_id: batchId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const balanceById = {};
      for (const r of data.results) {
        if (r.ok) balanceById[r.user_id] = r.balance;
      }
      set(state => ({
        bulkActionLoading: false,
        users: state.users.map(u =>
          Object.prototype.hasOwnProperty.call(balanceById, u.user_id)
            ? { ...u, credits: balanceById[u.user_id] }
            : u
        ),
      }));
      useCreditStore.getState().fetchCredits();
      return data;
    } catch (err) {
      set({ bulkActionLoading: false });
      throw err;
    }
  },

  // T4860: send an update email to many users (or a single test to the caller).
  sendBulkEmail: async (userIds, subject, body, { test = false } = {}) => {
    set({ bulkActionLoading: true });
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/users/bulk/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ids: userIds, subject, body, test }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      set({ bulkActionLoading: false });
      return data;
    } catch (err) {
      set({ bulkActionLoading: false });
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

  fetchShareFunnel: async () => {
    set({ shareFunnelLoading: true });
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/share-funnel`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set({ shareFunnelData: await res.json(), shareFunnelLoading: false });
    } catch { set({ shareFunnelLoading: false }); }
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

  fetchPlatforms: async () => {
    set({ platformsLoading: true });
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/platforms`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set({ platformsData: await res.json(), platformsLoading: false });
    } catch { set({ platformsLoading: false }); }
  },

  fetchUserDetail: async (userId) => {
    set({ userDetailLoading: true, userDetailUserId: userId });
    try {
      const [journeyRes, actionsRes, phasesRes] = await Promise.all([
        apiFetch(`${API_BASE}/api/admin/analytics/journey/${userId}`),
        apiFetch(`${API_BASE}/api/admin/analytics/user/${userId}/actions?page_size=200`),
        // T7860: clip/reel lifecycle-phase inventory (best-effort — the panel
        // renders without it if this read fails, so it never blocks the journey).
        apiFetch(`${API_BASE}/api/admin/analytics/user/${userId}/clip-phases`),
      ]);
      if (!journeyRes.ok || !actionsRes.ok) throw new Error('Failed to fetch user detail');
      const journey = await journeyRes.json();
      const actions = await actionsRes.json();
      const clipPhases = phasesRes.ok ? await phasesRes.json() : null;
      set({ userDetailData: { ...journey, actionLog: actions.actions, clipPhases }, userDetailLoading: false });
    } catch { set({ userDetailLoading: false }); }
  },

  clearUserDetail: () => set({ userDetailData: null, userDetailUserId: null }),

  // T5760: run the on-demand reconciliation pass (compares local total_spent_cents
  // against per-user Stripe NET revenue). Explicit gesture — this hits Stripe, so it
  // is never fired on the main user-table load path.
  fetchReconciliation: async () => {
    set({ reconciliationLoading: true, reconciliationError: null });
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/revenue-reconciliation`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      set({ reconciliationData: await res.json(), reconciliationLoading: false });
    } catch (err) {
      set({ reconciliationLoading: false, reconciliationError: err.message });
    }
  },

  // T5760: adopt the Stripe net figure into total_spent_cents. Explicit admin
  // gesture (per-user or all-drifted); re-runs the report afterward so drift clears.
  healReconciliation: async ({ userIds = null, allDrifted = false } = {}) => {
    set({ reconciliationLoading: true, reconciliationError: null });
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/revenue-reconciliation/heal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ids: userIds, all_drifted: allDrifted }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      await get().fetchReconciliation();
      return data;
    } catch (err) {
      set({ reconciliationLoading: false, reconciliationError: err.message });
      throw err;
    }
  },

  setCredits: async (userId, amount, requestId) => {
    set(state => ({
      grantState: { ...state.grantState, [userId]: { loading: true, error: null } },
    }));
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/users/${userId}/set-credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, request_id: requestId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const { balance, applied } = await res.json();
      set(state => ({
        grantState: { ...state.grantState, [userId]: { loading: false, error: null } },
        users: state.users.map(u =>
          u.user_id === userId ? { ...u, credits: balance } : u
        ),
      }));
      useCreditStore.getState().fetchCredits();
      return { balance, applied };
    } catch (err) {
      set(state => ({
        grantState: { ...state.grantState, [userId]: { loading: false, error: err.message } },
      }));
      throw err;
    }
  },
}));
