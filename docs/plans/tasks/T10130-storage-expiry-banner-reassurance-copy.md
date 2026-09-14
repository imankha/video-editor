# T10130: Storage-expiry banner should reassure users that annotation playback survives game deletion once fully marked and exported

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-09-14
**Updated:** 2026-09-14

## Problem

User request (2026-09-14): when a user sees the storage-expiry warning — e.g. "1 game expiring
soon — 1 draft reel depends on it. Extend storage" — the dialog should also explain that once
they've fully marked the game (annotated all clips) and exported all the relevant clips, they do
NOT need to keep the source game stored, and will still be able to play back the annotations after
it's gone. Right now the banner only pushes "Extend storage," which implicitly frames deletion as
pure loss — it doesn't tell users about the one case where letting it expire is actually fine.

This is `StorageExpiryBanner.jsx` (`src/frontend/src/components/StorageExpiryBanner.jsx:16-54`),
rendered account-level per T8330. Current copy (`:32-42`):

```
{count} game(s) expiring soon — {count} draft reel(s) depend on {it/them}.  [Extend storage]
```

## IMPORTANT — sequencing dependency on T10121 (not T10120)

**Do not ship this copy before T10121 lands.** The 2026-09-14 expert investigation split the
original T10120 finding into two tasks:
- **T10120** — a frontend read-path fix (GameTile misreads `recap_video_url` as "any recap
  exists"). This fixes the *display* of an existing recap but does nothing about whether a recap
  reliably gets created before reclaim in the first place.
- **T10121** — the actual reliability gap: the reclaim sweep can permanently delete a game's video
  before its recap exists, via three separate confirmed mechanisms (a stuck `pending` status never
  retried, retry exhaustion with zero alerting, and multi-video partial expiry) — with **no R2
  object versioning anywhere in this codebase**, so once reclaimed, it's permanently gone.

The "you'll still get annotation playback after deletion" guarantee this banner is meant to make
is backed entirely by T10121's fix, not T10120's. Shipping this copy before T10121 lands would
encourage the exact behavior (declining to extend) that currently risks permanent data loss.
**Sequence this after T10121**, or coordinate with whoever implements it so the reassurance copy
and the reliability fix land together.

## Solution (draft, refine once T10121's fix is confirmed)

Add a second line/tooltip to the banner (and consider `SourceExpiredPanel.jsx` and `GameTile.jsx`'s
"Extend storage" surfaces too, per Relevant Files below, since they carry the same messaging gap) —
something like: "Once a game is fully annotated and every clip you want has been exported, you
don't need to keep it stored — your annotations stay playable after it's gone." Needs actual UX
copy review (see `ui-designer` agent / `.claude/references/ui-style-guide.md`) rather than shipping
this draft wording verbatim; also needs a real answer to "how does the banner know the game is
fully marked and exported" — check whether `is_annotated`/clip export-status data is already
available where this banner renders, or whether the message should be unconditional guidance
rather than a conditional one that requires new plumbing.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/StorageExpiryBanner.jsx` — primary target, account-level banner
- `src/frontend/src/components/SourceExpiredPanel.jsx:52` — same "Extend storage" messaging,
  different surface (already-expired/grace-window case)
- `src/frontend/src/components/GameTile.jsx:187` — per-game "Extend storage" action, same gap
- `src/frontend/src/utils/draftSourceExpiry.js` — expiry classification primitives this banner's
  parent uses; read for how "fully marked and exported" might be derivable, if at all
- `.claude/knowledge/annotate.md` — recap/annotation-playback invariants

### Related Tasks
- **Blocked on / must sequence after T10121** (reclaim sweep can permanently destroy footage) —
  see sequencing note above. Not blocked on T10120 (unrelated fix, can ship independently).
- Same milestone family as T8330 (the banner's origin task)

### Technical Notes
- No new persisted state for "fully marked and exported" unless it's genuinely needed — check
  whether existing data already answers this before adding a field (coding-standards: single
  source of truth, no redundant state).

## Implementation

### Steps
1. [ ] Confirm T10121's sweep-hardening fix has shipped (or is landing in the same batch).
2. [ ] UX copy pass (ui-designer agent) for the actual reassurance wording, across all 3 surfaces
   found above.
3. [ ] Determine if the message should be conditional on annotation/export completeness or general
   guidance; implement whichever needs no new reactive persistence.
4. [ ] Ship.

### Progress Log

**2026-09-14**: Filed from user request, during the T10120 bug-52 investigation that surfaced why
this copy needs to wait on a reliability fix first.

## Acceptance Criteria

- [ ] The storage-expiry banner (and ideally SourceExpiredPanel/GameTile's equivalent messaging)
      tells users that a fully-marked, fully-exported game does not need to stay stored.
- [ ] This claim is actually true when shipped — i.e. T10121's fix is live first.
