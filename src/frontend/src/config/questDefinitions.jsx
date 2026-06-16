/**
 * Quest Step UI — JSX descriptions and titles keyed by step ID (T540, T1000, T3700).
 *
 * Quest structure (IDs, rewards, step order) comes from the backend via
 * GET /api/quests/definitions. This file only holds the UI layer: step titles
 * and rich JSX descriptions with inline icons that can't be serialized over API.
 *
 * T3700: copy is outcome-framed and jargon-free. Never say "set crop keyframes" —
 * say "keep your player in the shot." Button references must match the renamed
 * terminal buttons: "Export Highlight" (framing) and "Add Spotlight" (overlay).
 */

import { Home, Image, Play, Plus, Star, Film, Crosshair, Gamepad2 } from 'lucide-react';
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
  annotate_brilliant: 'Create a Reel',
  playback_annotations: 'Watch Your Clips Back',
  // Quest 2 — Frame Your Highlight
  open_framing: 'Open Your Reel',
  position_crop: 'Keep Your Player in Frame',
  add_slowmo: 'Add a Slow-Mo Moment',
  export_framing: 'Export Your Highlight',
  wait_for_export: 'Crisp It Up to 1080p',
  // Quest 3 — Spotlight Your Player
  open_overlay: 'Open the Spotlight',
  select_players: 'Pick Your Player',
  choose_color: 'Pick Your Highlight Color',
  choose_shape: 'Choose the Spotlight Shape',
  export_overlay: 'Add the Spotlight',
  view_gallery_video: 'Move to Library & Watch',
  // Quest 4 — Make More Highlights
  annotate_second_5_star: 'Create Another Reel',
  annotate_5_more: 'Annotate More Clips',
  frame_second_highlight: 'Frame Another Video',
  wait_for_export_2: 'Wait for the Export',
  spotlight_second_highlight: 'Spotlight Your Player Again',
  watch_second_highlight: 'Move to Library & Watch',
};

/** Step descriptions keyed by step ID — JSX with inline icons */
export const STEP_DESCRIPTIONS = {
  // Quest 1 — Get Started
  upload_game: 'Add a game to start clipping highlights',
  annotate_brilliant: <>You can automatically create a reel by annotating a <FilledStar /><FilledStar /><FilledStar /><FilledStar /><FilledStar /> play for your player. Click <MiniButton icon={Plus} variant="green">Add Clip</MiniButton> and rate it 5 stars with My Athlete on.</>,
  playback_annotations: <>Look under the video player controls and click <MiniButton icon={Play} variant="green">Playback Annotations</MiniButton> to watch your annotated clips</>,
  // Quest 2 — Frame Your Highlight
  open_framing: <>Click <MiniButton variant="cyan"><QIcon icon={Home} className="text-white" />Open your reel</MiniButton> to jump straight into framing.</>,
  position_crop: <>Drag the box to keep your player <em>and</em> the ball in the shot. If they drift out of frame later, scrub ahead and move the box again — that's all there is to it.</>,
  add_slowmo: <>Make the big moment shine: tap the timeline to split a section over it, then set that section to <strong>0.5x slow-mo</strong>.</>,
  export_framing: <>Happy with the shot? Click <MiniButton icon={Film}>Export Highlight</MiniButton> and we'll AI-upscale it to crisp 1080p.</>,
  wait_for_export: 'Hang tight — we are upscaling your highlight to crisp 1080p.',
  // Quest 3 — Spotlight Your Player
  open_overlay: 'Now let us spotlight your player. We open this for you right after your highlight finishes exporting.',
  select_players: <>Click each <GreenSquare /> green marker on the timeline and tap your player. Can't spot them? Drag the circle right onto them.</>,
  choose_color: 'Pick a highlight color that pops against the jerseys.',
  choose_shape: 'Spotlight around your player, or a glow on the ground? Pick Body or Ground.',
  export_overlay: <>Click <MiniButton>Add Spotlight</MiniButton> to render your highlight with the spotlight on your player.</>,
  view_gallery_video: <>Click <MiniButton variant="cyan"><QIcon icon={Image} className="text-white" />Move to {SECTION_NAMES.LIBRARY}</MiniButton> on your finished reel, then open <MiniButton variant="cyan"><QIcon icon={Image} className="text-white" />{SECTION_NAMES.LIBRARY}</MiniButton> in the top bar to watch it.</>,
  // Quest 4 — Make More Highlights (compressed; the user already learned each sub-step)
  annotate_second_5_star: <>Go to <QIcon icon={Gamepad2} className="text-green-400" /> Games, click into your game and create another reel by annotating a <FilledStar /><FilledStar /><FilledStar /><FilledStar /><FilledStar /> play for your player.</>,
  annotate_5_more: 'Annotate more clips — try to catch every touch that could be a learning or a celebration.',
  frame_second_highlight: <>Pick a reel, frame your player and click <MiniButton icon={Film}>Export Highlight</MiniButton>.</>,
  wait_for_export_2: 'Wait for the export to finish.',
  spotlight_second_highlight: <>Spotlight your player again, then click <MiniButton>Add Spotlight</MiniButton>.</>,
  watch_second_highlight: <>Click <MiniButton variant="cyan"><QIcon icon={Image} className="text-white" />Move to {SECTION_NAMES.LIBRARY}</MiniButton> on your finished reel, then open {SECTION_NAMES.LIBRARY} to watch it.</>,
};
