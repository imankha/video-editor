import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

import { useProjectsStore } from './projectsStore';
import apiFetch from '../utils/apiFetch';

// Captured before any test swaps the action for a stub.
const realFetchProject = useProjectsStore.getState().fetchProject;

describe('projectsStore.refreshSelectedProject', () => {
  beforeEach(() => {
    useProjectsStore.setState({
      projects: [],
      selectedProjectId: null,
      selectedProject: null,
      loading: false,
      error: null,
    });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies the result when the selection is unchanged', async () => {
    const project = { id: 45, name: 'Brilliant Interception' };
    useProjectsStore.setState({
      selectedProjectId: 45,
      selectedProject: null,
      fetchProject: async () => project,
    });

    const result = await useProjectsStore.getState().refreshSelectedProject();

    expect(result).toBe(project);
    expect(useProjectsStore.getState().selectedProject).toEqual(project);
  });

  it('discards the result when the selection is cleared mid-flight (does not resurrect it)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let resolveFetch;
    useProjectsStore.setState({
      selectedProjectId: 45,
      selectedProject: null,
      fetchProject: () => new Promise((resolve) => { resolveFetch = resolve; }),
    });

    // Refresh starts (captures id 45) but hasn't resolved yet.
    const pending = useProjectsStore.getState().refreshSelectedProject();

    // Selection is cleared while the fetch is in flight (post-export navigation).
    useProjectsStore.getState().clearSelection();

    // The in-flight fetch now resolves with the stale project.
    resolveFetch({ id: 45, name: 'Brilliant Interception' });
    const result = await pending;

    expect(result).toBe(null);
    expect(useProjectsStore.getState().selectedProject).toBe(null);
    expect(useProjectsStore.getState().selectedProjectId).toBe(null);
    expect(warn).toHaveBeenCalled();
  });

  it('discards the result when the selection changes to a different project mid-flight', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let resolveFetch;
    useProjectsStore.setState({
      selectedProjectId: 45,
      selectedProject: null,
      fetchProject: () => new Promise((resolve) => { resolveFetch = resolve; }),
    });

    const pending = useProjectsStore.getState().refreshSelectedProject();

    // User selects a different project before the refresh resolves.
    useProjectsStore.setState({ selectedProjectId: 99, selectedProject: { id: 99 } });

    resolveFetch({ id: 45, name: 'stale' });
    const result = await pending;

    expect(result).toBe(null);
    // The newer selection must remain intact.
    expect(useProjectsStore.getState().selectedProjectId).toBe(99);
    expect(useProjectsStore.getState().selectedProject).toEqual({ id: 99 });
  });

  it('returns null without fetching when nothing is selected', async () => {
    const fetchProject = vi.fn();
    useProjectsStore.setState({ selectedProjectId: null, fetchProject });

    const result = await useProjectsStore.getState().refreshSelectedProject();

    expect(result).toBe(null);
    expect(fetchProject).not.toHaveBeenCalled();
  });
});

describe('projectsStore.renameProject (T4230)', () => {
  beforeEach(() => {
    useProjectsStore.setState({ projects: [], selectedProjectId: null });
    vi.mocked(apiFetch).mockReset();
  });

  it('sends only { name } -- never a stale aspect_ratio (single-writer rule)', async () => {
    // The cached project still carries the OLD ratio; a rename must not echo it back.
    useProjectsStore.setState({
      projects: [{ id: 7, name: 'Old Name', aspect_ratio: '9:16', is_auto_created: true }],
    });
    vi.mocked(apiFetch).mockResolvedValue({ ok: true });

    await useProjectsStore.getState().renameProject(7, 'New Name');

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = vi.mocked(apiFetch).mock.calls[0];
    expect(url).toMatch(/\/projects\/7$/);
    expect(opts.method).toBe('PUT');
    const body = JSON.parse(opts.body);
    expect(body).toEqual({ name: 'New Name' });
    expect(body).not.toHaveProperty('aspect_ratio');
  });

  it('T8360: is_auto_created survives a rename unchanged (rename never re-routes Clips <-> Highlights)', async () => {
    useProjectsStore.setState({
      projects: [{ id: 7, name: 'Old Name', aspect_ratio: '9:16', is_auto_created: true }],
    });
    vi.mocked(apiFetch).mockResolvedValue({ ok: true });

    await useProjectsStore.getState().renameProject(7, 'New Name');

    const project = useProjectsStore.getState().projects[0];
    expect(project.name).toBe('New Name');
    expect(project.is_auto_created).toBe(true);
  });
});

// T14970: the Plays tab shows this field as a failed list. One play failing to open says
// nothing about the list, and the caller already gets null.
describe('projectsStore: a single project failing does not fail the list', () => {
  it('fetchProject on a 404 returns null and leaves the list error clear', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useProjectsStore.setState({ error: null });
    apiFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(realFetchProject(404040)).resolves.toBeNull();
    expect(useProjectsStore.getState().error).toBeNull();
    expect(useProjectsStore.getState().loading).toBe(false);
  });
});

// T14970: back and forward can move the selection while a project fetch is in flight.
describe('projectsStore.selectProject: a late response does not resurrect its project', () => {
  it('keeps the newer selection when the older fetch lands last', async () => {
    const resolvers = {};
    useProjectsStore.setState({
      selectedProjectId: null,
      selectedProject: null,
      fetchProject: (id) => new Promise((resolve) => { resolvers[id] = resolve; }),
    });
    const { selectProject } = useProjectsStore.getState();
    const older = selectProject(1);
    const newer = selectProject(2);

    resolvers[2]({ id: 2 });
    await newer;
    resolvers[1]({ id: 1 });
    await older;

    expect(useProjectsStore.getState().selectedProjectId).toBe(2);
    expect(useProjectsStore.getState().selectedProject).toEqual({ id: 2 });
  });

  it('stays cleared when the selection was cleared during the fetch', async () => {
    let resolveFetch;
    useProjectsStore.setState({
      selectedProjectId: null,
      selectedProject: null,
      fetchProject: () => new Promise((resolve) => { resolveFetch = resolve; }),
    });
    const pending = useProjectsStore.getState().selectProject(1);
    useProjectsStore.getState().clearSelection();

    resolveFetch({ id: 1 });
    await pending;

    expect(useProjectsStore.getState().selectedProject).toBeNull();
  });
});

// T14970: Home settles its landing tab once `loading` is false. Before the first load that
// must not read as "this account has no plays".
describe('projectsStore before its first load', () => {
  it('reports loading until the list arrives', async () => {
    vi.resetModules();
    const { useProjectsStore: fresh } = await import('./projectsStore');
    expect(fresh.getState().loading).toBe(true);
    fresh.getState().setFromBootstrap([{ id: 1 }]);
    expect(fresh.getState().loading).toBe(false);
  });
});
