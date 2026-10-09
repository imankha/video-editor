import { describe, it, expect } from 'vitest';
import { resolveGuide } from './resolveGuide';
import { annotateFacts } from './catalog';
import { GUIDE } from '../../config/displayNames';

const facts = (region, instances, local) => annotateFacts(region, instances, local);
const id = (region, instances, local) => resolveGuide(facts(region, instances, local))?.id;
const portrait = (action) => [{ orientation: 'portrait', projectId: 7, action }];

describe('T12260: every Annotate state has a guide', () => {
  it('watch / playing / has-plays', () => {
    expect(id(null, [], {})).toBe('annotate.progress.watch');
    expect(id(null, [], { isPlaying: true })).toBe('annotate.watch.playing');
    expect(id(null, [], { playCount: 1 })).toBe('annotate.has-plays.one');
    expect(id(null, [], { playCount: 3 })).toBe('annotate.has-plays.many');
  });

  it('play editor anchors to Done and avoids the timeline handles and Delete', () => {
    const g = resolveGuide(facts({ rating: 3 }, [], { editorOpen: true, playCount: 1 }));
    expect(g.id).toBe('annotate.editor');
    expect(g.anchor.target).toBe('[data-testid="play-editor-done"]');
    expect(g.avoid).toEqual(expect.arrayContaining([
      '[data-testid="scrub-start-handle"]', '[data-testid="scrub-end-handle"]', '[data-testid="delete-play-button"]',
    ]));
  });

  it('Done -> choice card guide avoids both buttons', () => {
    const g = resolveGuide(facts({ rating: 5 }, [], { editorOpen: true, choiceOpen: true }));
    expect(g.id).toBe('annotate.choice');
    expect(g.avoid).toEqual(expect.arrayContaining(['[data-testid="highlight-choice-now"]', '[data-testid="highlight-choice-later"]']));
  });

  it('a selected play below 5 stars no longer falls through to the watch text', () => {
    expect(id({ rating: 3 }, [], { playCount: 2 })).toBe('annotate.selected.none');
  });

  it('selected 5-star states: none / framing / generating / spotlight / ready / finished', () => {
    expect(id({ rating: 5 }, [], {})).toBe('annotate.progress.brilliant');
    expect(id({ rating: 5 }, portrait('framing'), {})).toBe('annotate.progress.portrait');
    expect(id({ rating: 5 }, portrait('framing'), { generating: true })).toBe('annotate.selected.generating');
    expect(id({ rating: 5 }, portrait('overlay'), {})).toBe('annotate.progress.spotlight');
    expect(id({ rating: 5 }, portrait('preview'), {})).toBe('annotate.progress.preview');
    expect(id({ rating: 5 }, portrait('published'), {})).toBe('annotate.progress.published');
  });

  it('review plays and expired source', () => {
    expect(id(null, [], { reviewing: true, playCount: 2 })).toBe('annotate.review');
    expect(id(null, [], { expired: true, playCount: 2 })).toBe('annotate.expired');
    expect(GUIDE.annotate.expired.title).toBe('This game’s video has expired. Upload it again to mark more plays.');
  });

  it('no Annotate guide copy says Saved', () => {
    expect(JSON.stringify(GUIDE.annotate)).not.toMatch(/Saved/);
  });
});
