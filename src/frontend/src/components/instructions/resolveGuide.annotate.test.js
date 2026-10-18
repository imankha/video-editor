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

  it('while the game uploads, the coach never steers toward making a highlight', () => {
    const uploadingSelected = resolveGuide(facts({ rating: 5 }, [], { uploading: true, playCount: 2 }));
    expect(uploadingSelected.id).toBe('annotate.uploading.selected');
    expect(uploadingSelected.pulse).toBeNull();
    expect(id({ rating: 3 }, [], { uploading: true, playCount: 2 })).toBe('annotate.uploading.selected');

    const uploadingPlays = resolveGuide(facts(null, [], { uploading: true, playCount: 2 }));
    expect(uploadingPlays.id).toBe('annotate.uploading.has-plays');
    expect(uploadingPlays.pulse).toBe('annotate-mark-play-button');

    for (const g of [uploadingSelected, uploadingPlays]) expect(g.message.title).not.toMatch(/make (it )?a highlight|Make highlight|portrait highlight/i);
    // The play editor and its Done still lead while open; no plays yet is the plain watch step.
    expect(id({ rating: 5 }, [], { uploading: true, editorOpen: true })).toBe('annotate.editor');
    expect(id(null, [], { uploading: true })).toBe('annotate.progress.watch');
  });

  it('no Annotate guide copy says Saved', () => {
    expect(JSON.stringify(GUIDE.annotate)).not.toMatch(/Saved/);
  });
});

describe('T12470: guide copy names only buttons on screen', () => {
  it('a selected play guide does not point at the replaced Mark play card', () => {
    const g = resolveGuide({ screen: 'annotate', progress: { selectedPlay: { rating: 3 }, portrait: null }, local: { playCount: 1 } });
    expect(g.message.title).not.toMatch(/Mark play/);
  });
});
