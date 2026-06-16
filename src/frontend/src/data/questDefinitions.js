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
  {
    id: 'quest_4',
    title: 'Make More Highlights',
    reward: 40,
    step_ids: [
      'annotate_second_5_star',
      'annotate_5_more',
      'frame_second_highlight',
      'wait_for_export_2',
      'spotlight_second_highlight',
      'watch_second_highlight',
    ],
  },
];
