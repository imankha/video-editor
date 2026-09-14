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

## IMPORTANT — sequencing dependency on T10120

**Do not ship this copy before T10120 lands, or ship it only with a caveat that makes the claim
true today.** The "you'll still get annotation playback after deletion" guarantee described by the
user is backed by exactly the mechanism T10120 found broken: `auto_export.py`'s recap generation is
*supposed* to run before the reclaim sweep deletes a game's source video, and that recap is what
`resolve_clip_source` falls back to once the original is gone (`.claude/knowledge/annotate.md`,
`auto_export.py:49-54`). T10120 found this ordering isn't currently enforced — if auto-export fails
or exhausts retries before reclaim, the source gets deleted with no recap, and the game's clips can
end up with **no playable video at all** (bug 52, a 17-clip game landed in exactly this state).

Telling users "it's safe to let this expire, you'll still have annotation playback" while that
guarantee can silently fail would be actively worse than saying nothing — it would encourage the
exact behavior (declining to extend) that turns into permanent data loss when the recap step fails.
**Sequence this after T10120's sweep-ordering fix ships**, or coordinate with whoever implements it
so the reassurance copy and the reliability fix land together.

## Solution (draft, refine once T10120's fix is confirmed)

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
- **Blocked on / must sequence after T10120** (game reclaim before recap strands clips) — see
  sequencing note above
- Same milestone family as T8330 (the banner's origin task)

### Technical Notes
- No new persisted state for "fully marked and exported" unless it's genuinely needed — check
  whether existing data already answers this before adding a field (coding-standards: single
  source of truth, no redundant state).

## Implementation

### Steps
1. [ ] Confirm T10120's sweep-ordering fix has shipped (or is landing in the same batch).
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
- [ ] This claim is actually true when shipped — i.e. T10120's fix is live first.
