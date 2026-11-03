import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { resolveGuide } from '../../../components/instructions/resolveGuide';
import { useProjectsStore } from '../../../stores/projectsStore';

// T14420: the touch play editor (portrait strip, 390 and 768 wide) draws the COMPACT trim bar. Its
// track and green ends carried no testids, so the `annotate.editor` rule's keepClear selectors for
// them matched nothing: the trim bar the sentence names ("Drag the green ends") was shaded and the
// card could be placed over it. Mount the real strip and check every trim selector the rule names.

window.matchMedia = (query) => ({ matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });
afterEach(() => { cleanup(); useProjectsStore.setState({ projects: [] }); });

const editClip = { id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], notes: '', name: 'Play 1', my_athlete: true, tagged_teammates: [] };
const props = { isVisible: true, currentTime: 3, videoDuration: 60, onUpdateClip: () => Promise.resolve({ saveOk: true }), onClose() {}, onSeek() {}, videoController: {}, onDeleteClip() {}, layout: 'portrait-strip', existingClip: editClip };

describe('T14420: the editor rule finds the touch trim bar', () => {
  it('every scrub selector in annotate.editor keepClear matches the portrait strip', () => {
    const g = resolveGuide({ screen: 'annotate', progress: { selectedPlay: { rating: 4 }, portrait: null }, local: { editorOpen: true } });
    expect(g.id).toBe('annotate.editor');
    const trim = g.keepClear.filter(s => s.includes('scrub-'));
    expect(trim.length).toBeGreaterThanOrEqual(3);
    const { container } = render(<AnnotateFullscreenOverlay {...props} />);
    const strip = container.querySelector('[data-testid="annotate-portrait-strip"]');
    expect(strip).toBeTruthy();
    for (const selector of trim) expect(strip.querySelector(selector), selector).not.toBeNull();
    // The handles sit inside the track, so cutting the track also keeps both green ends bright.
    const track = strip.querySelector('[data-testid="scrub-track"]');
    expect(track.contains(strip.querySelector('[data-testid="scrub-start-handle"]'))).toBe(true);
    expect(track.contains(strip.querySelector('[data-testid="scrub-end-handle"]'))).toBe(true);
  });
});
