export const QUEST_DEFINITIONS = [
  {
    id: 'quest_1',
    title: 'Get Started',
    reward: 15,
    step_ids: [
      'upload_game',
      'add_clip',
      'annotate_brilliant',
      'playback_annotations',
    ],
  },
  {
    id: 'quest_2',
    title: 'Frame Your Highlight',
    reward: 25,
    step_ids: [
      'open_framing',
      'position_crop',
      'add_slowmo',
      'export_framing',
      'wait_for_export',
    ],
  },
  {
    id: 'quest_3',
    title: 'Configure Your Spotlight',
    reward: 25,
    step_ids: [
      'open_overlay',
      'select_players',
      'choose_color',
      'choose_shape',
    ],
  },
  {
    id: 'quest_4',
    title: 'Publish Your Reel',
    reward: 15,
    step_ids: [
      'export_overlay',
      'wait_for_overlay',
      'move_to_my_reels',
      'view_gallery_video',
    ],
  },
];
