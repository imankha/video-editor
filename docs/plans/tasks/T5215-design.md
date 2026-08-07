# T5215 — Intro attachment (per reel, per collection, and the default): Design

**Status:** DESIGN — awaiting approval (design-gated, do not implement before approval)
**Revised 2026-08-06** for two new user requirements: (A) the inherit-default path is **duration-gated** by a new per-profile `intro_min_duration_seconds` setting (default 20) — so this task now **HAS a migration** (profile_db **v037**); (B) both pickers are **carousels** (show the card, newest-first), not dropdown lists.
**Tier:** L | **Layers:** Backend + Frontend + **Migration** | **Migration:** profile_db **v037** (new per-profile threshold column). The reel column landed v034; the collection field still rides `shares.collection_definition` JSONB (no Postgres migration).
**Epic:** [Player Intro + Rich Text](player-intro/EPIC.md) — decisions 1, 7, 8
**Knowledge:** `.claude/knowledge/export-pipeline.md`

This task gives `final_videos.intro_card_id` (shipped by T5195, profile_db v034) meaning: ONE
resolution helper (now duration-gated on the inherit path), a surgical reel-attach API, a frozen
collection-attach field, a new per-profile duration threshold, and two card carousels. T5220 later
consumes the resolved card at every egress; this task does NOT render or prepend anything.

---

## 1. Current state (verified in code, not assumed)

| Fact | Location | Consequence for us |
|---|---|---|
| `final_videos.intro_card_id INTEGER` exists (nullable, no default). | `database.py:1036`; migration `v034_intro_card_library.py`. profile_db head = **v035**. | No migration. NULL is the on-INSERT default today. |
| `intro_cards` table is per-profile with `is_default INTEGER NOT NULL DEFAULT 0`, `image_key`, `name`. | `database.py:1054`. | Resolver reads default + card-by-id from here. `image_key IS NOT NULL` = "has photo" (drives the exposure notice). |
| Deleting a card ALREADY detaches reels: `UPDATE final_videos SET intro_card_id = NULL WHERE intro_card_id = ?`, same txn as the card DELETE, column-guarded. | `routers/intro_cards.py:322` (**t6620-owned, read-only for us**). | Reel dangling-id is rare (delete cascades to NULL=inherit-default). It does NOT cascade to the collection JSONB, so the collection path still needs dangling handling. |
| Parental consent lives in `user.sqlite` KV, key `intro_consent_at.<profile_id>`; `get_intro_consent(user_id, profile_id) -> iso|None`. Surfaced on `GET /api/profiles`. | `services/user_db.py:551-566`. | Consent gate reads this; frontend already receives it on the profiles payload. |
| `services/intro_cards.py` is a PURE service (`derive_composition`, validators) — **NOT on the DO-NOT-EDIT list**. | `services/intro_cards.py`. | Natural, editable home for `resolve_intro_card` + the new pure `resolve_intro_card_id` decision fn. |
| **profile_db has a per-profile `user_settings` singleton row** (`id INTEGER PK CHECK (id=1)`, `settings_json TEXT DEFAULT '{}'`), seeded on every profile DB but **currently unread** (grep finds no `settings_json` reader). It is DISTINCT from the `user_settings` KV table in **user.sqlite** (consent + `pref.*` live there). | `database.py:1255`, seed `:1398`. | This is "the existing per-profile settings row" the task points to → home for the new `intro_min_duration_seconds` typed column (§3b). |
| `collection_settings(key TEXT PK, value TEXT)` — the other per-profile knob table (T3640 `season_target_duration`). | `database.py:1265`. | Schemaless alt to the typed column; rejected — see §3b. |
| `routers/settings.py` writes `pref.*` to **user.sqlite, GLOBAL per-user, NOT per-profile**. | `settings.py:4-6`. | Wrong scope for the threshold (task requires per-profile); do NOT host it here. |
| `final_videos.duration` is frozen at export-finalize (T3600); returned by `list_downloads`; collection members carry `duration`. | `database.py:1012`, `downloads.py:299`, `collections.py:685`. | This is the reel-duration datum the duration gate reads — no re-probe (task A). |
| `database.py` is **still t6620-owned** (that branch, `feature/T6620-…`, holds v036 and is unmerged). | DO-NOT-EDIT list. | The v037 migration is free-standing; the fresh-DB `user_settings` column-add in `ensure_database()` is sequenced after t6620 merges (§3b, §6). |
| `list_downloads` already uses the collect-ids → batch-fetch → resolve-in-memory pattern (games, projects). Response models `DownloadItem`/`DownloadListResponse` are **local to downloads.py**. | `downloads.py:242,209,237,560`. | Add intro fields there, no `schemas.py` edit; batch-load cards once → no N+1. |
| `CollectionDefinition` (Pydantic) + `_canonical_definition` (frozen JSONB) + `create_collection_share_endpoint` + `resolve_collection_share`. | `collections.py:592,841,861,738`. | Add `intro_card_id` field; freeze the CONCRETE id at create; resolve at serve. |
| Frontend: per-reel kebab menu lives in `collections/ReelTile.jsx` (**editable**); every action is a handler passed down from `DownloadsPanel.jsx` (**CONTESTED — t6600**). Collection picker home = `CollectionShareModal.jsx` (**editable**). `introcards/ConsentGate.jsx` exists and its header already says "T5215 reads consent before letting a card attach". Rich picker parts exist: `IntroCardRail/Tile/Grid`. | `src/frontend/src/…` | Picker UI is buildable; only the DownloadsPanel wiring is blocked. |

