# T4340 — Canonicalize segments_data at Write Time — Design

**Status:** APPROVED (Q1=Option B join, Q2=import canonicalize_segments_data, Q3=highlight_transform.py). Proceeding to implementation.
**Tier:** L · **Epic:** write-correctness (audit B5) · **Branch:** `feature/T4340-canonicalize-segments-at-write`

> Scope note: this branch ships **write-time canonicalization + migration v045**. Reader
> cleanup (removing `canonicalize_segments_data` calls) is an explicit FOLLOW-UP commit,
> gated on the migration having run on every env. This branch does NOT touch any reader's
> canonicalize call.

---

## 1. Current State Analysis

### 1.1 The dual-format problem

`working_clips.segments_data` is a JSON blob; its `boundaries` list persists in **two formats**
depending on which write path wrote the row:

| Writer | Path | boundaries stored | Example (duration 10, split at 3,7) |
|--------|------|-------------------|--------------------------------------|
| Gesture | `POST /projects/{pid}/clips/{cid}/actions` → `split_segment` → `_save_clip_framing_data` (clips.py:670) | **splits-only** (no leading 0, no trailing duration) | `[3.0, 7.0]` |
| Full-state | `PUT /projects/{pid}/clips/{cid}` → `update_working_clip` (clips.py:2326) — writes the blob directly, bypassing the helper | **full-list** `[0, ...splits, duration]` (frontend-supplied) | `[0.0, 3.0, 7.0, 10.0]` |

`segmentSpeeds` is **always** keyed by interval index over the FULL list
(`{"0":..,"1":..,"2":..}` for 3 intervals). A reader that walks the splits-only list
(`[3.0, 7.0]` → 1 interval pair) reads `segmentSpeeds["0"]` for the wrong interval and shifts
every speed one over — this is Bug 20p (slow-mo/realtime swapped in exported reels).

The compensating mechanism today is `canonicalize_segments_data(segments_data, source_duration)`
(highlight_transform.py:86-130). It detects full-format by `boundaries[0] <= 0.01` (L116),
and for splits-only rebuilds `[0.0] + splits + [source_duration]` (L127-129). Every export
reader calls it defensively; if `source_duration` is missing it logs a warning and returns the
blob unchanged (L120-125) — no silent guess.

### 1.2 The two write paths do NOT share a helper (audit correction)

The task/kickoff imply both paths funnel through `_save_clip_framing_data`. **They do not.**

- **`_save_clip_framing_data`** (clips.py:333-368) is the GESTURE path's save only. Sole call
  site: clips.py:670 at the end of `framing_action`. It does a plain `UPDATE working_clips SET
  crop_data=?, segments_data=?[, framing_version=?]`. **This is the only path that produces the
  non-canonical splits-only form.**
- **`update_working_clip`** (the PUT, clips.py:2326-2473) writes `segments_data` DIRECTLY in two
  places: the new-version `INSERT` (clips.py:2410 param, executed at 2426-2432) and the regular
  `UPDATE` (clips.py:2458-2460). It never calls the helper. Its blob is already full-list because
  the frontend's `saveCurrentClipState` sends `[0, ...splits, duration]`.

**Consequence:** write-time canonicalization only needs to change the **gesture path**. The PUT
path is already canonical for `boundaries`. (See §2.3 for whether we still touch PUT for the new
column.)

### 1.3 The gesture handler has no duration in scope

`framing_action` loads only `working_clips` via `_get_clip_framing_data` (clips.py:293-298) — it
does NOT join `raw_clips`. The clip's duration is **not present** in the gesture request context.

Duration's canonical source today is **computed at read time** as
`raw_clips.end_time - raw_clips.start_time` (aliased `raw_duration`), joined on
`working_clips.raw_clip_id`:
- framing.py:406 / :457 — `source_duration = clip['raw_duration'] or 0`
- multi_clip.py:2151 / :2199-2200 — `clip_data['duration'] = db_clip['raw_duration']`

There is **no** `working_clips.duration` column today (schema at database.py:978-999). The only
`duration` column in this schema is on `working_videos` (a different table — do not confuse).
So to canonicalize splits-only → full-list *inside the gesture handler*, the handler needs a
duration source it currently lacks.

