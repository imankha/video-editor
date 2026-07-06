import { describe, it, expect } from 'vitest';

import { isEmptyDraft } from './ProjectManager';

/**
 * T4800 — Reel Drafts must not render a 0-clip orphan draft.
 *
 * isEmptyDraft is the predicate the ProjectManager drafts filter uses to drop
 * such orphans (belt-and-suspenders behind the backend GET /api/projects filter).
 * Pinning it here keeps the client guard honest without a brittle full-tree render.
 */
describe('isEmptyDraft — T4800 orphan draft guard', () => {
  it('treats a 0-clip project as empty (excluded from Reel Drafts)', () => {
    expect(isEmptyDraft({ id: 1, name: 'Orphan', clip_count: 0 })).toBe(true);
  });

  it('treats a project with clips as a real draft (kept)', () => {
    expect(isEmptyDraft({ id: 2, name: 'Real Draft', clip_count: 1 })).toBe(false);
    expect(isEmptyDraft({ id: 3, name: 'Multi', clip_count: 4 })).toBe(false);
  });

  it('fails closed when clip_count is missing/undefined', () => {
    expect(isEmptyDraft({ id: 4, name: 'No count' })).toBe(true);
    expect(isEmptyDraft({ clip_count: undefined })).toBe(true);
    expect(isEmptyDraft({ clip_count: null })).toBe(true);
  });

  it('filters orphans out of a mixed drafts list, keeping real drafts', () => {
    const projects = [
      { id: 1, name: 'Real', clip_count: 2 },
      { id: 2, name: 'Orphan A', clip_count: 0 },
      { id: 3, name: 'Also Real', clip_count: 1 },
      { id: 4, name: 'Orphan B' }, // no clip_count
    ];
    const rendered = projects.filter((p) => !isEmptyDraft(p));
    expect(rendered.map((p) => p.id)).toEqual([1, 3]);
  });
});
