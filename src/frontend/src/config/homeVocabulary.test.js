// T14600: Home tabs + tile copy follow the copy glossary (.claude/references/copy-glossary.md).
import { describe, it, expect } from 'vitest';
import {
  SECTION_NAMES, SECTION_NAMES_SHORT, CLIP_UPLOAD, HOME_TILE, GUIDE, FRAMED_BANNER,
  FOCUS_PUBLISH_LATER_TOAST, NOTES_OVERLAY_STATUS,
} from './displayNames';
import { EMPTY_TAB_GUIDE, PARTIAL_TAB_GUIDE } from './emptyStates';
import { getDraftStageLabel, getDraftStatus } from '../utils/draftStage';

const BANNED = /\b(clips?|drafts?|mix(es)?|top plays|smart|content|re-?edit(ed)?|click|failed to|could not)\b/i;

describe('T14600 Home tabs', () => {
  it('tabs read Games / Plays / Highlights at every width', () => {
    expect(SECTION_NAMES_SHORT).toMatchObject({ GAMES: 'Games', CLIPS: 'Plays', PUBLISHED: 'Highlights' });
    expect(SECTION_NAMES.CLIPS).toBe('Plays');
    expect(SECTION_NAMES.CLIPS_LOWER).toBe('plays');
    expect(SECTION_NAMES.PUBLISHED).toBe('Highlights');
  });

  it('Plays tab heading, button and guide lines', () => {
    expect(EMPTY_TAB_GUIDE.clips.headline).toBe("Plays you're turning into highlights");
    expect(CLIP_UPLOAD.UPLOAD_CLIP).toBe('Upload a play');
    expect(GUIDE.home.clipsUnfinished.title).toBe('Pick up where you left off. Tap a play to make its highlight.');
    expect(GUIDE.home.clipsAllDone.title).toBe('Every play is finished. Open a game to mark more plays.');
  });

  it('no banned word in tab, empty-state, upload or toast copy', () => {
    const strings = [
      ...Object.values(SECTION_NAMES), ...Object.values(SECTION_NAMES_SHORT),
      ...Object.values(EMPTY_TAB_GUIDE.games), ...Object.values(EMPTY_TAB_GUIDE.clips),
      ...Object.values(EMPTY_TAB_GUIDE.published), ...Object.values(PARTIAL_TAB_GUIDE.clips),
      ...Object.values(PARTIAL_TAB_GUIDE.published),
      CLIP_UPLOAD.UPLOAD_CLIP, CLIP_UPLOAD.NOTICE_TITLE, CLIP_UPLOAD.NOTICE_BODY, CLIP_UPLOAD.NOTICE_PICK,
      CLIP_UPLOAD.SIZE_LIMIT_TITLE, CLIP_UPLOAD.POST_UPLOAD_TOO_LARGE_TITLE,
      ...Object.values(GUIDE.home).map((g) => g.title),
      FRAMED_BANNER.body, FRAMED_BANNER.VIEW_IN_CLIPS_LABEL,
      FOCUS_PUBLISH_LATER_TOAST.SINGLE_CLIP.title, FOCUS_PUBLISH_LATER_TOAST.SINGLE_CLIP.message,
    ].filter((s) => typeof s === 'string');
    const offenders = strings.filter((s) => BANNED.test(s));
    expect(offenders).toEqual([]);
  });

  it('tile menus and badges use glossary words', () => {
    expect(HOME_TILE.EDIT_HIGHLIGHT).toBe('Edit highlight');
    expect(HOME_TILE.EDIT_SPOTLIGHT).toBe('Edit spotlight');
    expect(HOME_TILE.MOVE_TO_HIGHLIGHTS).toBe('Move to Highlights');
    expect(HOME_TILE.TAP_AGAIN_CONFIRM).toBe('Tap again to confirm');
    expect(HOME_TILE.containsPlays(3)).toBe('Contains 3 plays');
    expect(HOME_TILE.stalePlays(1)).toBe('1 play changed since this highlight was made');
    expect(HOME_TILE.stalePlays(2)).toBe('2 plays changed since this highlight was made');
    for (const s of Object.values(HOME_TILE).map((v) => (typeof v === 'function' ? v(2) : v))) {
      expect(s).not.toMatch(BANNED);
    }
  });

  it('statuses come from the single ladder: Not started / In progress / Finished', () => {
    expect(getDraftStageLabel({})).toBe('Not started');
    expect(getDraftStatus({ has_final_video: true, is_published: true }).label).toBe('Finished');
  });

  it('notes overlay stage status is single-sourced', () => {
    expect(NOTES_OVERLAY_STATUS.IN_PROGRESS).toBe('In progress');
    expect(NOTES_OVERLAY_STATUS.FINISHED).toBe('Finished');
  });
});