### 1.4 The read-modify-write contract the gesture handlers rely on

Two gesture handlers read the STORED `boundaries` and do index math against it as **splits-only**:

- `split_segment` (clips.py:550-554): appends `time` to the list, re-sorts. Format-agnostic on
  its face, BUT it stores back whatever list shape it read (see §2.4 risk).
- `remove_segment_split` (clips.py:562-596): does `k = boundaries.index(time)` on the splits-only
  list, then reindexes `segmentSpeeds` treating `k` as *the split index* (split k separates
  interval k from k+1). **This math is only correct if `boundaries` is splits-only.** If the
  stored blob became full-list, the prepended `0.0` shifts `k` by one and every speed reindex is
  wrong — and the trailing `duration` would itself be treated as a removable split.

This is the subtlest interaction in the task: **changing the stored format changes what the NEXT
gesture reads.** A design that only canonicalizes on the write side, without addressing what
`remove_segment_split`/`split_segment` read on the *following* gesture, corrupts speeds on the
second gesture.

### 1.5 The latent non-canonicalizing readers

- **overlay.py:1928-1939** (before/after tracking — audit-corrected from the task's stale
  1307-1320): `end_frame = int(boundaries[-1] * framerate)` — assumes last boundary IS duration.
  Correct for full-list, wrong for splits-only (uses the last user split as clip end).
- **projects.py:1633-1660** (refresh/rescale): `old_duration = boundaries[-1]` — same assumption.

Per the task, **these readers stay unchanged this branch** — they must keep reading correctly for
BOTH formats through the deploy→migrate window. See §2.5.

### 1.6 Current gesture flow

```
POST /actions (split_segment, time=7)
  └─ _get_clip_framing_data → segments_data.boundaries = [3.0]      (splits-only, from DB)
  └─ handler: boundaries.append(7) → [3.0, 7.0]                     (still splits-only)
  └─ _save_clip_framing_data → UPDATE ... segments_data = [3.0, 7.0]  ← non-canonical persisted
        (duration 10.0 is NOWHERE in scope)
```

---

## 2. Target Architecture

**One on-disk format for `working_clips.segments_data.boundaries`: full-list
`[0.0, ...splits, duration]`, from every write path.** Readers UNCHANGED this branch.

### 2.1 Design principles applied

- [x] **Single on-disk format** — canonical full-list is the only thing persisted after this ships.
- [x] **Reuse the existing transform** — canonicalization uses the *existing*
  `canonicalize_segments_data`; no second implementation (DRY; greppability).
- [x] **No new write trigger** — the transform lives INSIDE the existing gesture save, not a new
  persistence path (persistence-sync invariant: gesture → surgical write only).
- [x] **No silent fallback** — if the gesture path cannot obtain a duration, it must NOT write a
  guessed full-list; it logs and stores what it safely can (see §2.2 decision), never fabricates.

### 2.2 Duration-source decision (the central tradeoff)

The gesture handler needs a per-clip duration to build `[0, ...splits, duration]`. Two options:

