import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FUNNEL_EVENTS } from './funnelEvents';

// T11175: every engagement event that rode the quest achievements POST must still
// be fired, under its milestone name, from the gesture handler it moved out of.
// Each row pins the call to its enclosing handler, so deleting a call, misnaming
// its event, or moving it into a different function fails here. The transport
// itself (name -> POST /api/telemetry/funnel-event -> user_actions) is covered by
// funnelEvents.reroute.test.js and test_t11175_funnel_reroute.py.

const SRC = resolve(__dirname, '..');

// family -> [milestone, file, enclosing handler, call expression]
const CALL_SITES = {
  pre_upload: [
    ['add_game_opened', 'components/ProjectManager.jsx', 'handleAddGameClick', 'recordFunnelEvent(FUNNEL_EVENTS.ADD_GAME_OPENED)'],
    ['upload_file_selected', 'components/GameDetailsModal.jsx', 'recordFileSelected', 'recordFunnelEvent(FUNNEL_EVENTS.UPLOAD_FILE_SELECTED)'],
    ['add_clip_opened', 'containers/AnnotateContainer.jsx', 'handleAddClipFromButton', 'recordFunnelEvent(FUNNEL_EVENTS.ADD_CLIP_OPENED)'],
  ],
  editor_opened: [
    ['framing_opened', 'App.jsx', 'useEffect', 'recordFunnelEvent(FUNNEL_EVENTS.FRAMING_OPENED)', 'editorMode === EDITOR_MODES.FRAMING'],
    ['overlay_opened', 'App.jsx', 'useEffect', 'recordFunnelEvent(FUNNEL_EVENTS.OVERLAY_OPENED)', 'editorMode === EDITOR_MODES.OVERLAY'],
  ],
  gallery: [
    ['gallery_viewed', 'components/PublishedReelsPanel.jsx', 'openDownloadPlayer', 'recordFunnelEvent(FUNNEL_EVENTS.GALLERY_VIEWED)'],
    ['custom_project_viewed', 'components/PublishedReelsPanel.jsx', 'openDownloadPlayer', 'recordFunnelEvent(FUNNEL_EVENTS.CUSTOM_PROJECT_VIEWED)'],
    ['gallery_watched_1s', 'components/PublishedReelsPanel.jsx', 'openDownloadPlayer', 'recordFunnelEvent(FUNNEL_EVENTS.GALLERY_WATCHED_1S)'],
  ],
  annotate: [
    ['annotations_played', 'modes/annotate/hooks/useAnnotationPlayback.js', 'tick', 'recordFunnelEvent(FUNNEL_EVENTS.ANNOTATIONS_PLAYED)'],
  ],
  framing_step: [
    ['crop_adjusted', 'containers/FocusContainer.jsx', 'handleCropComplete', 'recordFunnelEvent(FUNNEL_EVENTS.CROP_ADJUSTED)'],
    ['speed_segment_created', 'containers/FocusContainer.jsx', 'handleSegmentSpeedChange', 'recordFunnelEvent(FUNNEL_EVENTS.SPEED_SEGMENT_CREATED)'],
  ],
  overlay_step: [
    ['overlay_players_assigned', 'containers/OverlayContainer.jsx', 'maybeEmitPlayersAssigned', 'recordFunnelEvent(FUNNEL_EVENTS.OVERLAY_PLAYERS_ASSIGNED)'],
    ['overlay_color_set', 'screens/OverlayScreen.jsx', 'wrappedSetHighlightColor', 'recordFunnelEvent(FUNNEL_EVENTS.OVERLAY_COLOR_SET)'],
    ['overlay_shape_set', 'screens/OverlayScreen.jsx', 'wrappedSetHighlightShape', 'recordFunnelEvent(FUNNEL_EVENTS.OVERLAY_SHAPE_SET)'],
  ],
  overlay_offer: [
    ['overlay_offered', 'screens/focusCompletionOffer.js', 'offerFocusCompletionPreview', "recordFunnelEvent('overlay_offered')"],
    ['overlay_offered', 'utils/resumeFocusCompletion.js', 'resumeFocusCompletion', "recordFunnelEvent('overlay_offered')"],
    ['overlay_deferred', 'screens/FocusScreen.jsx', 'handleAddSpotlightLater', 'recordFunnelEvent(FUNNEL_EVENTS.OVERLAY_DEFERRED)'],
    ['overlay_declined', 'screens/FocusScreen.jsx', 'handlePublish', 'recordFunnelEvent(FUNNEL_EVENTS.OVERLAY_DECLINED)'],
  ],
  draft_preview: [
    ['previewed_draft_reel_1s', 'components/DraftReelPreview.jsx', 'useEffect', 'recordFunnelEvent(FUNNEL_EVENTS.PREVIEWED_DRAFT_REEL_1S)'],
  ],
  tutorial: [
    ['watched_annotate_tutorial', 'components/TutorialVideoModal.jsx', 'fireWatched', 'recordFunnelEvent(watchedEvent)', 'quest_1: FUNNEL_EVENTS.WATCHED_ANNOTATE_TUTORIAL'],
    ['watched_framing_tutorial', 'components/TutorialVideoModal.jsx', 'fireWatched', 'recordFunnelEvent(watchedEvent)', 'quest_2: FUNNEL_EVENTS.WATCHED_FRAMING_TUTORIAL'],
    ['watched_overlay_tutorial', 'components/TutorialVideoModal.jsx', 'fireWatched', 'recordFunnelEvent(watchedEvent)', 'quest_3: FUNNEL_EVENTS.WATCHED_OVERLAY_TUTORIAL'],
    ['watched_publish_tutorial', 'components/TutorialVideoModal.jsx', 'fireWatched', 'recordFunnelEvent(watchedEvent)', 'quest_4: FUNNEL_EVENTS.WATCHED_PUBLISH_TUTORIAL'],
  ],
};

