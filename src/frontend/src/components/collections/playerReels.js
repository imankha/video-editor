import { API_BASE } from '../../config';

/**
 * Map a download item to a presentational player reel (T3610). Single source of
 * truth so the reel "Play" and collection "Play all" paths feed the SAME player
 * with the same shape. T3620 swaps in presigned URLs; here we use the
 * same-origin stream proxy.
 */
export function toPlayerReel(d) {
  return {
    id: d.id,
    name: d.project_name,
    streamUrl: `${API_BASE}/api/downloads/${d.id}/stream`,
    aspect_ratio: d.aspect_ratio,
    duration: d.duration, // may be null; the player never relies on it
  };
}

export const toPlayerReels = (items) => items.map(toPlayerReel);