---

## 2. Design-gate item 2 — COMPLETE inventory of `final_videos` writers (the top regression)

**Claim:** there are exactly **four** places that `INSERT INTO final_videos`, and I can prove the set
is closed. A silently dropped attachment can only happen on an INSERT of a NEW row; an `UPDATE … SET`
never drops `intro_card_id` because it only writes the columns it names.

### 2.1 How the list was proven complete (method, not vibes)

1. **Whole-tree literal sweep:** `grep -rn "INTO final_videos" src/backend/app --include=*.py` → **4 hits** (below). The repo is raw `sqlite3` with **no ORM** and **no dynamically-built table name** — every write names the table as a string literal, so grep is exhaustive by construction. (The one f-string in a `final_videos` INSERT, `downloads.py:1458`, interpolates the **column list**, never the table name.)
2. **Cross-checked the "finalize copied 5×" set** from the knowledge doc (`export_worker.py`, `framing.py`, `overlay.py`, `export_finalize.py`): only the two `overlay.py` copies write `final_videos`. `framing.py`, `export_worker.py`, and `export_finalize.upsert_working_video` (`export_finalize.py:108`) all `INSERT INTO **working_videos**` — verified by the same grep returning zero `final_videos` hits in those files. Architecturally, **Framing/multi-clip/durable-worker produce a `working_video`; the `final_video` row is created only at the Overlay-export stage** (`render-overlay` → `_finalize_overlay_export`, or `/final` → `export_final`). So every re-render of any reel — single or multi-clip — funnels its final-row creation through those two sites.
3. **Classified every UPDATE** touching `final_videos` (rank.py, poster.py, downloads publish/rename/watched, the v0xx migrations): none name `intro_card_id` in a `SET`, so none can drop it. The lone UPDATE that names it is the delete cascade (`intro_cards.py:324`), which sets it to NULL on purpose.

### 2.2 The four INSERT writers and what each must do

