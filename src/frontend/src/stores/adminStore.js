import { create } from 'zustand';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { useCreditStore } from './creditStore';

// T14010/T14020: query string shared by the Journey map and the step inspector.
// filters = { from, to, origin, build, country, sport, platform, excludeTest, windowDays, inactiveDays }.
function journeyParams(filters) {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.origin) params.set('origin', filters.origin);
  if (filters.build != null) params.set('build', filters.build);
  if (filters.country) params.set('country', filters.country);
  // T14930: arrival sport (landing page) -- same known-key/unknown predicate as country.
  if (filters.sport) params.set('sport', filters.sport);
  if (filters.platform) params.set('platform', filters.platform);
  if (filters.excludeTest !== undefined) params.set('exclude_test', String(filters.excludeTest));
  if (filters.windowDays) params.set('window_days', filters.windowDays);
  if (filters.inactiveDays) params.set('inactive_days', filters.inactiveDays);
  return params;
}
let stepRequestKey = null;
// T14740: a Journey-filtered list is slower than a plain one, so an older response can land
// last. Only the newest fetchUsers call may write the list.
let usersRequestId = 0;
let channelsRequestId = 0;
// T15100: a country change reloads these while an older load can still be in flight.
let cohortsRequestId = 0;
let buildsRequestId = 0;
let countriesRequestId = 0;

