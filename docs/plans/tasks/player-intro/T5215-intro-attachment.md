# T5215: Intro attachment — per reel, per collection, and the default

**Status:** TODO
**Impact:** 7 | **Complexity:** 4
**Epic:** [Player Intro + Rich Text](EPIC.md) — depends on [T5210](T5210-intro-card-generation.md)

> Read [EPIC.md](EPIC.md) (decisions 1, 8). UI mockup (reel picker):
> <https://claude.ai/code/artifact/93478a34-c7e5-406f-a56b-3c3724e4b6dd> § 06 C.
> Knowledge docs: `.claude/knowledge/export-pipeline.md` (`final_videos` writers, collections).

## Problem

The user requirement is *"a different intro attached to every reel or collection, and a default"*.
[T5195](T5195-intro-card-library.md) added the column; this task gives it meaning, an API, a single
resolution helper, and the two pickers. [T5220](T5220-add-intro-integration.md) then consumes the
resolved card at every egress.

## Scope

### A. The resolution helper — ONE function, used everywhere

```
resolve_intro_card(reel_row, profile_conn) -> card_row | None

  intro_card_id == 0     -> None            (user opted this reel out)
  intro_card_id IS NULL  -> profile default (or None if there is no default)
  intro_card_id == <id>  -> that card       (default ignored; missing row -> None + warn)
```

- **NULL and 0 are different on purpose** (epic decision 8). Collapsing them makes opting a single
  reel out impossible once a default exists. Test both explicitly.
- A dangling id (card deleted outside T5195's transaction) logs a warning and resolves to None —
  it never fabricates a card and never silently rewrites the row (no defensive self-repair).
- Every consumer calls this helper. Two implementations of the resolution order is the failure mode
  this task exists to prevent.

### B. Reel attachment

- `PATCH /api/downloads/{id}/intro` `{ intro_card_id: int | null }` — surgical, gesture-only write.
  `null` restores inherit-the-default; `0` is explicit "no intro".
- The attachment is a property of the reel and **survives re-export**: `final_videos` inserts a new
  version row on re-render, so the finalize path must carry `intro_card_id` forward from the prior
  version (see `export_finalize.upsert_working_video` and the `final_videos` writers in
  `overlay.py`). A silently dropped attachment on re-export is the top regression risk here.
- Reads: `GET /api/downloads` returns the reel's `intro_card_id` + the resolved card's name, so the
  gallery can show what will play without an N+1 per tile.

### C. Collection attachment

- Add `intro_card_id` to `CollectionDefinition` (`collections.py:592`) — it rides the existing
  `shares.collection_definition` JSONB, so **no Postgres migration**.
- Frozen at share creation, like the rest of the definition: changing the default later does not
  retroactively change an existing shared link. State this in the share UI copy.
- The collection resolver (`collections.py:652`) returns the resolved intro (presigned card URL or
  the pre-roll payload) alongside the members.

### D. The pickers

- **Reel**: in the My Reels reel menu — a small list of the profile's cards, the default marked
  "Your default", plus a "No intro" row. Selecting writes immediately (gesture -> surgical PATCH).
- **Collection**: the same control inside the collection share dialog, defaulting to the profile
  default, with the "frozen at share time" note.
- Both surfaces show the **public-exposure notice** when a card with a photo is selected.
- Consent gate: a profile without `intro_consent_at` ([T5190](T5190-card-image-upload-consent.md))
  cannot attach a card — the picker explains why and links to the consent step.

## Relevant files
- `src/backend/app/routers/downloads.py` — reel list + reel routes
- `src/backend/app/routers/collections.py:592` `CollectionDefinition`, `:652` resolve, `:775` create
- `src/backend/app/services/export_finalize.py`, `src/backend/app/routers/export/overlay.py` —
  `final_videos` writers that must carry `intro_card_id` across versions
- `src/frontend/src/components/DownloadsPanel.jsx`, `CollectionShareModal.jsx`

## Classification hint
L-tier: backend + frontend, no migration (the column landed in T5195, the collection field rides
existing JSONB). Reviewer required. Regression focus: re-export must not drop the attachment.

## Acceptance criteria
- [ ] `resolve_intro_card` is the single resolution path; NULL, 0 and an explicit id each behave as
      specified, with tests for all three.
- [ ] A reel's intro can be set, changed and cleared from My Reels; the write is surgical.
- [ ] Re-exporting a reel preserves its attachment across the new `final_videos` version.
- [ ] A collection share freezes its intro choice at creation.
- [ ] A dangling card id degrades to no intro with a warning, never a crash and never a silent fix.
- [ ] Attaching is blocked without consent.
