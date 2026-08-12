# Intro Card — 2026-08-12 investigation record + bug-fix set

**Created:** 2026-08-12
**Status:** RESOLVED as bug-fixes-only (user decision 2026-08-12). No redesign.
**Analysis artifact:** https://claude.ai/code/artifact/20ec0ed1-7065-4bf4-8d99-94e0519d5f20

## Outcome (user decisions, 2026-08-12)

A redesign was investigated (move attachment into the Overlay screen; burn the intro at
export via a Modal CPU compose, keeping a clean master + a composed copy). The user
**rejected the redesign** after review:

> "Intro attachment should not be done in overlay, because most clips are too small to
> need intros, most likely they will be used for some collections, so the only surface is
> the last step. Please just focus on fixing the bugs with the current UX and way intros
> work."

So: **the player-intro epic's Decision 1 stands** (intro applied at download/playback,
never burned at export), attachment stays on the published-reel picker and the collection
share dialog, and this effort reduces to the three bug fixes below. The full option
analysis (including the Modal compose variant and its consequences ledger) is preserved in
the artifact above for any future revisit — alongside two decisions the user DID settle
while reviewing: heavy ffmpeg work belongs in Modal, not the web server (T4945 precedent),
and intro-attach failures must be surfaced at attach time, never silently.

## What the audit found (2026-08-12, three-agent pass — kept for reference)

- **The reported bug** ("attached card X, card Y played") most likely mechanism (M1):
  `useIntroCardStore` is NOT reset in `profileStore._resetDataStores()` and its `reset()`
  has zero call sites; card ids are per-profile AUTOINCREMENT, so a stale library from
  profile A validates against profile B's table and silently attaches the wrong card.
  → [T6930](T6930-card-store-profile-switch-reset.md)
- **M2:** creating a card is not attaching it; the picker's backdrop-close (violating the
  no-backdrop-close rule) and header-X can abandon a freshly created card unattached — the
  old card keeps playing. → [T6940](T6940-picker-exit-dead-ends.md)
- **M5:** card DELETE nulls `final_videos.intro_card_id` server-side but patches none of
  the three frontend caches carrying `intro_card_name` — stale badges name a card that no
  longer exists. **M6:** two "which image" rules (`image_cutout_key`-first at egress,
  `image_key`-only in previews) — latent, no live writer sets the cutout key.
  → [T6950](T6950-one-image-rule-one-name-cache.md)
- **M3 (by design, not a bug):** playing from a collection resolves the collection's own
  card and deliberately ignores per-reel attachments (`services/intro_cards.py:298-306`).
  Consistent with the user's "intros are mostly for collections" framing.
- Worth knowing, not tasked: the re-export carry-forward reads the row
  `projects.final_video_id` points at (`overlay.py:168-176`), not the MAX(version) row the
  gallery PATCH targets — divergence only under final_video_id drift (M7, low); stale
  comment at `downloads.py:239` still documents the dead NULL-inherit semantics.

## Children

| ID | Task |
|----|------|
| T6930 | [Card store not reset on profile switch (wrong-card bug)](T6930-card-store-profile-switch-reset.md) |
| T6940 | [Picker exits: backdrop close + create-without-attach dead ends](T6940-picker-exit-dead-ends.md) |
| T6950 | [One image rule + card-delete badge invalidation](T6950-one-image-rule-one-name-cache.md) |