// The innermost named function (const x = [useCallback(](..) => {, function x(..) {)
// or anonymous useEffect body whose braces contain `idx`.
const DEFINITION = /(?:const|let)\s+(\w+)\s*=\s*(?:useCallback\(\s*)?(?:async\s*)?(?:\([^()]*\)|\w+)\s*=>\s*\{|(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{|(useEffect)\(\s*\(\)\s*=>\s*\{/g;
function enclosing(src, idx) {
  let best = null;
  for (const m of src.matchAll(DEFINITION)) {
    if (m.index > idx) break;
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) {
        if (i > idx) best = { name: m[1] || m[2] || m[3], body: src.slice(open, i) };
        break;
      }
    }
  }
  return best;
}

const sources = {};
const read = (file) => (sources[file] ??= readFileSync(resolve(SRC, file), 'utf8'));

// The call's event, resolved through FUNNEL_EVENTS (a misspelled key is undefined).
function eventOf(call) {
  const key = call.match(/FUNNEL_EVENTS\.(\w+)/)?.[1];
  if (key) return FUNNEL_EVENTS[key];
  return call.match(/'(\w+)'/)?.[1];
}

describe('T11175 rerouted call sites fire their milestone', () => {
  for (const [family, rows] of Object.entries(CALL_SITES)) {
    it(`${family}: each call site sends its milestone from its handler`, () => {
      for (const [milestone, file, handler, call, guard] of rows) {
        const src = read(file);
        const at = src.indexOf(call);
        expect(at, `${file}: ${call} missing`).toBeGreaterThan(-1);
        const fn = enclosing(src, at);
        const owners = [];
        for (let i = at; i !== -1; i = src.indexOf(call, i + 1)) owners.push(enclosing(src, i)?.name);
        expect(owners, `${file}: ${call} not inside ${handler}`).toContain(handler);
        if (call === 'recordFunnelEvent(watchedEvent)') {
          expect(src, `${file}: ${milestone} not mapped`).toContain(guard);
          expect(FUNNEL_EVENTS[guard.split('FUNNEL_EVENTS.')[1]]).toBe(milestone);
          continue;
        }
        expect(eventOf(call), `${file}: ${call} sends the wrong name`).toBe(milestone);
        if (guard) expect(fn.body, `${file}: ${call} not under ${guard}`).toContain(guard);
      }
    });
  }

  it('the overlay offer helpers receive the real funnel transport', () => {
    for (const file of ['screens/FocusScreen.jsx', 'components/FocusCompletionRecovery.jsx']) {
      const src = read(file);
      expect(src, file).toMatch(/import \{[^}]*\brecordFunnelEvent\b[^}]*\} from '\.\.\/utils\/funnelEvents'/);
      expect(src, file).toMatch(/\brecordFunnelEvent,/);
    }
  });
});
