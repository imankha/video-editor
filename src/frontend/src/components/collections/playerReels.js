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
    // T3940: editable project behind the reel, so the in-player "Re-edit" button
    // can restore + open it. null/0 -> no editable project (button hidden).
    project_id: d.project_id,
    // T4030: single-clip reels are the only rankable pool -- the "Re-rank this"
    // control gates on clip_count === 1 (Mixes/multi-clip never rank).
    clip_count: d.clip_count,
    // T3920: source game + unified in-match start, shown in the player header.
    // Single-clip reels only; null for multi-clip Mixes (no single game/start).
    gameName: d.game_names?.[0] ?? null,
    gameStartTime: d.clip_game_start_time ?? null,
  };
}

export const toPlayerReels = (items) => items.map(toPlayerReel);
