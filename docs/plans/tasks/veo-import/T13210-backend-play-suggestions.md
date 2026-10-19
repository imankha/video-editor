# T13210: Backend: play suggestions table + import / shift / accept / dismiss endpoints

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Tier:** L (schema change, new profile_db table + migration, new endpoints; Architect design gate)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Epic:** [Veo Highlights Import](EPIC.md) (Path A; depends on decision V1 = (a))

## Problem

Path A turns a Veo zip into ~35 moments on a game. They must survive reloads and devices, must not
be plays (no Watch plays, recap, extracts, counts, sharing, Keep Only Marked Plays), and must
become a real play only through a named gesture.

## Solution (EPIC.md "Path A" has the schema sketch; the Architect finalizes)

- profile_db migration (next free version at implementation; T12920 claims v057, check
  `migrations/profile_db/` and origin at start): `play_suggestions` table as in EPIC.md, plus the
  same DDL in `ensure_database()`.
- `GET /api/games/{id}/load` (or a sibling endpoint, Architect's call) returns open/accepted/dismissed
  suggestions. Read-only.
- `POST /api/games/{id}/suggestions` body `{source:'veo_zip', video_sequence, moments:[{start, end, labels}]}`
  -> new `import_id`; idempotent per `(game_id, source, start_time, labels)`; refuses a plays-only game
  (Keep Only Marked Plays) and a game whose video `video_sequence` does not exist or is shorter than the last `end`.
- `PATCH /api/games/{id}/suggestions/shift` `{import_id, delta_s}` (one surgical UPDATE).
- `POST /api/suggestions/{id}/accept` `{raw_clip_id}` after the client created the play through the
  existing `POST /api/clips/raw/save` (single write path for plays stays unchanged), or a combined
  endpoint calling `save_raw_clip` internally; Architect picks, justifying the single-write-path rule.
- `PATCH /api/suggestions/{id}` `{state: 'dismissed'|'open'}`; `DELETE /api/games/{id}/suggestions?import_id=`.
- All writes `durable_sync`, each traced to one gesture. Nothing reactive.
- Raw clip delete sets `raw_clip_id` NULL and the suggestion back to `open` (FK `ON DELETE SET NULL`
  plus explicit state update in the delete handler, decide which).
- Privacy export / account delete / game delete: cascade covers it; confirm the privacy export lists it.

## Acceptance

1. Migration: fresh DB and a v-head DB both end with the table; JIT seam test.
2. Import twice with the same payload -> one set of rows.
3. Shift moves only that import's rows; accept links the play; deleting the play reopens the suggestion.
4. Suggestions never appear in `recap-data`, `_get_annotated_clips`, game counts, share payloads (test).
5. Plays-only game refuses import (once T12920 lands; otherwise a TODO guard test noted in the PR).

## Knowledge docs
`.claude/knowledge/backend-services.md`, `.claude/knowledge/annotate.md`, `.claude/knowledge/persistence-sync.md`. Include the Migration agent.
