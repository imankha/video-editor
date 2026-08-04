# T5195: Intro card library — schema, CRUD, default

**Status:** TODO
**Impact:** 7 | **Complexity:** 4
**Epic:** [Player Intro + Rich Text](EPIC.md) — depends on [T5180](T5180-rich-text-engine.md) + [T5190](T5190-card-image-upload-consent.md)

> Read [EPIC.md](EPIC.md) (decisions 7 and 8). Knowledge docs: `.claude/knowledge/persistence-sync.md`,
> `.claude/knowledge/backend-services.md` (migration tracks), `.claude/knowledge/export-pipeline.md`
> (`final_videos` writers — this task adds a column they must carry).

## Problem

The user needs to **create and store N intro cards**. Nothing in the codebase stores a card: the
original epic derived a single card from profile fields. This task is the storage layer and its API
— no editor UI (that is [T5205](T5205-card-editor-ui.md)) and no rendering (that is
[T5210](T5210-intro-card-generation.md)).

## Scope

### A. Schema — profile_db **v034**

New table in the per-profile SQLite (epic decision 7 — a card names one athlete, and its image must
live under the per-profile R2 prefix; keeping the row beside the media removes the split):

```sql
CREATE TABLE IF NOT EXISTS intro_cards (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,        -- library label; NEVER rendered into the video
    template          TEXT NOT NULL,        -- 'hero-left' | 'full-bleed' | 'title-only'
    image_key         TEXT,                 -- R2 key from T5190
    image_cutout_key  TEXT,                 -- nullable, set by T5200
    text_elements     BLOB,                 -- msgpack: { slot_name: TextSpec }
    duration          REAL NOT NULL DEFAULT 4.0,
    is_default        INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT DEFAULT (datetime('now')),
    updated_at        TEXT DEFAULT (datetime('now'))
);
```

Plus `ALTER TABLE final_videos ADD COLUMN intro_card_id INTEGER` — added here (one migration, one
deploy window) even though [T5215](T5215-intro-attachment.md) owns its behaviour.

- **`NULL` vs `0` on `intro_card_id` carry different meanings** (epic decision 8): NULL = inherit
  the profile default; 0 = the user explicitly chose no intro for this reel. Encode this in the
  column comment, the helper, and the tests — a later reader WILL collapse them otherwise.
- Add the same DDL to `database.py::ensure_database()` so fresh profiles get it without the migration.
- **Version check before writing:** confirm v034 is still free (profile_db head was v033 on
  2026-08-03) and check unmerged sibling branches — duplicate versions are silently skipped by the
  runner (see memory: migration version collision across branches).
- **Migration-window guard:** anything reading `final_videos.intro_card_id` on a hot path must
  `column_exists`-guard it (the T5630 `_has_stage_columns` / T6030 `_has_slowmo` pattern). A
  below-head profile DB must read NULL, never 500. Migrations do NOT auto-run on deploy.
- The migration runner hands `up(conn)` a **tuple row factory**, not `sqlite3.Row` — index
  positionally (v017 crashed on this for 4 prod users).

### B. CRUD API

`routers/intro_cards.py` (new), all session + profile scoped:

| Route | Does |
|---|---|
| `GET /api/intro-cards` | List the profile's cards (id, name, template, image preview URL, is_default, updated_at) |
| `POST /api/intro-cards` | Create; returns the row |
| `PATCH /api/intro-cards/{id}` | Surgical update — send ONLY the changed field (project persistence rule), never the whole card on every keystroke |
| `DELETE /api/intro-cards/{id}` | Delete the row + its R2 image (T5190's delete path) |
| `POST /api/intro-cards/{id}/default` | Set as the profile default |

- **Single-default enforcement is server-side and atomic**: setting a default clears the previous one
  in the same transaction. Do not trust the client to send two calls.
- Deleting the default leaves the profile with no default (reels holding NULL then get no intro) —
  that is correct, not an error state to auto-repair.
- Deleting a card that reels point at: **null out those `intro_card_id`s in the same transaction**,
  so a reel inherits the default again rather than pointing at a ghost. Never leave a dangling id.
- Every write is a named gesture from the editor, and rides the normal per-profile R2 DB sync.

### C. Validation

- `text_elements` values are validated as **TextSpec** ([T5180](T5180-rich-text-engine.md)) on the
  way in; an unknown font key or a malformed spec is a 400, never stored and never "fixed" silently.
- `template` is validated against the known set — a typo must fail loudly, not render an empty card.

## Relevant files
- `src/backend/app/database.py:1007` — `final_videos` DDL, `ensure_database()`
- `src/backend/app/migrations/profile_db/` — v033 is head; `v030_games_source_reference.py` is a
  good structural model, `v032_add_poster_marker_fields.py` the closest column-add precedent
- `src/backend/app/routers/` — new `intro_cards.py`, mounted in `main.py`
- `src/frontend/src/stores/` — new `introCardStore.js` (raw rows, no derived state)

## Classification hint
L-tier: schema change (**Migration agent required** — profile_db v034), backend + a store on the
frontend. Architect gate on the table shape + the NULL/0 semantics. Reviewer required.

## Acceptance criteria
- [ ] `intro_cards` exists via migration AND in `ensure_database()`; `final_videos.intro_card_id`
      added in the same migration and column-guarded at every read.
- [ ] Full CRUD works; updates are surgical (one changed field per call).
- [ ] Exactly one default per profile is enforced in a single transaction.
- [ ] Deleting a card clears referencing `intro_card_id`s and removes its R2 image.
- [ ] Invalid TextSpec or template is rejected with a 400 — never stored, never repaired.
- [ ] A below-head profile DB does not 500 on any read touching the new column.
- [ ] Migration is verified against a real profile DB with data, not just an empty one.
