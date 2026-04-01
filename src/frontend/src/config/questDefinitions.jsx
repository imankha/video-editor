/**
 * Quest Definitions — data-driven config for the quest system (T540).
 *
 * Single source of truth for quest structure. Adding/removing/reordering steps
 * means editing this config only. Backend has matching step_ids for progress derivation.
 *
 * Descriptions use JSX with inline icons — small versions of the actual UI icons
 * so users can visually match what they see in the quest panel to the app UI.
 */

import { Home, Image, Play, Plus, Star, Crop, Film, Crosshair } from 'lucide-react';

/** Inline icon — small version of the actual UI icon, styled to sit inline with text */
function QIcon({ icon: IconComponent, className = 'text-gray-300' }) {
  return (
    <IconComponent size={12} className={`inline-block align-text-bottom mx-0.5 ${className}`} />
  );
}

/** Detection marker — matches the green squares on the overlay timeline (bg-green-600, rounded, Crosshair icon) */
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

export const QUESTS = [
  {
    id: 'quest_1',
    title: 'Get Started',
    reward: 15,
    steps: [
      {
        id: 'upload_game',
        title: 'Add Your First Game',
        description: 'Add a game to start clipping highlights',
      },
      {
        id: 'annotate_brilliant',
        title: 'Annotate a 5 Star Play',
        description: <>When you spot a great play, click <MiniButton icon={Plus} variant="green">Add Clip</MiniButton> and rate it <FilledStar /><FilledStar /><FilledStar /><FilledStar /><FilledStar /></>,
      },
      {
        id: 'playback_annotations',
        title: 'Watch Your Clips Back',
        description: <>Scroll down in the sidebar and click <MiniButton icon={Play} variant="green">Playback Annotations</MiniButton> to watch your clips back-to-back.</>,
      },
    ],
  },
  {
    id: 'quest_2',
    title: 'Export Highlights',
    reward: 25,
    steps: [
      {
        id: 'open_framing',
        title: 'Open a Project',
        description: <>Click <QIcon icon={Home} className="text-white" /> Home → Projects and select a project.</>,
      },
      {
        id: 'export_framing',
        title: 'Frame Video',
        description: <>Drag and resize the <QIcon icon={Crop} className="text-yellow-300" /> crop box around your player at different keyframes so your player stays in view.</>,
      },
      {
        id: 'wait_for_export',
        title: 'Wait For Export',
        description: 'Wait for the framing export to finish. We AI upscale your video to crisp 1080p.',
      },
      {
        id: 'export_overlay',
        title: 'Spotlight Your Player',
        description: <>Click the <GreenSquare /> green squares on the timeline, then click on your player in the video if you can. If not, move the ellipse around your player and size it manually. When done, click <MiniButton>Add Overlay</MiniButton>.</>,
      },
      {
        id: 'view_gallery_video',
        title: 'Watch Your Highlight',
        description: <>Click <QIcon icon={Image} className="text-white" /> Gallery in the top bar to find your finished video.</>,
      },
    ],
  },
  {
    id: 'quest_3',
    title: 'Annotate More Clips',
    reward: 40,
    steps: [
      {
        id: 'annotate_second_5_star',
        title: 'Find Another 5 Star Moment',
        description: 'Every game has more than one highlight — find it!',
      },
      {
        id: 'annotate_5_more',
        title: 'Annotate More Clips',
        description: 'Annotate more clips, try to get every touch that could be a learning or celebration.',
      },
      {
        id: 'export_second_highlight',
        title: 'Export Another Highlight',
        description: <>Pick a project, crop it along the timeline and then click <MiniButton icon={Film}>Frame Video</MiniButton> to frame it.</>,
      },
      {
        id: 'wait_for_export_2',
        title: 'Wait For Export',
        description: 'Wait for the framing export to finish.',
      },
      {
        id: 'overlay_second_highlight',
        title: 'Spotlight Your Player',
        description: <>Click the <GreenSquare /> green squares on the timeline, then click on your player in the video if you can. If not, move the ellipse around your player and size it manually. When done, click <MiniButton>Add Overlay</MiniButton>.</>,
      },
      {
        id: 'watch_second_highlight',
        title: 'Watch Your Highlight',
        description: <>Click <QIcon icon={Image} className="text-white" /> Gallery in the top bar to find your finished video.</>,
      },
    ],
  },
  {
    id: 'quest_4',
    title: 'Highlight Reel',
    reward: 45,
    steps: [
      {
        id: 'upload_game_2',
        title: 'Add a Second Game',
        description: 'Add another game — more highlights, bigger reel!',
      },
      {
        id: 'annotate_game_2',
        title: 'Annotate a Good or Great Play',
        description: <>Find a <FilledStar /><FilledStar /><FilledStar /><FilledStar /> or <FilledStar /><FilledStar /><FilledStar /><FilledStar /><FilledStar /> moment in your new game.</>,
      },
      {
        id: 'create_reel',
        title: 'Create a Highlight Reel',
        description: <>Click <QIcon icon={Home} className="text-white" /> Home → Projects → <MiniButton icon={Plus}>New Project</MiniButton>. Pick your best clips from both games.</>,
      },
      {
        id: 'export_reel',
        title: 'Frame Your Reel',
        description: <>Frame your multi-clip highlight reel and click <MiniButton icon={Film}>Frame Video</MiniButton>.</>,
      },
      {
        id: 'wait_for_reel',
        title: 'Wait For Export',
        description: 'Wait for the export to finish.',
      },
      {
        id: 'watch_reel',
        title: 'Watch Your Reel',
        description: <>Your highlight reel is ready! Click <QIcon icon={Image} className="text-white" /> Gallery to watch and download it.</>,
      },
    ],
  },
];

/** Total number of steps across all quests */
export const TOTAL_STEPS = QUESTS.reduce((sum, q) => sum + q.steps.length, 0);
