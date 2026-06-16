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
    title: 'Export Highlights',
    reward: 25,
    step_ids: [
      'open_framing',
      'export_framing',
      'wait_for_export',
      'export_overlay',
      'view_gallery_video',
    ],
  },
  {
    id: 'quest_3',
    title: 'Annotate More Clips',
    reward: 40,
    step_ids: [
      'annotate_second_5_star',
      'annotate_5_more',
      'export_second_highlight',
      'wait_for_export_2',
      'overlay_second_highlight',
      'watch_second_highlight',
    ],
  },
];
