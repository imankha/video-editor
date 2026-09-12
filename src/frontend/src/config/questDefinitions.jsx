/**
 * Quest Step UI — JSX descriptions and titles keyed by step ID (T540, T1000, T3700).
 *
 * Quest structure (IDs, rewards, step order) comes from the backend via
 * GET /api/quests/definitions. This file only holds the UI layer: step titles
 * and rich JSX descriptions with inline icons that can't be serialized over API.
 *
 * T3700: copy is outcome-framed and jargon-free. Never say "set crop keyframes" —
 * say "keep your player in the shot." Button references must match the renamed
 * terminal buttons: "Generate AI Focus" (framing) and "Export clip with effects" (overlay) (T9540).
 */

import { Image, Play, Plus, Star, Film, Crosshair, FolderOpen, CheckCircle, Video } from 'lucide-react';
import { SECTION_NAMES, ANNOTATE, EDITOR_PANELS, EXPORT_JOBS } from './displayNames';
import { useTutorialStore } from '../stores/useTutorialStore';

/** Inline icon — small version of the actual UI icon, styled to sit inline with text */
function QIcon({ icon: IconComponent, className = 'text-gray-300' }) {
  return (
    <IconComponent size={12} className={`inline-block align-text-bottom mx-0.5 ${className}`} />
  );
}

/** Detection marker — matches the green squares on the overlay timeline */
function GreenSquare() {
  return (
    <span className="inline-flex items-center justify-center align-text-bottom mx-0.5 w-4 h-4 bg-green-600 rounded border border-green-400">
      <Crosshair size={10} className="text-white" />
    </span>
  );
}

/** Maps each tutorial "watch" step to its quest so the modal can be relaunched
 *  after the step is already complete (see QuestPanel "Watch again"). */
export const TUTORIAL_STEP_QUEST = {
  watch_annotate_tutorial: 'quest_1',
  watch_framing_tutorial: 'quest_2',
  watch_overlay_tutorial: 'quest_3',
  watch_publish_tutorial: 'quest_4',
};

/** T8690: off-by-default gate for the four `watch_*_tutorial` quest steps. When
 *  false, QuestPanel filters these steps (and their WatchTutorialButton CTAs) out
 *  of the checklist entirely — the step rows, current-step highlight, and x/N
 *  counters all derive from the filtered list, so nothing looks "stuck". All the
 *  underlying code (WatchTutorialButton, TutorialVideoModal, useTutorialStore,
 *  TUTORIAL_STEP_QUEST, backend completion tracking) stays intact and unreached;
 *  flip this to true to restore the previous behavior exactly. The steps remain
 *  in quest_config.py's step_ids, so backend completion tracking is unaffected. */
export const TUTORIAL_VIDEOS_ENABLED = false;

/** "Watch tutorial" button — opens TutorialVideoModal for the quest's video.
 *  `variant="primary"` is the unmissable current-step CTA (standalone, pulsing);
 *  the default inline pill is for the low-key "Watch again" replay after done. */
export function WatchTutorialButton({ questId, label = 'Watch tutorial', variant = 'inline' }) {
  if (variant === 'primary') {
    return (
      <button
        type="button"
        onClick={() => useTutorialStore.getState().openTutorial(questId)}
        className="quest-tutorial-pulse w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-purple-600 text-white hover:bg-purple-500 transition-colors cursor-pointer"
      >
        <Video size={15} />
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => useTutorialStore.getState().openTutorial(questId)}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium align-text-bottom mx-0.5 bg-transparent text-purple-400 border border-purple-500/50 hover:bg-purple-500/10 transition-colors cursor-pointer"
    >
      <QIcon icon={Video} className="text-purple-400" />
      {label}
    </button>
  );
}

/** Inline progress chip — mirrors the card's strip: full green Framing, then an
 * Overlay segment on a gray track with blue filling only the bottom half (the
 * "started but not done" shape used on the card) */
