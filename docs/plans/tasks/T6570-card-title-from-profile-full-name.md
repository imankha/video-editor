# T6570: The card title comes from the profile, not a text box

**Status:** TODO
**Impact:** 7 | **Complexity:** 3
**Follows:** [T5190](player-intro/T5190-card-image-upload-consent.md) (profile facts), [T5205](player-intro/T5205-card-editor-ui.md)

## Problem

User, 2026-08-05:

> On the intro card, we shouldn't let the user type text. We should be grabbing it from the profile.
> Add "Full Name" to the profile settings and just add that into title.

Today the card's title is a free-text box (`title_text`), so a user types their kid's name onto every
card and retypes it on every new one. The name is a **property of the athlete**, not of a card — the
same reasoning that moved position/class/team onto the profile in epic decision 3.

## Scope

- **Add `full_name` to the profile facts.** Follow the EXISTING precedent exactly: position, class
  and team are stored in the per-profile `user_settings` key/value table, **not** as columns on
  `profiles`. So this needs **NO migration** — it is another setting alongside them. Do not add a
  column, and do not reuse `profiles.name` (that is the profile's short label, e.g. "Stafford",
  which users pick for the profile switcher — a different thing from a full name).
- **Surface it in profile settings** next to position / class / team, same gesture-based save.
- **The card title reads `full_name`.** Remove the title text box from the card editor.
- **An unfilled `full_name` behaves like any other unfilled fact:** the card editor shows the same
  inline "Add it" prompt that position/class/team already use, and the renderer omits-and-logs rather
  than drawing a blank line. Do not invent a placeholder string.

## Decisions to make and state

- **`title_text` already exists on `intro_cards`** and holds typed titles for cards created before
  this change. Decide: keep reading it as an override when present (grandfathered, like T6510's
  uploads), or migrate those values into the profile. Grandfathering is likely simpler and safer —
  whichever you choose, say so, and make sure a card created after this change never depends on it.
- The task file for T5205 described `title_text` as "free-text title (title-only cards, or an
  override)". If the override concept survives, keep that wording true; if it does not, update the
  schema comment so the next reader is not misled.

## Relevant files
- `src/backend/app/services/user_db.py` — `user_settings`, and the existing position/class/team
  read/write pair (~line 667 carries the decision-3 comment explaining the pattern)
- profile settings UI (wherever T5190 put position/class/team)
- `src/frontend/src/components/introcards/IntroCardRail.jsx` — the title text box to remove
- `src/frontend/src/components/introcards/introCardPreviewElements.js` + `player_intro.py` —
  wherever the title's text is resolved; BOTH sides must agree (preview must match export)
- `src/backend/app/migrations/profile_db/v034_intro_card_library.py` — the `title_text` comment

## Classification hint
M-tier. Frontend + Backend. **No migration** (user_settings is key/value). Reviewer required.
The preview/export parity test must cover the new title source.

## Acceptance criteria
- [ ] "Full Name" is editable in profile settings, saved on a named gesture, stored in `user_settings`
      alongside position/class/team — no new column, no migration.
- [ ] The card editor no longer has a title text box.
- [ ] The card title renders from the profile's full name in BOTH the browser preview and the export.
- [ ] An unfilled full name prompts inline in the editor and is omitted-and-logged by the renderer.
- [ ] The decision on legacy `title_text` is implemented and documented; a newly created card does not
      depend on it.
- [ ] Changing the full name on the profile updates every card that shows it, with no per-card edit.
