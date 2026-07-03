/**
 * Quest Step UI — JSX descriptions and titles keyed by step ID (T540, T1000, T3700).
 *
 * Quest structure (IDs, rewards, step order) comes from the backend via
 * GET /api/quests/definitions. This file only holds the UI layer: step titles
 * and rich JSX descriptions with inline icons that can't be serialized over API.
 *
 * T3700: copy is outcome-framed and jargon-free. Never say "set crop keyframes" —
 * say "keep your player in the shot." Button references must match the renamed
 * terminal buttons: "Export" (framing) and "Add Spotlight" (overlay).
 */

import { Image, Play, Plus, Star, Film, Crosshair, Folder, CheckCircle } from 'lucide-react';
import { SECTION_NAMES } from './displayNames';

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

/**
 * "Open your reel" deep link — sends the parent straight to the Reel Drafts
 * (Home) screen so they can tap their reel, instead of describing the clicks.
 *
 * Reuses the app's existing Home navigation: it points the URL at /home and
 * fires the same popstate handler the browser back-button uses (registered in
 * editorStore). That handler owns the clearSelection / fetchProjects / video
 * reset side effects, so we don't duplicate a parallel nav path here.
 */
function navigateToReelDrafts() {
  if (window.location.pathname !== '/home') {
    window.history.pushState({ mode: 'project-manager' }, '', '/home');
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Clickable "Open your reel" pill — styled like the cyan section buttons */
function OpenReelLink() {
  return (
    <button
      type="button"
      onClick={navigateToReelDrafts}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium align-text-bottom mx-0.5 bg-transparent text-cyan-400 border border-cyan-500/50 hover:bg-cyan-500/10 transition-colors cursor-pointer"
    >
      <QIcon icon={Folder} className="text-cyan-400" />
      Open your reel
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

/** Status chip — mirrors the green "Done" badge on a finished Reel Draft card */
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
  // Quest 1 — Get Started
  upload_game: 'Add Your First Game',
  add_clip: 'Find an Amazing Play',
  annotate_brilliant: 'Rate 5 Stars & Save',
  playback_annotations: 'Watch Your Clips Back',
  // Quest 2 — Frame Your Highlight
  open_framing: 'Open Your Reel',
  position_crop: 'Keep Your Player in Frame',
  add_slowmo: 'Add a Slow-Mo Moment',
  export_framing: 'Export Your Highlight',
  wait_for_export: 'Crisp It Up to 1080p',
  // Quest 3 — Configure Your Spotlight
  open_overlay: 'Open in Overlay',
  select_players: 'Pick Your Player',
  choose_color: 'Pick Your Highlight Color',
  choose_shape: 'Choose the Spotlight Shape',
  // Quest 4 — Publish Your Reel
  export_overlay: 'Add the Spotlight',
  wait_for_overlay: 'Render the Spotlight',
  move_to_my_reels: 'Move to My Reels',
  view_gallery_video: 'Watch Your Reel',
};

/** Step descriptions keyed by step ID — JSX with inline icons */
export const STEP_DESCRIPTIONS = {
  // Quest 1 — Get Started
  upload_game: 'Add a game to start clipping highlights',
  add_clip: <>Find an amazing play, then click <MiniButton icon={Plus} variant="green">Add Clip</MiniButton> to start a highlight.</>,
  annotate_brilliant: <>Set start time and end time precisely to isolate the action. Rate the play <FilledStar /><FilledStar /><FilledStar /><FilledStar /><FilledStar /> and tag it, maybe add a note. Notice <strong>My Athlete</strong> and <strong>Create Reel</strong> are switched on. Then <strong>Save</strong>. We'll create a reel you can edit and share automatically.</>,
  playback_annotations: <>Look under the video player controls and click <MiniButton icon={Play} variant="green">Playback Annotations</MiniButton> to watch your annotated clips</>,
  // Quest 2 — Frame Your Highlight
  open_framing: <>Your reel is waiting in {SECTION_NAMES.DRAFTS}. <OpenReelLink /> then tap its card to start framing.</>,
  position_crop: <>Drag and resize the box to keep your player <em>and</em> the ball in the shot. If they drift out of frame during playback, hit pause where they are out of frame and move the box again.</>,
  add_slowmo: <>On the bottom <strong>Split Segments</strong> layer of the timeline, click once where your big moment starts and again where it ends. Then set the section between those two splits to <strong>0.5x</strong> for slow-mo. (Splitting near a clip's start or end also lets you trim it.)</>,
  export_framing: <>Happy with the shot? Click <MiniButton icon={Film}>Export</MiniButton> and we'll AI-upscale it to crisp 1080p.</>,
  wait_for_export: 'We are upscaling your highlight to crisp 1080p. Feel free to go back home and frame your next reel while you wait.',
  // Quest 3 — Spotlight Your Player
  open_overlay: <>Click the reel's card under <strong>{SECTION_NAMES.DRAFTS}</strong> to open it in Overlay mode and add a spotlight to your player. On the card, the progress strip <MiniStrip /> shows Framing complete (green) and Overlay not yet started (blue).</>,
  select_players: <>Click each <GreenSquare /> green marker on the timeline and tap your player. Can't spot them? Drag the circle right onto them.</>,
  choose_color: 'Pick a highlight color that pops against the jerseys.',
  choose_shape: 'Spotlight around your player, or a glow on the ground? Pick Body or Ground.',
  // Quest 4 — Publish Your Reel
  export_overlay: <>Click <MiniButton>Add Spotlight</MiniButton> to render your highlight with the spotlight on your player.</>,
  wait_for_overlay: 'We are rendering your highlight with the spotlight burned in.',
  move_to_my_reels: <>Press play on the <DoneBadge /> Reel Draft to preview your draft reel. Happy with it? Click <MiniButton variant="cyan"><QIcon icon={Image} className="text-white" />Move to {SECTION_NAMES.LIBRARY}</MiniButton> to publish your reel. If you spot an issue, redo the framing or overlay first.</>,
  view_gallery_video: <>Hit the play button on the card to watch your finished reel. Once it's perfect, you can download and share it.</>,
};