function MiniStrip() {
  return (
    <span className="inline-flex align-text-bottom mx-1 w-10 h-2.5 rounded-sm overflow-hidden border border-gray-500">
      <span className="h-full bg-green-500" style={{ width: '75%' }} />
      <span className="relative h-full bg-gray-600" style={{ width: '25%' }}>
        <span className="absolute bottom-0 left-0 w-full bg-blue-400" style={{ height: '50%' }} />
      </span>
    </span>
  );
}

/** Status chip — mirrors the green "Done" badge on a finished Clip card */
function DoneBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium align-text-bottom mx-0.5 bg-green-600/20 text-green-400 border border-green-500/50">
      <CheckCircle size={10} />
      Done
    </span>
  );
}

/** Filled star — matches the yellow rating stars in the clip editor */
function FilledStar() {
  return <Star size={12} className="inline-block align-text-bottom mx-px" fill="#fbbf24" color="#fbbf24" />;
}

/** Inline mini-button — small replica of an actual app button */
function MiniButton({ icon: IconComponent, children, variant = 'purple' }) {
  const colors = {
    purple: 'bg-purple-600 text-white',
    green: 'bg-green-600 text-white',
    cyan: 'bg-transparent text-cyan-400 border border-cyan-500/50',
    gray: 'bg-gray-700 text-white',
  };
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium align-text-bottom mx-0.5 ${colors[variant]}`}>
      {IconComponent && <IconComponent size={10} />}
      {children}
    </span>
  );
}

/** Step titles keyed by step ID — plain strings */
export const STEP_TITLES = {
  // Quest tutorial steps — T4780. T9575: titles are sentence case across the whole
  // checklist; mode/feature proper nouns (Annotate, AI Focus, Spotlight, Publish,
  // Highlight Reels) keep their capitals, the "spotlight" EFFECT stays lowercase.
  watch_annotate_tutorial: 'Watch Annotate tutorial',
  watch_framing_tutorial: 'Watch AI Focus tutorial',
  watch_overlay_tutorial: 'Watch Spotlight tutorial',
  watch_publish_tutorial: 'Watch Publish tutorial',
  // Quest 1 — Get Started
  upload_game: 'Upload your first game',
  add_clip: 'Mark an amazing play',
  rate_clip: 'Rate & tag the play',
  annotate_brilliant: 'Save your play',
  // N40 (T9560): one label in guide, action, AND error — reuse the established
  // "Preview plays" action label (displayNames.ANNOTATE.PREVIEW_PLAYS) instead of a
  // second name ("Watch Your Clips Back") for the same action.
  playback_annotations: ANNOTATE.PREVIEW_PLAYS,
  // Quest 2 — Frame Your Highlight
  return_home: 'Head back home',
  open_framing: 'Open your clip',
  position_crop: 'Keep your player in frame',
  add_slowmo: 'Add a slow-mo moment',
  export_framing: 'Export your highlight',
  wait_for_export: 'Crisp it up to 1080p',
  // Quest 3 — Configure Your Spotlight
  open_overlay: 'Open in Spotlight',
  select_players: 'Pick your player',
  choose_color: 'Pick your spotlight color',
  choose_shape: 'Choose the spotlight shape',
  // Quest 4 — Publish your clip
  export_overlay: EXPORT_JOBS.overlay.action,
  wait_for_overlay: 'Render the spotlight',
  preview_draft: 'Watch your preview',
  move_to_my_reels: `Move to ${SECTION_NAMES.LIBRARY}`,
  view_gallery_video: 'Watch your clip',
};

/** Step descriptions keyed by step ID — JSX with inline icons */
export const STEP_DESCRIPTIONS = {
  // Quest tutorial steps — T4780
  watch_annotate_tutorial: 'Watch how to clip your best plays from a game.',
  watch_framing_tutorial: 'Watch how to put the focus on your player.',
  watch_overlay_tutorial: 'Watch how to spotlight your player on the highlight.',
  watch_publish_tutorial: 'Watch how to publish your finished clip.',
  // Quest 1 — Get Started
  upload_game: 'Upload a game to start marking plays',
  add_clip: <>Find an amazing play, then click <MiniButton icon={Plus} variant="green">{ANNOTATE.MARK_PLAY}</MiniButton> to capture it.</>,
  rate_clip: <>Set start time and end time precisely to isolate the action. Rate the play <span className="whitespace-nowrap"><FilledStar /><FilledStar /><FilledStar /><FilledStar /><FilledStar /></span> and tag it, maybe add a note.</>,
  annotate_brilliant: <>Notice <strong>{ANNOTATE.LAYER_MINE}</strong> and <strong>{ANNOTATE.CREATE_EDITABLE_CLIP}</strong> are switched on. Then <strong>{ANNOTATE.SAVE_PLAY_AND_CLIP}</strong>. We'll create a clip you can edit and share automatically.</>,
  playback_annotations: <>Look under the video player controls and click <MiniButton icon={Play} variant="green">{ANNOTATE.PREVIEW_PLAYS}</MiniButton> to watch your plays</>,
  // Quest 2 — Frame Your Highlight
  return_home: <>Nice clip! Now head back to the home screen, where the clip you just saved is waiting for you to frame it.</>,
  open_framing: <>Switch to <MiniButton icon={FolderOpen} variant="gray">{SECTION_NAMES.CLIPS}</MiniButton> and tap your clip's card to start framing.</>,
  position_crop: <>Drag and resize the box to keep your player <em>and</em> the ball in the shot. If they drift out of frame during playback, hit pause where they are out of frame and move the box again.</>,
  add_slowmo: <>On the bottom <strong>Split Segments</strong> layer of the timeline, click once where your big moment starts and again where it ends. Then set the section between those two splits to <strong>0.5x</strong> for slow-mo. Splitting near a clip's start or end also lets you trim it.</>,
  export_framing: <>Happy with the shot? Click <MiniButton icon={Film}>{EXPORT_JOBS.framing.action}</MiniButton> and we'll render your close-up in crisp 1080p.</>,
  wait_for_export: 'We are upscaling your highlight to crisp 1080p. This takes a minute. Sit tight; next you will add a spotlight to your player on this same clip.',
  // Quest 3 — Spotlight Your Player
  open_overlay: <>Click the clip's card under <strong>{SECTION_NAMES.CLIPS}</strong> to open it in Spotlight mode and add a spotlight to your player. On the card, the progress strip <MiniStrip /> shows AI Focus complete (green) and Spotlight not yet started (blue).</>,
  select_players: <>Click each <GreenSquare /> green marker on the timeline and tap your player. Can't spot them? Drag the circle right onto them.</>,
  choose_color: 'Pick a spotlight color that pops against the jerseys.',
  choose_shape: <>Spotlight around your player, or a glow under them? Pick <strong>{EDITOR_PANELS.SPOTLIGHT_AROUND_PLAYER}</strong> or <strong>{EDITOR_PANELS.SPOTLIGHT_UNDER_PLAYER}</strong>.</>,
  // Quest 4 — Publish your clip
  export_overlay: <>Click <MiniButton>{EXPORT_JOBS.overlay.action}</MiniButton> to render your highlight with the spotlight on your player.</>,
  wait_for_overlay: 'We are rendering your highlight with the spotlight burned in.',
  preview_draft: <>Press play on the <DoneBadge /> Clip to preview your finished clip. Watch it back for a moment to make sure it looks just how you want.</>,
  move_to_my_reels: <>Happy with it? Click <MiniButton variant="cyan"><QIcon icon={Image} className="text-white" />Move to {SECTION_NAMES.LIBRARY}</MiniButton> to publish your clip. If you spot an issue, redo the framing or overlay first.</>,
  view_gallery_video: <>Hit the play button on the card to watch your finished clip. Once it's perfect, you can download and share it.</>,
};