**Option A — add `working_clips.duration` REAL column** (task's prescribed shape, T1500 precedent).
Populated by the migration + carried forward on version INSERT.
- Pro: matches width/height/fps precedent; duration available on the row without a join.
- Con: **duplicates a datum.** `raw_clips.end_time - start_time` is already the canonical
  duration. A stored `working_clips.duration` can drift from it (e.g. re-annotation changes the
  raw clip range; projects.py:1633 rescale exists precisely because ranges move). CLAUDE.md: "one
  canonical location per datum." It also needs a value at write time that isn't obviously
  available — nothing in the gesture path computes it, so it would be NULL for the very rows we
  need to canonicalize until a migration/backfill fills it, and stale forever after if the raw
  range moves.

**Option B — JOIN `raw_clips` in the gesture read to get `raw_duration`** (chosen).
Add `raw_clips` to the `_get_clip_framing_data` query (or a targeted second read) so the handler
has `source_duration = end_time - start_time` in scope, exactly as every export reader already
derives it. Then canonicalize at save using that value.
- Pro: **single canonical duration source**, no new column, no drift, no backfill of an empty
  column, no PUT-path change for a column. The value is always current (computed from the raw
  range live). Mirrors the readers' existing contract precisely (framing.py:457).
- Con: one extra table in the gesture read (a single indexed PK join on `raw_clip_id` — cheap;
  the PUT and export paths already do this join).

**Decision: Option B (JOIN raw_clips, no new column).** Rationale: it honors "one canonical
location per datum," eliminates the drift risk and the awkward "new column empty exactly when we
need it" problem, and needs no PUT-path change. The T1500 precedent for width/height/fps does not
transfer cleanly: those are *probe results with no other canonical home on the row's lineage*,
whereas duration already has one (`raw_clips` range). This is genuinely a judgement call with a
real tradeoff — see Open Questions Q1; if the user prefers the column for symmetry with
width/height/fps, §2.3 and §3 note exactly what changes.

Guard: `raw_clip_id` can be NULL for uploaded clips (schema allows it), and an uploaded clip has
no `raw_clips` row → no `raw_duration`. In that case the handler has no duration. Per CLAUDE.md
(no silent guess): if duration is unavailable, **do not** fabricate a trailing boundary — call
`canonicalize_segments_data(segments_data, None)`, which logs loudly and returns the blob
unchanged (splits-only). This is strictly no worse than today (readers still canonicalize during
the window), and it fails visibly rather than writing a wrong duration. In practice framing/export
of uploaded clips already flow through the same `raw_duration`-or-0 contract, so this matches
existing behavior.

### 2.3 PUT path

**Unchanged for boundaries.** The PUT already stores full-list. Because we chose Option B (no
column), the PUT INSERT (clips.py:2426-2432) and UPDATE (2458-2460) need **no change at all**.
(Under the rejected Option A they would each need to carry/set `duration` — noted for
completeness only.)

### 2.4 The internal RMW contract — canonicalize at SAVE, keep handlers splits-only internally

This is the load-bearing design decision. Two ways to make the stored form full-list:

- **(i) Canonicalize on the way IN** (read → full-list before handlers run) and rewrite
  `remove_segment_split` / `split_segment` index math to operate on full-list. Rejected: it
  rewrites the *most fragile* code (the T4220 speed-reindex) and its off-by-one risk, for no
  benefit — the handlers are already correct and tested against splits-only.
- **(ii) Handlers keep working in splits-only internally; canonicalize ONLY at the final save.**
  Chosen. The handlers read/produce splits-only exactly as today (their index math is untouched
  and stays correct); the single canonicalization happens in `_save_clip_framing_data` immediately
  before the encode. The stored blob is full-list; the NEXT gesture read gets full-list and must
  reduce it back to splits-only before the handler runs.

For (ii) to be self-consistent, the **read side must strip full-list back to splits-only** so
handler index math stays valid across gestures. Concretely, in the gesture read path
(`_get_clip_framing_data` or a small helper it calls), after decoding `segments_data`, normalize
`boundaries` to splits-only for in-handler use: if `boundaries[0] <= 0.01` (full-list), drop the
leading 0 and the trailing duration (the elements outside `(0.01, duration-0.01)`), leaving the
user splits. Post-migration all rows are full-list, so this strip runs every gesture; pre-migration
splits-only rows are already stripped-shaped and pass through unchanged (idempotent — same
`boundaries[0] <= 0.01` discriminator the canonicalizer uses, inverted).

Net contract:
```
gesture read:  DB blob (full-list OR splits-only) → strip → splits-only  (handler invariant)
handlers:      operate on splits-only  (UNCHANGED: split_segment, remove_segment_split, T4220 reindex)
gesture save:  splits-only → canonicalize_segments_data(_, raw_duration) → full-list → encode → UPDATE
```

This keeps the fragile speed-reindex code byte-identical, confines the new logic to the read strip
+ the save canonicalize (both thin, both using the existing `boundaries[0] <= 0.01` discriminator),
and guarantees the stored form is full-list from the gesture path.

### 2.5 Readers

Unchanged. `overlay.py:1928-1939`, `projects.py:1633-1660`, framing.py, multi_clip.py, poster.py
keep their current behavior. Acceptance criterion: overlay reads correctly for BOTH formats during
the transition — it already does for full-list; for splits-only it currently uses the last split as
the end (a pre-existing latent bug the task closes at the SOURCE by making writes canonical, not by
editing the reader this branch). The both-format test (§3) characterizes this so the follow-up
cleanup has a guard.

### 2.6 Target gesture flow

```
POST /actions (split_segment, time=7)   [clip duration 10.0]
  └─ read: DB boundaries [0,3,10] → STRIP → [3.0]                    (splits-only, handler invariant)
  └─ handler: append(7) → [3.0, 7.0]                                 (splits-only, unchanged math)
  └─ save: canonicalize([3,7], raw_duration=10) → [0.0,3.0,7.0,10.0] (full-list) → UPDATE
```

---

## 3. Implementation Plan (ordered, concrete)

### Step 0 — Verify version free (right before writing the file)
`ls src/backend/app/migrations/profile_db/` → highest is **v044** (confirmed). Use **v045**.
Never renumber below applied.

### Step 1 — Gesture read: join raw_duration + strip boundaries to splits-only
- **clips.py:293-298** (`_get_clip_framing_data`): add a `raw_clips` join to select the clip's
  `raw_duration` (`rc.end_time - rc.start_time`) so `framing_action` has duration in scope. Return
  it alongside the existing tuple (extend the 4-tuple to carry `source_duration`, or fetch it in a
  small dedicated read keyed on `raw_clip_id`). Guard NULL `raw_clip_id` / missing raw row → `None`.
- Add a strip helper (in highlight_transform.py, next to `canonicalize_segments_data`, for
  greppable co-location): `to_splits_only(segments_data)` — if `boundaries[0] <= 0.01`, return a
  copy with `boundaries = [b for b in boundaries if 0.01 < b < boundaries[-1] - 0.01]`; else return
  unchanged. Apply it to the decoded `segments_data` before handlers run. This keeps
  `split_segment` / `remove_segment_split` index math (clips.py:550-596) **UNTOUCHED**.

### Step 2 — Gesture save: canonicalize before encode
- **clips.py:333-368** (`_save_clip_framing_data`): accept a `source_duration: float | None` param
  (threaded from Step 1). Immediately before `encode_data(segments_data)` (L349), replace with
  `canonicalize_segments_data(segments_data, source_duration)`. Both UPDATE branches
  (version-bump L353-357 and plain L361-365) then encode the canonical blob.
- If `source_duration` is None (uploaded/orphan clip): `canonicalize_segments_data` logs and
  returns splits-only unchanged — visible, no fabrication.

### Step 3 — PUT path
- **No change** (Option B). Note in the PR description that PUT is already canonical.

### Step 4 — Migration v045 (highest risk)
File: `src/backend/app/migrations/profile_db/v045_canonicalize_working_clip_segments.py`,
`version = 45`. Rewrites existing splits-only `working_clips.segments_data` rows to full-list.

Row-factory rule: `up(conn)` gets **TUPLE** rows — index positionally (`r[0]`), never `r['col']`
(v017 prod crash). `PRAGMA table_info` rows are tuples too (`row[1]` = column name).

Duration source in the migration = **JOIN raw_clips** (same as the readers), NOT a new empty
column:
```sql
SELECT wc.id, wc.segments_data, (rc.end_time - rc.start_time) AS raw_duration
FROM working_clips wc
LEFT JOIN raw_clips rc ON rc.id = wc.raw_clip_id
```
Per-row logic (positional: `r[0]=id, r[1]=segments_blob, r[2]=raw_duration`):
1. `seg = decode_data(r[1])`; if falsy or no `boundaries` → skip (handles empty/absent/trim-only).
2. If `boundaries[0] <= 0.01` → already full-list → skip (**idempotent** — re-run is a no-op).
3. If `raw_duration` is None/0 (uploaded/orphan) → log a warning, **skip** (do not guess a
   duration — CLAUDE.md no-silent-fallback; the row stays splits-only and readers keep
   canonicalizing it, no worse than today).
4. Else rebuild via the SAME transform: `canon = canonicalize_segments_data(seg, raw_duration)`;
   re-encode; `UPDATE working_clips SET segments_data = ? WHERE id = ?` (positional param).

Reuse `canonicalize_segments_data` in the migration too (single implementation) — import from
`app.highlight_transform`. Migrations pin their own copy conceptually, but this transform is pure
and stable; if the reviewer prefers isolation, inline the identical 3 lines (Open Q2).

**Worked example + reindex proof** (the required correctness demonstration):

Input row: `boundaries = [3.0, 7.0]`, `raw_duration = 10.0`,
`segmentSpeeds = {"0": 2.0, "1": 1.0, "2": 0.5}`.

`boundaries[0] = 3.0 > 0.01` → splits-only branch.
`splits = [b for b in sorted([3,7]) if 0.01 < b < 10.0-0.01] = [3.0, 7.0]`.
`result.boundaries = [0.0] + [3.0, 7.0] + [10.0] = [0.0, 3.0, 7.0, 10.0]`.
`segmentSpeeds` is **untouched** by canonicalization.

Interval mapping — proof the 3 speeds still land on the same 3 physical intervals:

| interval idx | full-list interval | pre-migration meaning | speed | same physical span? |
|---|---|---|---|---|
| 0 | [0.0, 3.0] | first interval (0 → first split) | 2.0 | yes |
| 1 | [3.0, 7.0] | between the two splits | 1.0 | yes |
| 2 | [7.0, 10.0] | last split → duration | 0.5 | yes |

The splits-only reader's bug was that walking `[3.0, 7.0]` yields ONE pair `[3,7]` and reads
`segmentSpeeds["0"]=2.0` for it — the wrong speed for the wrong span. Post-migration the full-list
yields three pairs indexed 0/1/2 that line up 1:1 with the always-full-list `segmentSpeeds` keys.
Because `segmentSpeeds` was already keyed for the full list, **no key is renumbered** — the fix is
purely to make `boundaries` express the intervals the keys already assume. QED.

Edge rows handled: full-list (skip, idempotent), empty/absent `segments_data` (skip), trim-only /
no `boundaries` (skip), uploaded/orphan with no `raw_duration` (log + skip, no guess).

### Step 5 — Fresh-DB schema (only if Option A is chosen)
If the user overrides to Option A, add `duration REAL` to `ensure_database()` working_clips DDL
(database.py:978-999) AND a column-guard `ALTER` in v045 (v029 pattern). **With Option B, no schema
change and no `ensure_database` edit.**

### Step 6 — Tests (Tester Phase 1, failing first)
Relevant set (~10), backend pytest:
1. **Gesture split writes full-list**: drive `split_segment` on a fixture clip with known
   `raw_duration`; read the raw stored blob → assert `boundaries == [0, ...splits, duration]`.
2. **Second gesture correctness (RMW)**: split, then `remove_segment_split` on the now-full-list
   stored row; assert `segmentSpeeds` reindex matches the T4220 expectation (proves the read-strip
   keeps handler math valid across gestures). This is the regression guard for the subtlest risk.
3. **set_segment_speed after split**: speeds land on the correct interval post-write.
4. **PUT writes full-list** (characterization — already true; guards against accidental regress).
5. **Uploaded/orphan clip (no raw_duration)**: gesture save logs and stores splits-only unchanged
   (no fabricated duration) — assert no crash, warning emitted.
6. **Migration with data**: fixture DB with splits-only rows INCLUDING `segmentSpeeds` (the worked
   example above) → run v045 → assert full-list boundaries AND speeds unchanged on the right
   intervals.
7. **Migration idempotency**: run v045 twice → second run rewrites nothing (already-full rows
   skipped).
8. **Migration edge rows**: empty `segments_data`, trim-only, orphan (no raw_duration) → skipped
   without error.
9. **Migration tuple-row factory**: assert `up(conn)` reads rows positionally (fixture asserts no
   `r['col']` access — run under the real runner row factory, the v017 guard).
10. **overlay.py both-format read**: one fixture row full-list, one splits-only → assert
    `end_frame` computed correctly for full-list; document splits-only current behavior (guards the
    follow-up cleanup). Plus backend import check `python -c "from app.main import app"`.

### Step 7 — Frontend contract check (read-only, no change expected)
Confirm `useSegments.js` sends full-list on PUT and tolerates full-list on restore (it already
does — the PUT path is where full-list originates). Note the API contract as "full-list after
T4340" in the knowledge doc; no frontend behavior change.

### Step 8 — Knowledge docs (Stage 7)
Update `.claude/knowledge/annotate.md` ("segments_data dual format" invariant → now
"write-time-canonical; reader cleanup pending follow-up") and
`.claude/knowledge/backend-services.md` migration table (v045). Note reader-cleanup is NOT done.

---

## 4. Design Decisions

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| Duration source for gesture canonicalization | A: new `working_clips.duration` column · B: JOIN `raw_clips.raw_duration` | **B (join)** | One canonical datum (raw range), no drift, no empty-column backfill, no PUT change; mirrors existing reader contract (framing.py:457). See Open Q1. |
| Where to canonicalize | On read (rewrite handler math) · On save (keep handlers splits-only) | **On save** | Leaves the fragile T4220 speed-reindex untouched; new logic confined to a thin read-strip + save-canonicalize using the existing discriminator. |
| Reuse vs reimplement the transform | New impl in save/migration · reuse `canonicalize_segments_data` | **Reuse** | DRY, single greppable implementation; already tested (test_segments_canonicalize.py). |
| Reader cleanup this branch | Yes · No | **No** | Deploy→migrate window means splits-only rows still exist; readers must keep canonicalizing (task-mandated follow-up). |
| Missing duration (uploaded/orphan) | Fabricate · skip+log | **Skip + log** | CLAUDE.md no-silent-fallback; fails visibly, no worse than today. |

---

## 5. Risks

| Risk | Mitigation |
|------|------------|
| **RMW off-by-one on second gesture** — stored full-list read by `remove_segment_split` shifts `k` and corrupts speeds | Read-strip normalizes DB blob back to splits-only before handlers; Test #2 exercises split-then-remove on a full-list stored row and asserts the T4220 reindex. |
| **Duration drift / two canonical homes** (Option A) | Chose Option B (no stored duration; derive from raw range live). |
| **Deploy-before-migrate window** — canonical write code live while some rows still splits-only | Readers UNCHANGED this branch — all keep canonicalizing until the migration runs everywhere. Design assumes migration has NOT run when write code ships. |
| **Tuple row-factory** (`r['col']` → v017 prod crash) | Migration indexes positionally; Test #9 runs under the real runner row factory. `PRAGMA table_info` also read as tuples (`row[1]`). |
| **Migration not idempotent** — double-canonicalize on re-run | `boundaries[0] <= 0.01` skip guard (already-full rows untouched); Test #7 runs v045 twice. |
| **Malformed / missing-duration data silently guessed** | `canonicalize_segments_data(_, None)` logs and returns unchanged; migration skips+logs orphan rows. Never fabricates a boundary. |
| **Version collision** — another branch lands v045 | Verify `ls migrations/profile_db/` immediately before writing; v044 is current head. |
| **overlay/projects readers regress** | Not touched; both-format characterization test (#10) locks current behavior. |

---

## 6. Open Questions for the User

1. **Duration source (Q1, primary):** I chose **Option B — JOIN `raw_clips`, no new
   `working_clips.duration` column** — because duration already has one canonical home
   (`raw_clips.end_time - start_time`) and a stored copy risks drift + needs a backfill of an empty
   column. The task/kickoff prescribe adding the column (T1500 symmetry). This is a genuine
   judgement call. **Approve Option B, or do you want the column for consistency with
   width/height/fps?** (If the column: adds an `ensure_database` edit + a column-guard ALTER + PUT
   INSERT/UPDATE carry-forward — §3 Step 5, larger surface, drift risk to manage.)

2. **Migration transform reuse (Q2, minor):** the migration imports `canonicalize_segments_data`
   from app code rather than inlining a frozen copy. Migrations are usually self-contained, but
   this transform is pure/stable and reuse avoids a second implementation. **OK to import, or
   inline the 3 lines for migration isolation?**

3. **Read-strip location (Q3, minor):** the new `to_splits_only` helper goes in
   `highlight_transform.py` next to `canonicalize_segments_data` (greppable pair). Any objection to
   that file vs a clips.py-local helper?

---

**This design awaits user approval before proceeding to Stage 3 (Test First) / Stage 4
(Implementation).** No source has been changed.
