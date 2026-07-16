import { useQuestStore } from '../stores/questStore';

// T5185: the rate_clip quest step ("Rate & Tag the Play") completes the moment a clip
// has BOTH a star rating (>=1) AND at least one tag — regardless of which gesture
// completes the pair, and regardless of which annotate UI (sidebar editor vs
// fullscreen/mobile overlay) the user is in. Call this from every rating/tag change
// handler with the clip's post-change rating and tags.
export function maybeRecordRatedAndTagged(rating, tags) {
  if (rating >= 1 && (tags?.length ?? 0) >= 1) {
    useQuestStore.getState().recordAchievement('clip_rated');
  }
}
