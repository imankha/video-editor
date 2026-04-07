/**
 * Quest Step UI — JSX descriptions and titles keyed by step ID (T540, T1000).
 *
 * Quest structure (IDs, rewards, step order) comes from the backend via
 * GET /api/quests/definitions. This file only holds the UI layer: step titles
 * and rich JSX descriptions with inline icons that can't be serialized over API.
 */

import { Home, Image, Play, Plus, Star, Crop, Film, Crosshair, Gamepad2 } from 'lucide-react';

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
  upload_game: 'Add Your First Game',
  annotate_brilliant: 'Annotate a 5 Star Play',
  playback_annotations: 'Watch Your Clips Back',
  open_framing: 'Open a Project',
  export_framing: 'Frame Video',
  wait_for_export: 'Wait For Export',
  export_overlay: 'Spotlight Your Player',
  view_gallery_video: 'Watch Your Highlight',
  annotate_second_5_star: 'Find Another 5 Star Moment',
  annotate_5_more: 'Annotate More Clips',
  export_second_highlight: 'Export Another Highlight',
  wait_for_export_2: 'Wait For Export',
  overlay_second_highlight: 'Spotlight Your Player',
  watch_second_highlight: 'Watch Your Highlight',
  upload_game_2: 'Add a Second Game',
  annotate_game_2: 'Annotate a Good or Great Play',
  create_reel: 'Create a Highlight Reel',
  export_reel: 'Frame Your Reel',
  wait_for_reel: 'Wait For Export',
  overlay_reel: 'Spotlight Your Player',
  watch_reel: 'Watch Your Reel',
};

/** Step descriptions keyed by step ID — JSX with inline icons */
export const STEP_DESCRIPTIONS = {
  upload_game: 'Add a game to start clipping highlights',
  annotate_brilliant: <>When you spot a great play, click <MiniButton icon={Plus} variant="green">Add Clip</MiniButton> and rate it <FilledStar /><FilledStar /><FilledStar /><FilledStar /><FilledStar /></>,
  playback_annotations: <>Look under the video player controls and click <MiniButton icon={Play} variant="green">Playback Annotations</MiniButton> to watch your annotated clips</>,
  open_framing: <>Click <QIcon icon={Home} className="text-white" /> Home → Projects and select a project.</>,
  export_framing: <>Drag and resize the <QIcon icon={Crop} className="text-yellow-300" /> crop box around your player at different keyframes so your player stays in view. When ready, click <MiniButton icon={Film} variant="purple">Frame Video</MiniButton>.</>,
  wait_for_export: 'Wait for the framing export to finish. We AI upscale your video to crisp 1080p.',
  export_overlay: <>Click each <GreenSquare /> green square on the timeline, and for each green square click on your player in the video if you can. If you can't, move the ellipse around your player manually. When done, click <MiniButton>Add Overlay</MiniButton>.</>,
  view_gallery_video: <>Click <QIcon icon={Image} className="text-white" /> Gallery in the top bar to find your finished video.</>,
  annotate_second_5_star: <>Go to <QIcon icon={Gamepad2} className="text-green-400" /> Games, click into your game and find and annotate another 5 star moment.</>,
  annotate_5_more: 'Annotate more clips, try to get every touch that could be a learning or celebration.',
  export_second_highlight: <>Pick a project, crop it along the timeline and then click <MiniButton icon={Film}>Frame Video</MiniButton> to frame it.</>,
  wait_for_export_2: 'Wait for the framing export to finish.',
  overlay_second_highlight: <>Click each <GreenSquare /> green square on the timeline, and for each green square click on your player in the video if you can. If you can't, move the ellipse around your player manually. When done, click <MiniButton>Add Overlay</MiniButton>.</>,
  watch_second_highlight: <>Click <QIcon icon={Image} className="text-white" /> Gallery in the top bar to find your finished video.</>,
  upload_game_2: 'Add another game — more highlights, better reel!',
  annotate_game_2: <>Find a <FilledStar /><FilledStar /><FilledStar /><FilledStar /> or <FilledStar /><FilledStar /><FilledStar /><FilledStar /><FilledStar /> moment in your new game.</>,
  create_reel: <>Click <QIcon icon={Home} className="text-white" /> Home → Projects → <MiniButton icon={Plus}>New Project</MiniButton>. Pick your best clips from both games.</>,
  export_reel: <>Frame your multi-clip highlight reel and click <MiniButton icon={Film}>Frame Video</MiniButton>.</>,
  wait_for_reel: 'Wait for the export to finish.',
  overlay_reel: <>Click each <GreenSquare /> green square on the timeline, and for each green square click on your player in the video if you can. If you can't, move the ellipse around your player manually. When done, click <MiniButton>Add Overlay</MiniButton>.</>,
  watch_reel: <>Your highlight reel is ready! Click <QIcon icon={Image} className="text-white" /> Gallery to watch and download it.</>,
};
