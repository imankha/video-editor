# T8240: Admin People table: "Clips" column should say "Published" — needs a metric decision, not just a relabel

**Status:** WIP
**Impact:** 3
**Complexity:** 3
**Created:** 2026-08-31

## Problem

The user wants the admin People table's "Clips" column relabeled to "Published".

Today `Clips` = `clip_created_count` = `user_actions.get("clip_created", 0)`
(`admin.py` ~L242) — a count of the `clip_created` analytics event, i.e. how many times the
account saved a raw annotation clip during Annotate. That is **not** the same thing as "published
reels": the product's actual "published" concept is `final_videos.published_at IS NOT NULL`
(set by the `publish_to_my_reels` gesture, `downloads.py:2089`) — a completely different table and
a completely different number in general (a user can create many clips and publish zero reels, or
vice versa via shared/imported content).

For bknoto specifically both numbers happen to be 1 (1 `clip_created` event, 1 published reel), so
the mismatch isn't visible in this account — but relabeling the header to "Published" without
changing what's counted would make the column actively wrong for any account where clip creation
and reel publishing diverge (the common case).

## Solution

Needs a decision, not a blind rename:

**Option A — relabel only, if the user actually wants "clip activity," just called something
clearer.** If "Published" was meant loosely (e.g. "content the user has produced") rather than
literally `published_at`, a different label ("Clips Saved", "Annotations") might be more honest
than either "Clips" or "Published."

**Option B — change the metric to match the new label.** Swap the column to count published
reels: `SELECT COUNT(*) FROM final_videos WHERE published_at IS NOT NULL` per account. Same cost
tradeoff as [[T8220]] Option B (per-account SQLite read vs the current single cheap Postgres
aggregate) — bundle the investigation with T8220 since both are "list-table needs a real
per-account content count" asks against the same `list_users` function, and both should land
after T8110's in-flight sourcing rework to avoid duplicate passes.

Recommend Option B given the user's own word choice ("published") points at the real
`published_at` concept already established elsewhere in the product (My Reels, Gallery) — but
confirm with the user before implementing, since it changes what admins see for every account
(e.g. a heavy-annotate/never-publish account would drop from a high "Clips" number to 0
"Published").

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` — `list_users` (~L242)
- `src/frontend/src/components/admin/UserTable.jsx` — column definition (L47)

### Related Tasks
- [[T8220]] — same root pattern ("Games" column), same function, likely same implementation
  session; sequence together after T8110

### Technical Notes
Do not reuse `clip_created_count`'s existing column key for the new meaning if Option B is chosen
— keep `clip_created_count` available (other admin surfaces may still want raw annotation
activity as an engagement signal) and add a distinct `published_count`, matching the pattern
[[T8230]] uses for the Exports split (add fields, don't overload existing ones).

## Implementation

### Steps
1. [ ] Confirm with the user: relabel-only (Option A) vs real published-count (Option B)
2. [ ] Implement the chosen option, bundled with [[T8220]]'s decision session
3. [ ] Verify against bknoto and at least one account where clip-creation and publish counts
       actually diverge, to prove the fix isn't accidentally validated by a coincidental match

## Resolution (2026-09-02): Option A — relabel only

User chose **Option A**: relabel the header only, keep the metric exactly as today
(`clip_created_count` = `clip_created` analytics events). No metric change, no migration,
no new Postgres milestone, no per-profile R2 reads. Option B (real published count) was
ruled out because publishing (`final_videos.published_at`) has no cheap Postgres source —
it would require per-profile SQLite/R2 reads (an N+1) with no analytics event to aggregate.

Label chosen is **"Clips Saved"**, NOT "Annotations" — that word is reserved for [[T8260]]
(a different metric: per-game `raw_clips` row count, not this per-account `clip_created`
event count). Using the same word for two different metrics would be confusing.

## Acceptance Criteria

- [x] The label "Clips Saved" accurately describes what `clip_created_count` counts
      (activity / clip-save events) and does NOT claim to be published output.
- [x] Metric unchanged: the column still renders `clip_created_count`, sort key unchanged
      (already in `_SORT_COLUMNS`), no backend change.
- ~~Verified on an account where raw clip-creation count and real published-reel count
  differ~~ — no longer applies: the metric was NOT changed (Option A), so there is no
  published-count divergence to demonstrate.