| # | Site | Trigger | Carry `intro_card_id`? | Action |
|---|---|---|---|---|
| 1 | `overlay.py:215` `_finalize_overlay_export` | Re-render finalize (Modal/local/no-keyframes/test) — inserts a NEW `MAX(version)+1` row. | **YES — carry from prior row.** | Extend the existing prior-row `SELECT` (line 153, `fv.id, fv.filename`) to also read `fv.intro_card_id`; add the column to the INSERT column-list + VALUES, column-guarded (mirror the `_has_slowmo` guard already there). **Read prior BEFORE the prior-row DELETE at line 243.** |
| 2 | `overlay.py:1697` `export_final` | Frontend-rendered final save — new version row. | **YES — carry from prior row.** | The prior capture at `:1626-1631` reads only `filename`; extend it to read `intro_card_id` (guarded) and thread into the INSERT. |
| 3 | `downloads.py:1458` `move_reels_to_profile` (`_build_moved_reel_row`) | Move a published reel to ANOTHER profile — new row in the target profile DB. | **NO — must NOT carry (per-profile ref).** | Cards are per-profile (epic dec 7); a source id is meaningless/dangling in the target. `intro_card_id` is already **absent** from `_MOVED_REEL_CARRY_COLUMNS` and `insert_cols`, so the INSERT omits it → SQLite default **NULL = inherit the TARGET profile's default**, which is the correct clean-join semantics (dec 4: "no dangling cross-profile ids"). **No code change; add a one-line comment in `_build_moved_reel_row` making the omission intentional** so a future maintainer doesn't "helpfully" add it to the carry set. (This writer is the one the knowledge doc's "2 writers" line omits — flagged in §7.) |
| 4 | `test_seams.py:191` | Dev/test seeding only (gated `/api/test/*`). | N/A — not a production egress. | Leave as-is; if a re-export regression test needs to seed an attachment it can add the column locally. |

**Net implementation for the regression:** two ~3-line edits (writers 1 & 2) + one comment (writer 3).
The re-export regression test asserts writer 1's new row still carries the id.

### 2.4 The duration gate does NOT change the writer inventory

The new requirement is a **resolution-time (read) concern only**. `final_videos.intro_card_id` still
persists exactly `0 | NULL | <id>`; carry-forward still copies that scalar. The threshold is a
SEPARATE per-profile column (§3b), never on `final_videos`, so re-export never touches it. All four
writers behave identically to §2.2. The inventory stands.

### 2.3 Why carrying from the prior row is correct (the PATCH interaction)

`PATCH /api/downloads/{id}/intro` writes `intro_card_id` onto the reel's CURRENT `final_videos` row
(the one `projects.final_video_id` points at). Re-export reads `prior = project's current final row`
→ carries its `intro_card_id` into the new version → the latest gesture survives. First-ever export
has no prior → NULL → inherits default (correct: a new reel inherits the default until attached).
Prior-kept-for-active-share still carries forward (we copy the id before any delete). No finalize
special-casing beyond the two-line reads.

---

## 3. Design-gate item 1 — `resolve_intro_card`: signature and home

**Home:** `services/intro_cards.py` (pure service, already holds `derive_composition`; **both** the
downloads router and the collections router import from `app.services.intro_cards`). This is the
single-implementation guarantee: two copies of the resolution order is the one failure this task
exists to prevent.

**Signature (scalar, approved Q1; now duration-gated). The decision order is split into a PURE
function + a thin DB wrapper so the single-reel paths and the no-N+1 list share ONE decision:**

```python
# services/intro_cards.py — PURE (no DB). The SINGLE resolution order.
def resolve_intro_card_id(
    intro_card_id: int | None,
    reel_duration: float | None,
    default_id: int | None,
    min_duration: float,
) -> int | None:
    """Which card id (if any) plays. Returns a card id or None; NEVER fabricates.

      0                        -> None                      (opted out; at ANY duration)
      <positive id>            -> that id                    (ALWAYS; never duration-gated)
      NULL (inherit default)   -> default_id  IF reel_duration is not None
                                              and reel_duration >= min_duration
                                -> None        otherwise (short reel, or unknown duration)
    """

# services/intro_cards.py — thin DB wrapper for single-reel callers (egress, collection serve).
def resolve_intro_card(intro_card_id, reel_duration, profile_conn) -> sqlite3.Row | None:
    """Load default_id + min_duration from this profile's user_settings (guarded default
    20.0), call resolve_intro_card_id, then fetch the resolved id's row.
    Dangling id (row missing) -> logger.warning + None. Read-only; no self-repair."""
```

- **Scalar, not `reel_row`** (approved). Reel path passes `reel_row["intro_card_id"]` + `reel_row["duration"]`; collection path passes the frozen definition value (and does not gate — §4 item 3).
- **NULL ≠ 0** enforced by the explicit `== 0` branch BEFORE the NULL branch (epic dec 8).
- **Explicit id is never gated** — the user picked that card on purpose; it plays on a 3-second reel.
- **`0` is never gated** — no intro means no intro at any length.
- **Duration gate lives ONLY here on the NULL branch.** `>=` boundary (a reel exactly at the
  threshold DOES get the default). `reel_duration` comes from `final_videos.duration` (frozen, no
  re-probe). **Unknown duration (`NULL` on legacy pre-v007 rows) → inherit path yields None** (fail
  closed to "no intro" — matches the "short reels shouldn't carry an intro" bias) + a debug log; an
  explicit id still plays. Flagged as Open Q2 in case the user prefers "unknown → apply default".
- **Dangling id:** the wrapper's `SELECT … WHERE id = ?` returns nothing → `logger.warning("[intro]
  reel/collection references missing intro_card id=%s (profile=%s); resolving to no-intro")` → None.
  No UPDATE, no fabrication.
- A `get_default_intro_card(profile_conn) -> Row | None` and a `get_intro_min_duration(profile_conn)
  -> float` (guarded, default 20.0) back the wrapper and the batch list (§4 item 4).

### 3b. Where the threshold lives + the migration (design-gate: track/version/proof)

- **Home:** a typed column **`intro_min_duration_seconds REAL NOT NULL DEFAULT 20.0`** on the
  **profile_db `user_settings` singleton row** (`id=1`). This is the task's preferred "column on an
  existing per-profile settings row": the row already exists and is seeded on every profile DB
  (`database.py:1398`), it is per-profile (profile.sqlite is per-user-per-profile), and it is
  currently unread — so a typed column disturbs no `settings_json` consumer. Chosen over
  `collection_settings` (key/value, schemaless, no migration) because the user explicitly asked for a
  migrated typed column, and a real column is greppable + type-safe + read hot on every reel
  resolution. NOT `routers/settings.py` (that is user.sqlite, global-per-user — wrong scope).
- **Track / version:** **profile_db, v037.** **Proof it is free:** profile_db head on master is
  v035; the only sibling holding v036 is `origin/feature/T6620-shadow-blur-inert-and-title-override`;
  I swept **every local + remote branch** (`git ls-tree` per ref) for `profile_db/v03[6-8]_` — the
  ONLY hit at or above v036 is that one v036, so **v037 is unused everywhere**. (The migration runner
  silently skips a duplicate version, so this check is mandatory.) Re-verify at implementation time.
- **Migration file:** `migrations/profile_db/v037_intro_min_duration.py` —
  `ALTER TABLE user_settings ADD COLUMN intro_min_duration_seconds REAL NOT NULL DEFAULT 20.0`
  (SQLite fills existing rows with the default). Runs manually via `POST /api/admin/migrate` after
  deploy (migrations never auto-run). **Migration agent produces this file.**
- **Fresh-DB parity (`ensure_database()` in `database.py`):** the `user_settings` CREATE TABLE must
  gain the same column so brand-new profile DBs have it without waiting for a manual migrate.
  `database.py` is **t6620-owned/unmerged**; since this task takes v037 (> t6620's v036) it merges
  AFTER t6620, so at the instructed rebase/merge-master step `database.py` will be free — add the
  one line then. Until then, ALL reads are `column_exists`-guarded (house `_has_slowmo` pattern):
  a DB missing the column reads the **20.0 default**, so correctness holds through the window and any
  fresh-DB-before-parity gap. Sequencing dependency noted in §6.
- **Editing the threshold (gesture):** `GET`/`PATCH` on a current-profile settings endpoint (propose
  `routers/profiles.py`, current-profile scoped, since `settings.py` is the wrong DB) — surgical
  single-field write to `user_settings.intro_min_duration_seconds`, validated finite + `> 0`. The
  current value is also returned on the profile/bootstrap payload the editor already loads, so the
  UI can render it. Per-profile read is cheap (current profile's own DB); it does NOT need to appear
  on the cross-profile `/api/profiles` list (that is why consent — which DOES — lives in user.sqlite;
  the threshold does not, so profile_db is correct). Flagged Open Q3 if the user wants it editable
  from the multi-profile switcher.

---

## 4. Design-gate items 3–5

### Item 3 — Collection freeze without a Postgres migration
- Add `intro_card_id: int | None = None` to `CollectionDefinition` (`collections.py:592`).
- **Freeze the CONCRETE id at create.** In `create_collection_share_endpoint` (already holds an open
  `conn` for the title), resolve the picker choice to a concrete stored value BEFORE
  `_canonical_definition`:
  - client sends a concrete card id → store it verbatim;
  - client sends `0` (No intro) → store `0`;
  - client sends `null`/omitted (= "use my default") → resolve the profile default to its **concrete
    id right now** and store THAT (or `0` if there is no default). **Ungated** — a collection is not a
    short reel, so the duration threshold (a per-reel concept) does NOT apply to this freeze.
  This is what makes "changing the default later does NOT change an existing link" true: a frozen
  NULL would re-inherit a moved default; a frozen concrete id can't. `_canonical_definition` then
  includes `intro_card_id` when present so it rides the existing `shares.collection_definition` JSONB
  — **no Postgres migration**. It also becomes part of link identity, so `find_collection_share`
  dedup correctly treats two different intros as two different links.
- **Serve time:** `resolve_collection_share` / `_evaluated_share_members` call
  `resolve_intro_card(definition.get("intro_card_id"), reel_duration=None, sharer_conn)` against the
  sharer's profile DB and attach the resolved card (id + name now; T5220 adds the presigned payload).
  Because the frozen value is always concrete (id or 0), never NULL, the duration gate is unreachable
  here (`reel_duration=None` only affects the NULL branch, which cannot occur) — collections are never
  duration-gated, by construction. A card deleted after freezing → None + warn (the delete cascade
  does NOT touch the JSONB), degrading to no intro.

### Item 4 — `GET /api/downloads` returns the resolved card name with NO N+1 per tile
Mirror the existing batch pattern (`downloads.py:335-380`). `fv.duration` is already selected:
1. Add `fv.intro_card_id` to the `list_downloads` SELECT.
2. After `rows` are fetched, load ONCE (two cheap queries, not per-tile): `SELECT id, name, is_default
   FROM intro_cards` → `{id: name}` + `default_id`; and the profile's `intro_min_duration_seconds`
   (guarded, default 20.0). ≤ a handful of card rows + one singleton read.
3. Per reel, resolve **in memory** via the pure `resolve_intro_card_id(row.intro_card_id,
   row.fv_duration, default_id, min_duration)`, then map the resolved id → name. So a NULL reel below
   the threshold correctly reports `intro_card_name = None` (what will actually play). Add
   `intro_card_id: int | None` and `intro_card_name: str | None` to `DownloadItem` (local model).
   Total added DB cost = **2 queries for the whole list**, independent of tile count.
   Pinned by the `query_counter` pytest fixture (kickoff QA requirement).

### Item 5 — The consent gate (blocked without `intro_consent_at`)
Enforced on **both** layers (defense where it matters + honest UX):
- **Backend (authoritative):** `PATCH /api/downloads/{id}/intro` and the collection-share create
  reject attaching a non-null/non-zero card when `get_intro_consent(user_id, profile_id)` is None →
  `HTTP 403` with a typed message. Detaching (`0`/`null`) is always allowed. This is the real guard;
  the frontend can be bypassed.
- **Frontend:** consent status already rides `GET /api/profiles`. When absent, the picker shows the
  existing `introcards/ConsentGate` affordance / an explainer that links to the consent step
  (ProfileIntroSection) instead of an enabled card list. "No intro" stays selectable without consent.
- **Picker copy:** cards render a "Publicly visible when shared" **public-exposure notice** whenever
  a card with a photo (`image_key` present) is the selection (both surfaces). The collection picker
  adds the **"frozen at share time — changing your default later won't change this link"** note.

---

## 5. Implementation plan (file-by-file; backend first, frontend gated)

**Backend (A/B/C + threshold — unblocked except the `database.py` fresh-DB line, §3b):**
1. `services/intro_cards.py` — add the pure `resolve_intro_card_id`, the DB wrapper
   `resolve_intro_card(intro_card_id, reel_duration, profile_conn)`, `get_default_intro_card`,
   `get_intro_min_duration` (guarded, default 20.0), and a `load_profile_cards(conn) -> dict` batch
   helper for the list. Pure/read-only.
2. `migrations/profile_db/v037_intro_min_duration.py` (**Migration agent**) — `ALTER TABLE
   user_settings ADD COLUMN intro_min_duration_seconds REAL NOT NULL DEFAULT 20.0`. Version proof §3b.
3. `routers/downloads.py` —
   - `list_downloads`: `+fv.intro_card_id`; load card map + default_id + threshold once; resolve
     per-reel in memory via `resolve_intro_card_id`; two new `DownloadItem` fields (§4 item 4).
   - New `PATCH /{download_id}/intro` with a **local** `IntroAttachRequest {intro_card_id: int|None}`
     (avoids editing t6620's `schemas.py`); surgical `UPDATE final_videos SET intro_card_id = ? WHERE
     id = ?`; consent check (403); validate a positive id exists in this profile (else 404 — never
     persist a dangling id from a gesture).
   - `_build_moved_reel_row`: one clarifying comment (writer 3, §2.2).
4. `routers/export/overlay.py` — carry-forward reads in `_finalize_overlay_export` (`:153`/INSERT)
   and `export_final` (`:1626`/INSERT), column-guarded.
5. `routers/collections.py` — `CollectionDefinition.intro_card_id`; concrete-freeze (ungated) in
   create; `_canonical_definition` passthrough; `resolve_intro_card(..., reel_duration=None)` at
   serve; expose resolved id+name.
6. `routers/profiles.py` — `GET`/`PATCH` the per-profile `intro_min_duration_seconds` (surgical,
   validated finite + `>0`); include the current value on the profile/bootstrap payload the editor
   reads. Reads/writes `user_settings.intro_min_duration_seconds`, column-guarded.
7. `database.py` `ensure_database()` `user_settings` CREATE TABLE — add the column for fresh DBs.
   **Sequenced after t6620 merges** (it owns this file; this task's v037 lands after its v036). Guards
   in steps 1/3/6 keep correctness until then (§3b).

**Frontend (D — carousels; DownloadsPanel now CLEARED/merged):**
8. New shared **`IntroCardCarousel`** component — a horizontal, browse-through carousel (not a
   dropdown). Reuses `introcards/IntroCardRail` + `IntroCardTile` (a rail is already a horizontal card
   strip). Shows **every card as a visual object, newest-first (reverse-chron by `created_at`)**, a
   leading **"No intro"** tile, the profile **default marked "Your default"**, the public-exposure
   notice when a photo card is selected, and the `ConsentGate` when consent is absent. Presentational:
   `<IntroCardCarousel cards selectedId defaultId hasConsent onSelect onRequestConsent
   frozenNote?/>` — identical control on both surfaces; only the `onSelect` wiring differs.
9. `collections/ReelTile.jsx` (**editable**) — add an "Intro" kebab item opening the carousel; takes
   an `onSetIntro` handler prop (matches the existing all-handlers-from-panel contract). Selection →
   surgical `PATCH …/intro` via a gallery-store action (gesture → API, no `useEffect`).
10. `DownloadsPanel.jsx` (**CLEARED — T6600 merged**) — wire `onSetIntro` down to `ReelTile`; the
    carousel layers via the merged `constants/zLayers.js` scale (not a raw z-index). Rebase/merge
    master first so that module is present.
11. `CollectionShareModal.jsx` (**editable**) — the same carousel, defaulting to the profile default,
    with the frozen-at-share note + exposure notice; send `intro_card_id` in the share-create body.
12. Profile intro settings UI (near `ProfileIntroSection`) — a numeric control for
    `intro_min_duration_seconds` (gesture → PATCH from step 6). Reuses editable files only.

**Persistence discipline:** every write is gesture → surgical single-field call (reel PATCH; threshold
PATCH; share-create freeze). No reactive `useEffect` persistence. Resolver/list reads are read-only.

---

## 6. Contested / DO-NOT-EDIT interaction
- **`DownloadsPanel.jsx` (t6600) — CLEARED (merged).** Edit freely; use the merged
  `constants/zLayers.js` scale for the carousel's layering. Rebase/merge master first.
- **`database.py` (t6620) — STILL OWNED / unmerged; we NOW need one line in it** (the fresh-DB
  `user_settings` column, step 7). Resolution: this task's migration is **v037 > t6620's v036**, so it
  merges after t6620 frees the file — add the line at the rebase step. All reads are `column_exists`-
  guarded so nothing breaks in the interim. **This is the one real cross-worker sequencing dependency
  in the task** (Open Q4). If t6620 has not merged when implementation reaches step 7, land steps 1–6
  + the v037 migration + guarded reads, and add the `ensure_database()` line last, once the file frees.
- **Not touched (t6620-owned) — and we don't need to:** `schemas.py` (local request/response models),
  `routers/intro_cards.py` (only READ its consent usage + the existing delete cascade), migrations
  v034/v035/v036, `intro_card_geometry.py`, `IntroCardsModal.jsx`. If review decides the reel PATCH
  body belongs in `schemas.py`, that becomes a coordination item (Open Q5).

---

## 7. Risks
1. **Dropped attachment on re-export (TOP risk):** mitigated by the two carry-forward edits +
   dedicated regression test; completeness argued in §2.
2. **Knowledge-doc drift:** `export-pipeline.md` says "`final_videos` writers (2)". True for the
   *export* pipeline, but the **cross-profile move writer (`downloads.py:1458`) is a third INSERT**.
   Stage-7 update must add it to the inventory and record the carry-vs-not-carry rule per writer.
3. **Collection freeze semantics:** freezing NULL instead of a concrete id would silently re-point
   old links when the default changes — avoided by concrete-freeze-at-create (§4 item 3).
4. **Consent bypass:** frontend-only gating is bypassable → backend 403 is the authoritative guard.
5. **Deploy→migrate window (two columns now):** all new `intro_card_id` AND
   `intro_min_duration_seconds` reads are `column_exists`-guarded (house `_has_slowmo` pattern) — a
   below-v034/below-v037 profile never 500s; the threshold reads its 20.0 default until v037 runs.
6. **Migration version collision:** v037 verified free across every branch (§3b), but the runner
   *silently skips* a duplicate — re-verify at implementation time (the landmine that motivates the
   check). The `NOT NULL DEFAULT 20.0` backfills existing rows without a data pass.
7. **Duration-gate correctness:** the gate is inherit-path-only; an explicit id or `0` is never
   gated, and collections are never gated (frozen concrete). A NULL/unknown `final_videos.duration`
   (legacy) fails closed to no-intro on the inherit path (Open Q2). Tested at both sides of the
   boundary and for unknown duration.
8. **Fresh-DB gap:** if `database.py` step 7 lags t6620, a brand-new profile lacks the column until a
   manual migrate; guarded reads return 20.0 meanwhile — correct, just not yet user-editable-persisted
   on that DB until migrated. Bounded by the merge sequencing.

---

## 8. Test plan (QA on Sonnet, medium; assert on what the user SEES)
- **Unit (pure `resolve_intro_card_id`):** the full matrix — `0`→None (short AND long); explicit
  id→id (short AND long, proving no gate); NULL + long (≥threshold)→default; NULL + short
  (<threshold)→None; NULL at EXACTLY threshold→default (`>=`); NULL + no default→None; NULL + unknown
  duration→None. Plus the DB wrapper: dangling id→None+warn (assert the log, assert no UPDATE ran).
- **Unit (threshold storage):** `get_intro_min_duration` returns 20.0 when the column/row is absent
  (guard) and the stored value when present; PATCH validates finite + `>0`.
- **Migration (v037):** apply to a pre-v037 profile DB → column exists, existing row = 20.0; the
  `column_exists` guard reads default before, real value after.
- **Re-export regression (the important one):** attach a card, re-export, assert the NEW
  `final_videos` version row still carries `intro_card_id`; and that a share-kept prior still carries.
- **Cross-profile move:** moved reel lands with `intro_card_id` NULL in the target (inherit target
  default), never the dangling source id.
- **Collection freeze:** create a share with an explicit card; change the profile default; assert the
  existing link still resolves the original card; a deleted card degrades to no-intro; confirm the
  freeze is ungated (a short-collection scenario still gets the intro).
- **Consent:** attach blocked (403) without consent, allowed after; detach always allowed.
- **Perf:** `query_counter` pins `GET /api/downloads` at a constant +2 queries regardless of tile
  count (no per-tile N+1), including the threshold load.
- **E2E (`scripts/dev-verify.sh`, real DB-loaded record):** reel kebab → **carousel** → browse cards
  newest-first → select → reload shows it; the "No intro" tile and "Your default" marker; exposure
  notice on a photo card; a short reel shows `intro_card_name = None` on the inherit path while a long
  one shows the default; editing the threshold changes which reels inherit; collection share dialog
  shows the same carousel + the frozen-at-share note. Responsive sweep at 375px + desktop (carousel
  must scroll on mobile). `saveEvidence` per acceptance criterion.

---

## 9. Settled (round 1) — carried, not re-asking
Q1 scalar signature ✅ · Q2 freeze concrete collection id ✅ · Q3 local `IntroAttachRequest` ✅ ·
Q4 cross-profile move → NULL (inherit target) ✅ · Q5 card-delete cascade → NULL, unchanged ✅ ·
Q6 DownloadsPanel cleared (T6600 merged) ✅. These are baked into the design above.

## 9b. Open questions from the new requirements
1. **Threshold home = typed column on profile_db `user_settings` (v037).** Confirm this over the
   schemaless `collection_settings` key/value (which needs no migration). I chose the column because
   you explicitly asked for a migrated typed setting and it's greppable/type-safe; naming it, the row
   already exists and is otherwise unused. OK?
2. **Unknown reel duration on the inherit path.** A legacy `final_videos.duration = NULL` reel with
   `intro_card_id = NULL`: I resolve to **no intro** (fail closed, matches "short reels shouldn't
   carry an intro"). Alternative: treat unknown as "apply the default". Confirm fail-closed.
3. **Threshold editability scope.** It's a current-profile setting read from profile.sqlite, so it is
   NOT on the cross-profile `/api/profiles` list (unlike consent). Is editing it from within the
   active profile (a numeric control near ProfileIntroSection) sufficient, or must it be editable from
   the multi-profile switcher too (which would push it to user.sqlite like consent)?
4. **`database.py` fresh-DB line vs. t6620 (the one sequencing dependency).** Plan: land everything +
   the v037 migration + guarded reads now; add the single `ensure_database()` `user_settings` column
   line at the rebase step once t6620 (v036) merges and frees `database.py`. Confirm that sequencing,
   or tell me t6620 will merge first so I can add it directly.
5. **Threshold default + units.** Default **20**, unit **seconds**, per-profile. Any bounds to enforce
   (e.g. 0 < x ≤ 120)? I plan `> 0` finite; confirm an upper clamp if you want one.
