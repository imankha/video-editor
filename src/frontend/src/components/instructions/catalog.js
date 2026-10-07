import { EMPTY_TAB_GUIDE } from '../../config/emptyStates';
export { FRAMING_GUIDE, EDITOR_PANELS } from '../../config/displayNames';
export const HOME_COACH = EMPTY_TAB_GUIDE;
export const ANNOTATE_COACH = {
  first: { title: 'Play the game. Mark the moments worth keeping.', body: 'Press Mark play after a great moment. We save the moment around your tap.' },
  marking: { title: 'Keep marking the moments worth saving.', body: 'Rate a play Brilliant when you want to turn it into a highlight.' },
  brilliant: { title: 'Brilliant play. Make a portrait highlight.', body: 'Focus the video on your player, ready to share.' },
  portrait: { title: 'Continue your portrait highlight.', body: 'Finish framing your player, then add Spotlight if you want.' },
  spotlight: { title: 'Your portrait highlight is ready.', body: 'Add Spotlight to make your player stand out.' },
};
export function annotateCoachModel(region, instances, hasPlays) {
  const portrait = instances?.find(i => i.orientation === 'portrait' && i.projectId != null);
  if (region?.rating === 5) return { ...ANNOTATE_COACH[portrait ? (portrait.action === 'overlay' ? 'spotlight' : 'portrait') : 'brilliant'], phase: portrait ? 'portrait' : 'brilliant', portrait };
  return { ...ANNOTATE_COACH[hasPlays ? 'marking' : 'first'], phase: hasPlays ? 'marking' : 'first' };
}
