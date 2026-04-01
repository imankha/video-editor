/**
 * Quest Definitions — data-driven config for the quest system (T540).
 *
 * Single source of truth for quest structure. Adding/removing/reordering steps
 * means editing this config only. Backend has matching step_ids for progress derivation.
 *
 * Descriptions use JSX with inline icons — small versions of the actual UI icons
 * so users can visually match what they see in the quest panel to the app UI.
 */

import { Home, Image, Play } from 'lucide-react';

/** Inline icon — small version of the actual UI icon, styled to sit inline with text */
function QIcon({ icon: IconComponent, className = 'text-gray-300' }) {
  return (
    <IconComponent size={12} className={`inline-block align-text-bottom mx-0.5 ${className}`} />
  );
}

/** Green square marker — matches the overlay timeline keyframe markers */
function GreenSquare() {
  return <span className="inline-block align-text-bottom mx-0.5 w-2.5 h-2.5 bg-green-500 rounded-sm" />;
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
        description: 'When you spot a great play, click Add Clip and rate it 5 stars.',
      },
      {
        id: 'playback_annotations',
        title: 'Watch Your Clips Back',
        description: <>Scroll down in the sidebar and click the green <QIcon icon={Play} className="text-green-400" /> Play button to watch your clips back-to-back.</>,
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
        description: 'Drag and resize the crop box around your player at different keyframes so your player stays in view.',
      },
      {
        id: 'wait_for_export',
        title: 'Wait For Export',
        description: 'Wait for the framing export to finish. We AI upscale your video to crisp 1080p.',
      },
      {
        id: 'export_overlay',
        title: 'Spotlight Your Player',
        description: <>Click the <GreenSquare /> green squares on the timeline, then click on your player in the video if you can. If not, move the ellipse around your player and size it manually. When done, click "Add Overlay".</>,
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
        description: 'Pick a project, and click "Frame Video" to frame it.',
      },
      {
        id: 'wait_for_export_2',
        title: 'Wait For Export',
        description: 'Wait for the framing export to finish.',
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
        description: 'Find a 4 or 5 star moment in your new game.',
      },
      {
        id: 'create_reel',
        title: 'Create a Highlight Reel',
        description: <>Click <QIcon icon={Home} className="text-white" /> Home → Projects → New Project. Pick your best clips from both games.</>,
      },
      {
        id: 'export_reel',
        title: 'Frame Your Reel',
        description: 'Frame your multi-clip highlight reel and click "Frame Video".',
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
