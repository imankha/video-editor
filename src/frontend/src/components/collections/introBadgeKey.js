// T5215 round 3 — the canonical lookup key for a collection's batch-resolved
// intro badge. Mirrors the backend's `collection_intro_settings_key`
// (services/intro_cards.py) exactly — the batch endpoint echoes this SAME
// key format per result, so the client can look a card's badge up by key
// instead of trusting array position. Kept in step by hand (small, stable
// shape); if it drifts, the batch response's own `key` field is still the
// source of truth returned per item.
export function collectionIntroKey({ scope, filter, aspect_ratio }) {
  let base;
  if (scope.type === 'game') base = `game:${scope.game_id}`;
  else if (scope.type === 'mixes') base = 'mixes';
  else if (filter?.tags?.length) base = `tags:${[...filter.tags].sort().join(',')}`;
  else base = 'all';
  return `intro:${base}:${aspect_ratio}`;
}
