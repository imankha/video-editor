/**
 * Quest Definitions — data-driven config for the quest system (T540).
 *
 * Single source of truth for quest structure. Adding/removing/reordering steps
 * means editing this config only. Backend has matching step_ids for progress derivation.
 */

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
        title: 'Playback Annotations',
        description: 'Review the annotations you made with your athlete',
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
        description: 'Go Home, then go to Projects, then select a project',
      },
      {
        id: 'export_framing',
        title: 'Frame Video',
        description: 'Crop, trim, and slow down segments to frame your clip. Then click "Frame Video".',
      },
      {
        id: 'wait_for_export',
        title: 'Wait For Export',
        description: 'Wait for the framing export to finish. We AI upscale your video to crisp 1080p.',
      },
      {
        id: 'export_overlay',
        title: 'Add Highlight Overlays',
        description: 'Click on each of the green keyframes, then put the spotlight around your player by either clicking the box or moving the spotlight. Once all keyframes have a spotlight, click Add Overlay',
      },
      {
        id: 'view_gallery_video',
        title: 'Watch Your Highlight',
        description: 'Open the Gallery and play back your completed highlight reel',
      },
    ],
  },
  {
    id: 'quest_3',
    title: 'Find More Highlights',
    reward: 40,
    steps: [
      {
        id: 'annotate_5_more',
        title: 'Clip 5 More Plays',
        description: 'Go back to your game and clip 5 more plays — any rating.',
      },
      {
        id: 'annotate_second_5_star',
        title: 'Find Another 5 Star Moment',
        description: 'Every game has more than one highlight — find it!',
      },
      {
        id: 'export_second_highlight',
        title: 'Export Another Highlight',
        description: 'Pick any 5-star project, frame it, and click "Frame Video".',
      },
      {
        id: 'wait_for_export_2',
        title: 'Wait For Export',
        description: 'Wait for the framing export to finish.',
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
        description: 'Go to Projects → New Project. Pick clips from both games to build your reel.',
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
        description: 'Open the Gallery and watch your finished highlight reel!',
      },
    ],
  },
];

/** Total number of steps across all quests */
export const TOTAL_STEPS = QUESTS.reduce((sum, q) => sum + q.steps.length, 0);
