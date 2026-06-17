export const QUEST_DEFINITIONS = [
  {
    id: 'quest_1',
    title: 'Get Started',
    reward: 15,
    step_ids: [
      'upload_game',
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
    title: 'Spotlight Your Player',
    reward: 25,
    step_ids: [
      'open_overlay',
      'select_players',
      'choose_color',
      'choose_shape',
      'export_overlay',
      'view_gallery_video',
    ],
  },
];