// T14910 request ordering (module state, not store state: nothing renders it). Sequence
// numbers mark the newest spend-readiness read and the newest Diagnose read per gate; the epoch
// advances on every spend-readiness read so Diagnose responses from before it are dropped.
let spendReadinessSeq = 0;
let spendDiagnosisSeq = 0;
let spendDiagnosisEpoch = 0;
const spendDiagnosisLatest = {};

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
  // T14000: the Builds dimension's row selection (user_segments.signup_build), sent as `build`.
  segmentBuild: null,
  // T15100: standing filter from the Country selector or a Channels country row. Row picks
  // compose with it; only Clear all drops it. 'unknown' = no country on the segment.
  segmentCountry: null,
  countries: [],  // the selector's options for the current window
  // T14930: arrival sport (landing page) global filter, same shape/rules as segmentCountry
  // ('unknown' = an ad's own utm_content OR none at all; never inferred).
  segmentSport: null,
  // T13990: which filter dimension's table the panel shows ('campaigns' | 'cohorts' |
  // 'builds'). View state only -- resets to campaigns on reload, never persisted.
  dimension: 'campaigns',
  userFilter: null,
  // T14740: Journey drop-off listed in Users, or null. View state, never persisted:
  // { stages, label, outcome, count, platform, windowDays, inactiveDays }. The signup, campaign,
  // build and Real filters the Journey also uses stay in the fields above; anything that
  // changes them clears this, so it always matches the number clicked.
  journeyUserFilter: null,

  // T8110: server-side global sort + test-account exclusion. sortKey/sortDir
  // drive GET /api/admin/users ORDER BY (the whole DB, not the page). excludeTest
  // is the "Real" pill -- default ON so the panel opens on real users. All three
  // are ephemeral UI state, never persisted (no-persisted-view-state rule).
  sortKey: 'last_active_at',
  sortDir: 'desc',
  excludeTest: true,

  // T14010: Journey map (replaces the Funnel sub-tab's fetch). Filters live in JourneyTab.
  journeyData: null, journeyLoading: false, journeyError: null,
  // T14020: step inspector payload for the selected stage (view-state read, never persisted).
  journeyStep: null, journeyStepLoading: false, journeyStepError: null,
  journeyRollup: { running: false, error: null, result: null },
  // T14910: Spend readiness panel (Journey tab). Read on mount and on the Refresh gesture;
  // one Diagnose entry per gate key, loaded when its drawer opens. Never written back.
  spendReadiness: null, spendReadinessLoading: false, spendReadinessError: null,
  // T14920: the build-time roadmap export (public/roadmap.json), read on the Journey tab's mount.
  roadmap: null, roadmapLoading: false, roadmapError: null,
  spendGateDiagnosis: {},
  channelsData: null, channelsLoading: false, channelsBy: 'origin',
  campaigns: null, campaignsLoading: false, campaignsError: null,
  cohortsData: null, cohortsLoading: false,
  buildsData: null, buildsLoading: false,
  pulseData: null, pulseLoading: false,
  platformsData: null, platformsLoading: false,
  userDetailData: null, userDetailLoading: false, userDetailUserId: null,

  // T5760: Stripe revenue reconciliation (on-demand — never auto-fetched, Stripe latency)
  // T8640: reconciliationHealResults maps user_id -> the last heal outcome for that
  // row ({ healed, skipped }), so the panel can surface a heal that did NOT succeed
  // instead of silently refreshing.
  reconciliationData: null, reconciliationLoading: false, reconciliationError: null,
  reconciliationHealResults: {},

  // T10270: upload-failures drill-down (on-demand — deliberately NOT part of
  // fetchDashboard's combined mount request; AdminScreen.test.jsx asserts
  // exactly one mount request for that endpoint).
  uploadFailuresData: null, uploadFailuresLoading: false, uploadFailuresError: null,
  packMixData: null, packMixLoading: false, packMixError: null,
  // T13931: R2 usage by source (on-demand -- never on mount; the backend caches 10 min).
  r2UsageData: null, r2UsageLoading: false, r2UsageError: null,

  // T14000: `build` is the 4th dimension value; omitting it clears the build, so a
  // campaign/cohort pick replaces a build pick. The platform breakdown follows the build
  // only, so it refetches only when the build changes.
  setSegmentFilter: (origin, from, to, build = null) => {
    const buildChanged = get().segmentBuild !== build;
    const windowChanged = get().segmentFrom !== (from || null) || get().segmentTo !== (to || null);
    set({ segmentOrigin: origin || null, segmentFrom: from || null, segmentTo: to || null, segmentBuild: build, journeyUserFilter: null });
    get().fetchUsers(1);
    get().fetchPulse();
    if (buildChanged) get().fetchPlatforms();
    if (windowChanged) get().fetchCountries();
  },

  // T15100: the dimension tables follow the country, so they reload with the rest. A builds
  // table not opened yet loads on its pill click. JourneyTab re-reads from its own filters.
  setSegmentCountry: (country) => {
    set({ segmentCountry: country, journeyUserFilter: null });
    const state = get();
    state.fetchUsers(1);
    state.fetchPulse();
    state.fetchChannels();
    state.fetchCohorts();
    if (state.buildsData) state.fetchBuilds();
  },

  // T14930: unlike country, sport has no Channels/Cohorts/Builds breakdown dependency yet
  // (T14940/T14950 are siblings) -- only the users list follows it directly here.
  setSegmentSport: (sport) => {
    set({ segmentSport: sport, journeyUserFilter: null });
    get().fetchUsers(1);
  },

  // T13990: pill click. Shows that dimension's table and loads its data if the
  // dashboard mount fetch didn't (or failed to). The current row selection stays.
  setDimension: (dimension) => {
    set({ dimension });
    const state = get();
    if (dimension === 'campaigns' && !state.channelsData && !state.channelsLoading) {
      state.fetchChannels();
    } else if (dimension === 'cohorts' && !state.cohortsData && !state.cohortsLoading) {
      state.fetchCohorts();
    } else if (dimension === 'builds' && !state.buildsData && !state.buildsLoading) {
      state.fetchBuilds();
    }
  },

  setUserFilter: (filter) => {
    set({ userFilter: filter || null, journeyUserFilter: null });
    get().fetchUsers(1);
    get().fetchPulse();
  },

  // T14740: exclusive with userFilter, like the pills are with each other. The pulse follows
  // userFilter only, so it refetches only when this click cleared a pill. Resolves once the
  // list has landed, so the caller can scroll to its final height.
  setJourneyUserFilter: (journeyUserFilter) => {
    const hadUserFilter = get().userFilter !== null;
    set({ journeyUserFilter, userFilter: null });
    if (hadUserFilter) get().fetchPulse();
    return get().fetchUsers(1);
  },

  clearJourneyUserFilter: () => {
    if (get().journeyUserFilter === null) return;
    set({ journeyUserFilter: null });
    get().fetchUsers(1);
  },

  // T8110: header click -> server sort. Same key toggles direction; a new key
  // starts descending (the common "who's on top" read). Refetches page 1 so the
  // global ordering restarts from the true max/min. Single source of truth for
  // ordering = the server (UserTable no longer sorts locally).
  setSort: (key) => {
    const { sortKey, sortDir } = get();
    const nextDir = sortKey === key ? (sortDir === 'desc' ? 'asc' : 'desc') : 'desc';
    set({ sortKey: key, sortDir: nextDir });
    get().fetchUsers(1);
  },

  // T8110: the "Real" pill. Toggles INDEPENDENTLY of the exclusive userFilter
  // pills (composes -- Real + Paying = real paying users). Refetches page 1 + the
  // pulse, the same way setUserFilter does, so the funnel/aggregates track it.
  setExcludeTest: (excludeTest) => {
    set({ excludeTest: !!excludeTest, journeyUserFilter: null });
    get().fetchUsers(1);
    get().fetchPulse();
    get().fetchCountries();
  },

  // T8110: mark/unmark a user as an internal test account (gesture-based DB
  // write). Patches the row's flag in place so the badge updates immediately; the
  // change survives a reload because it is a DB column, not view state.
  markTestAccount: async (userId, isTest) => {
    const res = await apiFetch(`${API_BASE}/api/admin/users/${userId}/test-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_test: isTest }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    set(state => ({
      users: state.users.map(u =>
        u.user_id === userId ? { ...u, is_test_account: isTest } : u
      ),
    }));
    return res.json();
  },

  // Admin "reset data" button, is_test_account rows only (server
  // rejects any other user_id with 403). Clears clips/projects/exports per
  // profile; keeps the login, profile identity, credits, and games -- the
  // funnel/usage columns in this table are untouched (Postgres analytics,
  // not SQLite project data), so this never changes what a row displays.
  resetTestAccountData: async (userId) => {
    const res = await apiFetch(`${API_BASE}/api/admin/users/${userId}/reset-data`, {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  },

  clearSegmentFilter: () => {
    const hadBuild = get().segmentBuild !== null;
    const hadCountry = get().segmentCountry !== null;
    const hadWindow = get().segmentFrom !== null || get().segmentTo !== null;
    set({ segmentOrigin: null, segmentFrom: null, segmentTo: null, segmentBuild: null, segmentCountry: null, segmentSport: null, userFilter: null, journeyUserFilter: null });
    get().fetchUsers(1);
    get().fetchPulse();
    if (hadBuild) get().fetchPlatforms();
    if (hadWindow) get().fetchCountries();
    if (hadCountry) {
      get().fetchChannels();
      get().fetchCohorts();
      if (get().buildsData) get().fetchBuilds();
    }
  },

  fetchUsers: async (page, pageSize) => {
    const state = get();
    const p = page ?? state.currentPage;
    const ps = pageSize ?? state.pageSize;
    const requestId = ++usersRequestId;

    set({ usersLoading: true, usersError: null });
    try {
      const params = new URLSearchParams({ page: p, page_size: ps });
      const journey = state.journeyUserFilter;
      // A spend gate ignores segment filters, so its drill must too: the list is the gate's n - k.
      if (!journey?.gate) {
        if (state.segmentOrigin) params.set('origin', state.segmentOrigin);
        if (state.segmentFrom) params.set('acquired_from', state.segmentFrom);
        if (state.segmentTo) params.set('acquired_to', state.segmentTo);
        if (state.segmentBuild !== null) params.set('build', state.segmentBuild);
        if (state.segmentCountry) params.set('country', state.segmentCountry);
        if (state.segmentSport) params.set('sport', state.segmentSport);
      }
      if (state.userFilter) params.set('filter', state.userFilter);
      if (journey && journey.gate) {
        params.set('spend_gate', journey.gate);
      } else if (journey) {
        for (const stage of journey.stages) params.append('journey_stage', stage);
        params.set('journey_outcome', journey.outcome);
        params.set('window_days', journey.windowDays);
        params.set('inactive_days', journey.inactiveDays);
        if (journey.platform) params.set('platform', journey.platform);
      }
      params.set('sort', state.sortKey);
      params.set('sort_dir', state.sortDir);
      params.set('exclude_test', state.excludeTest);
      const res = await apiFetch(`${API_BASE}/api/admin/users?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (requestId !== usersRequestId) return;
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
      if (requestId === usersRequestId) set({ usersLoading: false, usersError: err.message });
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
      // T8110: the combined mount fetch honors the Real pill (default ON) so the
      // dashboard opens on real users -- users list AND aggregates.
      const params = new URLSearchParams({ exclude_test: get().excludeTest });
      if (get().segmentCountry) params.set('country', get().segmentCountry);
      const res = await apiFetch(`${API_BASE}/api/admin/dashboard?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({
        countries: data.countries,
        users: data.users.users,
        currentPage: data.users.page,
        totalPages: data.users.total_pages,
        totalUsers: data.users.total_users,
        pageSize: data.users.page_size,
        funnelTotals: data.users.funnel_totals || null,
        pulseData: data.pulse,
        channelsData: data.channels,
        channelsBy: 'origin', // the dashboard payload is always the origin view
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

  // T14920: public/roadmap.json is a static file of this build (PLAN.md parsed at build time),
  // not an API resource, so it goes through plain fetch, uncached so Refresh sees a new deploy.
  // A missing or unparsable file is an error the panel shows loudly, never an empty roadmap.
  fetchRoadmap: async () => {
    set({ roadmapLoading: true, roadmapError: null });
    try {
      const res = await fetch('/roadmap.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set({ roadmap: await res.json(), roadmapLoading: false });
    } catch (err) {
      console.error('[Admin] roadmap fetch failed', err);
      set({ roadmapLoading: false, roadmapError: String(err.message || err) });
    }
  },

  // T14910: the eleven gates, verdicts, break-even and ladder in one read. Follows the
  // Real pill (excludeTest) like every admin aggregate. Every read empties the Diagnose cache
  // (the cuts must match the numbers beside them; an open drawer reads again) and an older
  // response never lands on top of a newer one (review follow-up 2026-11-06).
  fetchSpendReadiness: async () => {
    const seq = ++spendReadinessSeq;
    spendDiagnosisEpoch += 1;
    set({ spendReadinessLoading: true, spendReadinessError: null, spendGateDiagnosis: {} });
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/spend-readiness?exclude_test=${get().excludeTest}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (seq !== spendReadinessSeq) return;
      set({ spendReadiness: data, spendReadinessLoading: false });
    } catch (err) {
      if (seq !== spendReadinessSeq) return;
      console.error('[Admin] spend readiness fetch failed', err);
      set({ spendReadinessLoading: false, spendReadinessError: String(err.message || err) });
    }
  },

  // T14910: one gate's Diagnose cuts, read when its drawer opens (never on mount). A response
  // is dropped when a newer read of the same gate started after it, or when fetchSpendReadiness
  // emptied the cache meanwhile.
  fetchSpendGateDiagnosis: async (key) => {
    const seq = ++spendDiagnosisSeq;
    const epoch = spendDiagnosisEpoch;
    spendDiagnosisLatest[key] = seq;
    const current = () => spendDiagnosisLatest[key] === seq && spendDiagnosisEpoch === epoch;
    const entry = patch => set(state => ({
      spendGateDiagnosis: { ...state.spendGateDiagnosis, [key]: { loading: false, error: null, data: null, ...patch } },
    }));
    entry({ loading: true });
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/spend-readiness/gate/${key}?exclude_test=${get().excludeTest}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!current()) return;
      entry({ data });
    } catch (err) {
      if (!current()) return;
      console.error('[Admin] spend readiness diagnosis fetch failed', err);
      entry({ error: String(err.message || err) });
    }
  },

  // T14010: filters = { from, to, origin, build, country, platform, excludeTest, windowDays,
  // inactiveDays }. A read: it never writes anything back.
  fetchJourney: async (filters = {}) => {
    set({ journeyLoading: true, journeyError: null });
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/journey?${journeyParams(filters)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set({ journeyData: await res.json(), journeyLoading: false });
    } catch (err) {
      console.error('[Admin] journey fetch failed', err);
      set({ journeyLoading: false, journeyError: String(err.message || err) });
    }
  },

  // T14020: inspector for one stage; `by` = platform | origin | build | cohort_month | country. A read.
  // A response for a superseded (stage, by, filters) request is dropped.
  fetchJourneyStep: async (stage, by, filters = {}) => {
    const params = journeyParams(filters);
    params.set('by', by);
    const key = `${stage}?${params}`;
    stepRequestKey = key;
    set({ journeyStepLoading: true, journeyStepError: null });
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/journey/step/${stage}?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (stepRequestKey === key) set({ journeyStep: body, journeyStepLoading: false });
    } catch (err) {
      console.error('[Admin] journey step fetch failed', err);
      if (stepRequestKey === key) set({ journeyStepLoading: false, journeyStepError: String(err.message || err) });
    }
  },

  // T14030: admin "Run rollup" click -> in-process sweep into analytics.sqlite. Returns the
  // run summary (null on failure); the caller re-reads the inspector.
  runJourneyRollup: async () => {
    set({ journeyRollup: { running: true, error: null, result: null } });
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/journey/rollup`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      set({ journeyRollup: { running: false, error: null, result } });
      return result;
    } catch (err) {
      console.error('[Admin] journey rollup failed', err);
      set({ journeyRollup: { running: false, error: String(err.message || err), result: null } });
      return null;
    }
  },

  fetchChannels: async (from, to) => {
    const requestId = ++channelsRequestId;
    set({ channelsLoading: true });
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const { channelsBy, segmentCountry } = get();
      if (channelsBy !== 'origin') params.set('by', channelsBy);
      if (segmentCountry) params.set('country', segmentCountry);
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/channels?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (requestId === channelsRequestId) set({ channelsData: data, channelsLoading: false });
    } catch {
      if (requestId === channelsRequestId) set({ channelsLoading: false });
    }
  },

  // T15120: picker change. The old rows key their value under the old dimension, so
  // they go now rather than render under the new one while this loads or if it fails.
  setChannelsBy: (by) => {
    set({ channelsBy: by, channelsData: null });
    return get().fetchChannels();
  },

  // T13980: admin-created campaigns (Manage Campaigns modal). Fetched when the
  // modal opens; create/rename are gestures that patch the list in place.
  fetchCampaigns: async () => {
    set({ campaignsLoading: true, campaignsError: null });
    try {
      const params = new URLSearchParams({ exclude_test: String(get().excludeTest) });
      const res = await apiFetch(`${API_BASE}/api/admin/campaigns?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ campaigns: data.campaigns, campaignsLoading: false });
    } catch (err) {
      set({ campaignsLoading: false, campaignsError: err.message });
    }
  },

  createCampaign: async (name) => {
    const res = await apiFetch(`${API_BASE}/api/admin/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const campaign = await res.json();
    set(state => ({ campaigns: [campaign, ...(state.campaigns || [])] }));
    return campaign;
  },

  // Rename is display-only (the id is the stored origin), so the Campaign table's
  // label for that origin is patched in place too.
  renameCampaign: async (id, name) => {
    const res = await apiFetch(`${API_BASE}/api/admin/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const renamed = await res.json();
    set(state => ({
      campaigns: (state.campaigns || []).map(c => (c.id === id ? { ...c, name: renamed.name } : c)),
      channelsData: state.channelsData && {
        ...state.channelsData,
        channels: state.channelsData.channels.map(ch => (
          ch.origin === id ? { ...ch, campaign_name: renamed.name } : ch
        )),
      },
    }));
  },

  // T15200: the campaign row's Save-spend gesture (channel/spend_cents/landing_views/
  // platform_conversions) -- separate from renameCampaign, since each gesture sends only
  // the field group its own button touched. Patches the campaigns list in place; the Live
  // campaigns block re-reads spend readiness itself (fetchSpendReadiness), not from here.
  updateCampaignSpend: async (id, fields) => {
    const res = await apiFetch(`${API_BASE}/api/admin/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const updated = await res.json();
    set(state => ({
      campaigns: (state.campaigns || []).map(c => (c.id === id ? { ...c, ...updated } : c)),
    }));
    return updated;
  },

  fetchCohorts: async (granularity = 'week', origin = 'all') => {
    const requestId = ++cohortsRequestId;
    set({ cohortsLoading: true });
    try {
      const params = new URLSearchParams({ granularity, origin });
      if (get().segmentCountry) params.set('country', get().segmentCountry);
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/cohorts?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (requestId === cohortsRequestId) set({ cohortsData: data, cohortsLoading: false });
    } catch {
      if (requestId === cohortsRequestId) set({ cohortsLoading: false });
    }
  },

  fetchPulse: async (days = 30) => {
    const state = get();
    set({ pulseLoading: true });
    try {
      const params = new URLSearchParams({ days });
      if (state.segmentOrigin) params.set('origin', state.segmentOrigin);
      if (state.segmentFrom) params.set('acquired_from', state.segmentFrom);
      if (state.segmentTo) params.set('acquired_to', state.segmentTo);
      if (state.segmentBuild !== null) params.set('build', state.segmentBuild);
      if (state.segmentCountry) params.set('country', state.segmentCountry);
      if (state.userFilter) params.set('filter', state.userFilter);
      params.set('exclude_test', state.excludeTest);
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/pulse?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set({ pulseData: await res.json(), pulseLoading: false });
    } catch { set({ pulseLoading: false }); }
  },

  fetchBuilds: async () => {
    const requestId = ++buildsRequestId;
    set({ buildsLoading: true });
    try {
      const params = new URLSearchParams({ exclude_test: String(get().excludeTest) });
      if (get().segmentCountry) params.set('country', get().segmentCountry);
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/builds?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (requestId === buildsRequestId) set({ buildsData: data, buildsLoading: false });
    } catch {
      if (requestId === buildsRequestId) set({ buildsLoading: false });
    }
  },

  // T15100: the Country selector's options after the window changes (the dashboard payload
  // carries the first set). Never sends the picked country: the list must
  // keep offering the others.
  fetchCountries: async () => {
    const requestId = ++countriesRequestId;
    const { segmentFrom, segmentTo, excludeTest } = get();
    try {
      const params = new URLSearchParams({ exclude_test: String(excludeTest) });
      if (segmentFrom) params.set('from', segmentFrom);
      if (segmentTo) params.set('to', segmentTo);
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/countries?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { countries } = await res.json();
      if (requestId === countriesRequestId) set({ countries });
    } catch (err) {
      console.error('[Admin] countries fetch failed', err);
    }
  },

  fetchPlatforms: async () => {
    const state = get();
    set({ platformsLoading: true });
    try {
      // T14000: same population as the dashboard's section (Real pill + build pick).
      const params = new URLSearchParams({ exclude_test: String(state.excludeTest) });
      if (state.segmentBuild !== null) params.set('build', state.segmentBuild);
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/platforms?${params}`);
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

  // T10270: on-demand upload-failures drill-down. Explicit gesture (a Refresh
  // click, RevenueReconciliation's precedent) — never auto-fetched on mount.
  // T13330: purchases by pack (payments ledger), on demand, honoring the test filter.
  fetchPackMix: async () => {
    set({ packMixLoading: true, packMixError: null });
    try {
      const params = new URLSearchParams({ exclude_test: get().excludeTest });
      const res = await apiFetch(`${API_BASE}/api/admin/analytics/pack-mix?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      set({ packMixData: await res.json(), packMixLoading: false });
    } catch (err) {
      set({ packMixLoading: false, packMixError: err.message });
    }
  },

  fetchR2Usage: async () => {
    set({ r2UsageLoading: true, r2UsageError: null });
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/r2-usage`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      set({ r2UsageData: await res.json(), r2UsageLoading: false });
    } catch (err) {
      set({ r2UsageLoading: false, r2UsageError: err.message });
    }
  },

  fetchUploadFailures: async (filters = {}) => {
    set({ uploadFailuresLoading: true, uploadFailuresError: null });
    try {
      const params = new URLSearchParams();
      for (const key of ['sinceBuild', 'since', 'until', 'kind', 'stage', 'reason', 'userId', 'origin']) {
        if (filters[key] != null && filters[key] !== '') {
          const paramKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
          params.set(paramKey, filters[key]);
        }
      }
      if (filters.includeImpersonated) params.set('include_impersonated', 'true');
      const res = await apiFetch(`${API_BASE}/api/admin/upload-failures?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      set({ uploadFailuresData: await res.json(), uploadFailuresLoading: false });
    } catch (err) {
      set({ uploadFailuresLoading: false, uploadFailuresError: err.message });
    }
  },

  // T5760: run the on-demand reconciliation pass (compares local total_spent_cents
  // against per-user Stripe NET revenue). Explicit gesture — this hits Stripe, so it
  // is never fired on the main user-table load path.
  fetchReconciliation: async () => {
    // T8640: honour the same test-account filter the rest of the admin panel uses
    // (the "Real" pill). Clear any prior heal outcomes on a fresh run.
    set({ reconciliationLoading: true, reconciliationError: null, reconciliationHealResults: {} });
    try {
      const params = new URLSearchParams({ exclude_test: get().excludeTest });
      const res = await apiFetch(`${API_BASE}/api/admin/revenue-reconciliation?${params}`);
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
  // T8640: capture per-row outcomes BEFORE the refresh so a heal that returned
  // healed:false (e.g. an account_deleted row reconciled from the ledger) is visible
  // on the row instead of silently vanishing.
  healReconciliation: async ({ userIds = null, allDrifted = false } = {}) => {
    set({ reconciliationLoading: true, reconciliationError: null });
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/revenue-reconciliation/heal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ids: userIds, all_drifted: allDrifted, exclude_test: get().excludeTest }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const healResults = {};
      for (const r of data.results || []) healResults[r.user_id] = r;
      await get().fetchReconciliation();   // clears reconciliationHealResults
      set({ reconciliationHealResults: healResults });
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
