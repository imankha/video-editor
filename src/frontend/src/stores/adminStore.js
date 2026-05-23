import { create } from 'zustand';
import { API_BASE } from '../config';
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
        totalUsers: data.total_users,
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
