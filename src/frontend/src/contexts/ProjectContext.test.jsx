import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock config so API_BASE is empty (relative URLs)
vi.mock('../config', () => ({ API_BASE: '' }));

// Mock profiling helper used by projectsStore.fetchProject
vi.mock('../utils/profiling', () => ({ PROFILING_ENABLED: false }));

import { ProjectProvider, useProject } from './ProjectContext';
import { useProjectsStore } from '../stores/projectsStore';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function jsonResponse(data) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
}

// Tiny consumer that surfaces the context onto the DOM so we can assert.
function Consumer() {
  const { projectId, project, aspectRatio } = useProject();
  return (
    <div>
      <span data-testid="pid">{String(projectId)}</span>
      <span data-testid="name">{project?.name ?? 'none'}</span>
      <span data-testid="aspect">{aspectRatio}</span>
    </div>
  );
}

describe('ProjectContext — single fetch per project-open', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    useProjectsStore.setState({
      projects: [],
      selectedProjectId: null,
      selectedProject: null,
      loading: false,
      error: null,
    });
  });

  it('issues exactly one GET /api/projects/{id} when a project is opened', async () => {
    const project = { id: 123, name: 'My Project', aspect_ratio: '16:9', working_video_id: 7 };
    mockFetch.mockImplementation((url) => {
      if (String(url).includes('/api/projects/123')) return jsonResponse(project);
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    render(
      <ProjectProvider>
        <Consumer />
      </ProjectProvider>
    );

    // Drive a real project-open through the canonical store path.
    await act(async () => {
      await useProjectsStore.getState().selectProject(123);
    });

    // Context mirrors store state.
    await waitFor(() => expect(screen.getByTestId('name').textContent).toBe('My Project'));
    expect(screen.getByTestId('pid').textContent).toBe('123');
    expect(screen.getByTestId('aspect').textContent).toBe('16:9');

    // The proof: only the store's fetchProject hit the endpoint — no second
    // bare fetch from ProjectContext.
    const projectRequests = mockFetch.mock.calls.filter(([url]) =>
      String(url).includes('/api/projects/123')
    );
    expect(projectRequests).toHaveLength(1);
  });

  it('refresh() re-fetches once and returns the fresh project', async () => {
    const v1 = { id: 123, name: 'V1', aspect_ratio: '9:16' };
    const v2 = { id: 123, name: 'V2', aspect_ratio: '9:16', working_video_url: 'http://x/v.mp4' };
    let call = 0;
    mockFetch.mockImplementation((url) => {
      if (String(url).includes('/api/projects/123')) {
        call += 1;
        return jsonResponse(call === 1 ? v1 : v2);
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    let ctx;
    function Capture() {
      ctx = useProject();
      return null;
    }
    render(
      <ProjectProvider>
        <Capture />
      </ProjectProvider>
    );

    await act(async () => {
      await useProjectsStore.getState().selectProject(123);
    });

    let returned;
    await act(async () => {
      returned = await ctx.refresh();
    });

    // OverlayScreen relies on this return value for its working-video recovery path.
    expect(returned).toEqual(v2);
    expect(returned.working_video_url).toBe('http://x/v.mp4');

    const projectRequests = mockFetch.mock.calls.filter(([url]) =>
      String(url).includes('/api/projects/123')
    );
    // One for selectProject, one for refresh — no duplicate per open.
    expect(projectRequests).toHaveLength(2);
  });
});
